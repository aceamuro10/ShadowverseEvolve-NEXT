import type { CardId, CardMove, GameEvent, Input, PlayerId } from "@sve/core";
import type { HandGainAnnouncement } from "./protocol";

let sessionSerial = 0;

/** Observes real events only. Owner/debug visibility is never evidence of a public gain. */
export class HandGainObserver {
  private readonly prefix = `hand-gain:${++sessionSerial}`;
  private serial = 0;
  private pending: HandGainAnnouncement[] = [];
  private operator: PlayerId | null = null;

  observe(events: readonly GameEvent[], alreadyRevealed: readonly CardId[], operation?: { type: Input["type"]; player: PlayerId | null }): void {
    // Selections/confirmations may be answered by the other player. Keep the initiator until
    // a new main action, Quick action or pending-ability resolution starts.
    if (operation && (this.operator === null || operation.type === "mainPhase" || operation.type === "quick" || operation.type === "selectPending")) {
      this.operator = operation.player;
    }
    const revealed = new Set(alreadyRevealed);
    const hidden = new Map<CardId, CardMove>();
    const groups = new Map<PlayerId, HandGainAnnouncement>();
    const add = (move: CardMove): void => {
      if (!move.newCard || !move.def || !move.from) return;
      let group = groups.get(move.to.player);
      if (!group) {
        group = { key: `${this.prefix}:${++this.serial}`, operator: this.operator, player: move.to.player, cards: [] };
        groups.set(move.to.player, group);
      }
      group.cards.push({ id: move.newCard, card: { def: move.def, printing: move.printing || null },
        from: move.from.zone as HandGainAnnouncement["cards"][number]["from"] });
    };
    let manualMove = false;
    for (const event of events) {
      if (event.type === "manualOp") manualMove = event.op.kind === "move" || event.op.kind === "search";
      if (event.type === "cardsRevealed") for (const card of event.cards) {
        revealed.add(card.id);
        const move = hidden.get(card.id);
        if (move) { add(move); hidden.delete(card.id); }
      }
      // A shuffle ends any association with an old deck order. Hand instances remain distinct.
      if (event.type === "deckShuffled") revealed.clear();
      if (event.type !== "cardsMoved") continue;
      for (const move of event.moves) {
        const publicSource = move.from?.zone === "cemetery" || (move.from?.zone === "banished" && move.from.faceUp);
        const supported = publicSource || move.from?.zone === "deck" || move.from?.zone === "banished";
        if (!manualMove && supported && move.to.zone === "hand" && move.reason === "effect" && move.newCard) {
          if (publicSource || (move.card !== null && revealed.has(move.card))) add(move);
          else hidden.set(move.newCard, move); // Some scripts reveal the new hand instance after moving it.
        }
        if (move.card) { revealed.delete(move.card); hidden.delete(move.card); }
      }
      manualMove = false;
    }
    this.pending.push(...groups.values());
  }

  drain(reset = false): HandGainAnnouncement[] {
    const pending = this.pending;
    this.pending = [];
    return reset ? [] : pending;
  }
}
