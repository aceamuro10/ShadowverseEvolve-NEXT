import { redactEvent, type CardId, type CardInstance, type CardMove, type GameEvent, type Input, type PlayerId } from "@sve/core";
import type { HandGainAnnouncement } from "./protocol";

let sessionSerial = 0;

export type FaceUpEvolveCard = Pick<CardInstance, "id" | "def" | "printing" | "controller">;

/** Observes real moves and face changes. Owner/debug visibility never makes a card public. */
export class HandGainObserver {
  private readonly prefix = `hand-gain:${++sessionSerial}`;
  private serial = 0;
  private pending: HandGainAnnouncement[] = [];
  private operator: PlayerId | null = null;

  observe(events: readonly GameEvent[], alreadyRevealed: readonly CardId[], operation?: { type: Input["type"]; player: PlayerId | null },
    turnedFacedown: readonly FaceUpEvolveCard[] = []): void {
    // Selections/confirmations may be answered by the other player. Keep the initiator until
    // a new main action, Quick action or pending-ability resolution starts.
    if (operation && (this.operator === null || operation.type === "mainPhase" || operation.type === "quick" || operation.type === "selectPending")) {
      this.operator = operation.player;
    }
    const revealed = new Set(alreadyRevealed);
    const hidden = new Map<CardId, CardMove>();
    const groups = new Map<string, HandGainAnnouncement>();
    const add = (player: PlayerId, to: HandGainAnnouncement["to"], card: HandGainAnnouncement["cards"][number]): void => {
      const key = `${player}:${to}`;
      let group = groups.get(key);
      if (!group) {
        group = { key: `${this.prefix}:${++this.serial}`, operator: this.operator, player, to, cards: [] };
      }
      group.cards.push(card);
      groups.delete(key);
      groups.set(key, group); // The latest actual result replaces earlier destinations in the panel.
    };
    const addMove = (move: CardMove): void => {
      if (!move.newCard || !move.def || !move.from) return;
      if (move.to.zone !== "hand" && move.to.zone !== "deck" && move.to.zone !== "evolveDeck") return;
      add(move.to.player, move.to.zone, {
        // Never attach the new hidden deck instance to a public notification.
        id: move.to.zone === "hand" ? move.newCard : move.card ?? `${this.prefix}:card:${++this.serial}`,
        card: { def: move.def, printing: move.printing || null }, from: move.from.zone,
      });
    };
    let manualMove = false;
    for (const event of events) {
      if (event.type === "manualOp") manualMove = event.op.kind === "move" || event.op.kind === "search";
      if (event.type === "cardsRevealed") for (const card of event.cards) {
        revealed.add(card.id);
        const move = hidden.get(card.id);
        if (move) { addMove(move); hidden.delete(card.id); }
      }
      // A shuffle ends any association with an old deck order. Hand instances remain distinct.
      if (event.type === "deckShuffled") revealed.clear();
      if (event.type !== "cardsMoved") continue;
      const publicViews = ([0, 1] as const).map((player) => redactEvent(event, player));
      for (const [index, move] of event.moves.entries()) {
        const publicSource = move.from?.zone === "cemetery" || (move.from?.zone === "banished" && move.from.faceUp);
        const supported = publicSource || move.from?.zone === "deck" || move.from?.zone === "banished";
        const hiddenDeck = move.to.zone === "deck" || (move.to.zone === "evolveDeck" && !move.to.faceUp);
        if (!manualMove && move.reason === "effect" && move.newCard && ((supported && move.to.zone === "hand") || hiddenDeck)) {
          const publicMove = hiddenDeck ? publicViews.every((view) => view.type === "cardsMoved" && view.moves[index]?.def === move.def) : publicSource;
          if (publicMove || (move.card !== null && revealed.has(move.card))) addMove(move);
          else hidden.set(move.newCard, move); // A subsequent real reveal may make the new instance public.
        }
        if (move.card) { revealed.delete(move.card); hidden.delete(move.card); }
      }
      manualMove = false;
    }
    for (const card of turnedFacedown) add(card.controller, "evolveDeck", {
      id: card.id, card: { def: card.def, printing: card.printing || null }, from: "evolveDeck",
    });
    this.pending.push(...groups.values());
  }

  drain(reset = false): HandGainAnnouncement[] {
    const pending = this.pending;
    this.pending = [];
    return reset ? [] : pending;
  }
}
