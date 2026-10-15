import { redactEvent, type CardId, type CardInstance, type CardMove, type DefId, type GameEvent, type Input, type PlayerId } from "@sve/core";
import type { HandGainAnnouncement } from "./protocol";

let sessionSerial = 0;

export type FaceUpEvolveCard = Pick<CardInstance, "id" | "def" | "printing" | "controller">;
export interface NoticeEffectSource { source: CardId; def: DefId }
export interface NoticeOperation {
  type: Input["type"];
  player: PlayerId | null;
  source?: NoticeEffectSource | null;
  playing?: boolean;
  abilitySources?: ReadonlyMap<GameEvent, NoticeEffectSource | null>;
  flipSource?: NoticeEffectSource | null;
}

/** Observes real moves and face changes. Owner/debug visibility never makes a card public. */
export class HandGainObserver {
  private readonly prefix = `hand-gain:${++sessionSerial}`;
  private serial = 0;
  private pending: HandGainAnnouncement[] = [];
  private operator: PlayerId | null = null;

  observe(events: readonly GameEvent[], alreadyRevealed: readonly CardId[], operation?: NoticeOperation,
    turnedFacedown: readonly FaceUpEvolveCard[] = []): void {
    // Selections/confirmations may be answered by the other player. Keep the initiator until
    // a new main action, Quick action or pending-ability resolution starts.
    if (operation && (this.operator === null || operation.type === "mainPhase" || operation.type === "quick" || operation.type === "selectPending")) {
      this.operator = operation.player;
    }
    const revealed = new Set(alreadyRevealed);
    let source = operation?.source ?? null;
    let resumeSource = source;
    const plays: NoticeEffectSource[] = operation?.playing && source ? [source] : [];
    const hidden = new Map<CardId, { move: CardMove; source: NoticeEffectSource | null }>();
    const groups = new Map<string, HandGainAnnouncement>();
    const add = (player: PlayerId, to: HandGainAnnouncement["to"], card: HandGainAnnouncement["cards"][number], effect: NoticeEffectSource | null): void => {
      // A panel belongs to one source card, even if several effects resolve in the same act.
      const key = `${player}:${to}:${effect?.source ?? ""}:${effect?.def ?? ""}`;
      let group = groups.get(key);
      if (!group) {
        group = { key: `${this.prefix}:${++this.serial}`, operator: this.operator, player, to, effectSource: effect?.def ?? null, cards: [] };
      }
      group.cards.push(card);
      groups.delete(key);
      groups.set(key, group); // The latest actual result replaces earlier destinations in the panel.
    };
    const addMove = (move: CardMove, effect: NoticeEffectSource | null): void => {
      if (!move.newCard || !move.def || !move.from) return;
      if (move.to.zone !== "hand" && move.to.zone !== "deck" && move.to.zone !== "evolveDeck") return;
      add(move.to.player, move.to.zone, {
        // Never attach the new hidden deck instance to a public notification.
        id: move.to.zone === "hand" ? move.newCard : move.card ?? `${this.prefix}:card:${++this.serial}`,
        card: { def: move.def, printing: move.printing || null }, from: move.from.zone,
      }, effect);
    };
    let manualMove = false;
    for (const event of events) {
      if (event.type === "cardPlayed") source = { source: event.card, def: event.def };
      if (event.type === "abilityPlayed") {
        source = operation?.abilitySources?.has(event) ? operation.abilitySources.get(event) ?? null :
          event.sourceDef.includes(":") ? null : { source: event.source, def: event.sourceDef };
      }
      if (event.type === "manualOp") manualMove = event.op.kind === "move" || event.op.kind === "search";
      if (event.type === "cardsRevealed") for (const card of event.cards) {
        revealed.add(card.id);
        const pending = hidden.get(card.id);
        if (pending) { addMove(pending.move, pending.source); hidden.delete(card.id); }
      }
      // A shuffle ends any association with an old deck order. Hand instances remain distinct.
      if (event.type === "deckShuffled") revealed.clear();
      if (event.type !== "cardsMoved") continue;
      const publicViews = ([0, 1] as const).map((player) => redactEvent(event, player));
      for (const [index, move] of event.moves.entries()) {
        // Additional play costs run before cardPlayed. Entering resolution already identifies
        // the played card, including a card played by another card's effect.
        if (move.reason === "play" && move.to.zone === "resolution" && move.newCard && move.def) {
          if (resumeSource?.source === move.card) resumeSource = null;
          source = { source: move.newCard, def: move.def };
          plays.push(source);
        }
        const publicSource = move.from?.zone === "cemetery" || (move.from?.zone === "banished" && move.from.faceUp);
        const supported = publicSource || move.from?.zone === "deck" || move.from?.zone === "banished";
        const hiddenDeck = move.to.zone === "deck" || (move.to.zone === "evolveDeck" && !move.to.faceUp);
        if (!manualMove && move.reason === "effect" && move.newCard && ((supported && move.to.zone === "hand") || hiddenDeck)) {
          const publicMove = hiddenDeck ? publicViews.every((view) => view.type === "cardsMoved" && view.moves[index]?.def === move.def) : publicSource;
          if (publicMove || (move.card !== null && revealed.has(move.card))) addMove(move, source);
          else hidden.set(move.newCard, { move, source }); // Keep the original cause if a later effect reveals the card.
        }
        if (move.card) { revealed.delete(move.card); hidden.delete(move.card); }
        if (move.reason === "resolve" && move.card === plays.at(-1)?.source) {
          plays.pop();
          source = plays.at(-1) ?? (resumeSource?.source === move.card ? null : resumeSource);
        }
      }
      manualMove = false;
    }
    for (const card of turnedFacedown) add(card.controller, "evolveDeck", {
      id: card.id, card: { def: card.def, printing: card.printing || null }, from: "evolveDeck",
    }, operation?.flipSource ?? null);
    this.pending.push(...groups.values());
  }

  drain(reset = false): HandGainAnnouncement[] {
    const pending = this.pending;
    this.pending = [];
    return reset ? [] : pending;
  }
}
