import { describe, expect, it, vi } from "vitest";
import { createEngine, type CardMove, type GameEvent } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, type DriveSpec } from "@sve/core/testing";
import { stateHash } from "../src/engine/game-host";
import { EffectContextObserver } from "../src/presentation/effect-context";
import { HandGainObserver } from "../src/presentation/hand-gain-observer";
import { HandGainDisplay, HAND_GAIN_DURATION_MS } from "../src/presentation/hand-gain-display";
import type { GameUpdate } from "../src/presentation/protocol";

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });

function tracked(spec: DriveSpec) {
  const t = drive(engine, spec);
  const plain = drive(engine, spec);
  const observer = new EffectContextObserver(engine, t.game);
  const act = t.game.act.bind(t.game);
  t.game.act = (input, from) => {
    const events = observer.act(input, from, () => act(input, from));
    expect(events).toEqual(plain.game.act(input, from));
    expect(stateHash(t.game.state)).toBe(stateHash(plain.game.state));
    expect(t.game.decision).toEqual(plain.game.decision);
    expect(t.game.snapshot()).toEqual(plain.game.snapshot());
    return events;
  };
  return { t, notices: () => observer.handGains.drain() };
}

describe("public cards entering hidden zones", () => {
  it("BP03-030 shows all cemetery cards returned to deck despite the subsequent shuffle and draw", () => {
    const { t, notices } = tracked({ me: { hand: ["BP03-030"], cemetery: ["BP03-033", "BP03-033", "BP03-036"],
      deck: ["BP01-038"], playPoints: 1 } });
    const before = t.ids("BP03-033@cemetery");
    t.play("BP03-030").pick("BP03-033", "BP03-033", "BP03-036");
    const gains = notices();
    expect(gains).toHaveLength(1);
    expect(gains[0]).toMatchObject({ to: "deck", operator: 0, player: 0 });
    expect(gains[0]!.cards.map((c) => c.card.def)).toEqual(["BP03-033", "BP03-033", "BP03-036"]);
    expect(gains[0]!.cards.slice(0, 2).map((c) => c.id)).toEqual(before);
    expect(new Set(gains[0]!.cards.map((c) => c.id)).size).toBe(3);
  });

  it("BP17-054 shows the hand card explicitly revealed as an additional cost, without showing drawn cards", () => {
    const { t, notices } = tracked({ me: { hand: ["BP17-054", "BP16-048", "BP16-048"],
      deck: ["BP01-038", "BP01-038"], playPoints: 1 } });
    const oldId = t.id("BP16-048@hand");
    t.play("BP17-054");
    expect(notices()).toEqual([]);
    t.pick("BP16-048");
    const gains = notices();
    expect(gains).toHaveLength(1);
    expect(gains[0]).toMatchObject({ to: "deck", operator: 0, cards: [{ id: oldId, from: "hand", card: { def: "BP16-048" } }] });
    expect(gains[0]!.cards[0]!.id).not.toBe(t.id("BP16-048@deck"));
  });

  it("BP06-117 captures the faceup evolve card before it becomes hidden, even when the choice is auto-answered", () => {
    const { t, notices } = tracked({ me: { hand: ["BP06-117"], faceUpEvolveDeck: ["BP06-002"],
      evolveDeck: ["BP18-006"], deck: ["BP01-038"], playPoints: 1 } });
    t.play("BP06-117");
    const gains = notices();
    expect(gains).toHaveLength(1);
    expect(gains[0]).toMatchObject({ to: "evolveDeck", operator: 0, cards: [{ from: "evolveDeck", card: { def: "BP06-002" } }] });
    expect(t.game.reader().faceUpEvolveDeck(0)).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it("BP18-T01 shows every selected faceup evolve card together, including identical copies", () => {
    const { t, notices } = tracked({ me: { ex: ["BP18-T01"], faceUpEvolveDeck: ["BP18-006", "BP18-006", "BP18-010"],
      evolveDeck: ["BP06-002"], deck: ["BP01-038"], playPoints: 1 } });
    t.play("BP18-T01@ex");
    expect(notices()).toEqual([]);
    t.pick("BP18-006", "BP18-006", "BP18-010");
    const gains = notices();
    expect(gains).toHaveLength(1);
    expect(gains[0]).toMatchObject({ to: "evolveDeck", operator: 0, player: 0 });
    expect(gains[0]!.cards.map((c) => c.card.def)).toEqual(["BP18-006", "BP18-006", "BP18-010"]);
    expect(new Set(gains[0]!.cards.map((c) => c.id)).size).toBe(3);
  });

  it("does not report choosing no evolve cards or a rejected selection", () => {
    const { t, notices } = tracked({ me: { ex: ["BP18-T01"], faceUpEvolveDeck: ["BP18-006", "BP18-010"],
      deck: ["BP01-038"], playPoints: 1 } });
    t.play("BP18-T01@ex");
    expect(() => t.answer({ type: "selectCards", cards: ["not-a-card"] })).toThrow();
    expect(notices()).toEqual([]);
    t.pick();
    expect(notices()).toEqual([]);
    expect(t.game.reader().faceUpEvolveDeck(0)).toHaveLength(2);
  });

  it("new deck/evolve notices immediately replace the panel, filter by operator, and expire after 8 seconds", () => {
    vi.useFakeTimers();
    try {
      const { t, notices } = tracked({ me: { hand: ["BP17-054", "BP16-048", "BP06-117"],
        faceUpEvolveDeck: ["BP06-002"], deck: ["BP01-038", "BP01-038", "BP01-038"], playPoints: 2 } });
      const changed = vi.fn();
      const display = new HandGainDisplay(changed);
      const update = (handGains = notices(), perspective: 0 | 1 = 1) => ({ seed: "hidden-notices", perspective, handGains,
        announcement: null, decision: null, logReset: false, result: null }) as GameUpdate;
      t.play("BP17-054");
      const first = notices();
      expect(display.publish(update(first, 0))).toBeNull();
      expect(display.publish(update(first))?.to).toBe("deck");
      vi.advanceTimersByTime(7000);
      t.play("BP06-117");
      expect(display.publish(update())?.to).toBe("evolveDeck");
      vi.advanceTimersByTime(1000);
      expect(changed).not.toHaveBeenCalled();
      vi.advanceTimersByTime(HAND_GAIN_DURATION_MS - 1000);
      expect(changed).toHaveBeenCalledExactlyOnceWith(null);
      display.clear();
    } finally { vi.useRealTimers(); }
  });
});

describe("private return boundaries", () => {
  const event = (from: CardMove["from"], reason: CardMove["reason"] = "effect"): GameEvent => ({ type: "cardsMoved", moves: [{
    card: "old", newCard: "hidden-new", def: "BP01-038", printing: "BP01-038", owner: 0, from,
    to: { player: 0, zone: "deck", faceUp: false, position: "bottom" }, reason, before: null,
  }] });

  it.each(["hand", "deck", "banished", "evolveDeck"] as const)("does not reveal an unseen card from %s", (zone) => {
    const observer = new HandGainObserver();
    observer.observe([event({ player: 0, zone, faceUp: false })], []);
    expect(observer.drain()).toEqual([]);
  });

  it("shows a reveal carried across a choice, but not looking privately or direct manual moves", () => {
    const observer = new HandGainObserver();
    observer.observe([event({ player: 0, zone: "hand", faceUp: false })], ["old"]);
    expect(observer.drain()[0]).toMatchObject({ to: "deck", cards: [{ id: "old", from: "hand" }] });
    observer.observe([{ type: "cardsLookedAt", player: 0, cards: [{ id: "old", def: "BP01-038" }] },
      event({ player: 0, zone: "deck", faceUp: false })], []);
    expect(observer.drain()).toEqual([]);
    observer.observe([{ type: "manualOp", op: { kind: "move", card: "old", to: "deckBottom" } },
      event({ player: 0, zone: "cemetery", faceUp: true })], []);
    expect(observer.drain()).toEqual([]);
    observer.observe([event({ player: 0, zone: "hand", faceUp: false }, "mulligan"), { type: "deckShuffled", player: 0 }], []);
    expect(observer.drain()).toEqual([]);
  });

  it("shows public field cards returned to deck and faceup evolve cards moved back facedown", () => {
    const observer = new HandGainObserver();
    observer.observe([event({ player: 0, zone: "field", faceUp: true })], []);
    expect(observer.drain()[0]).toMatchObject({ to: "deck", cards: [{ from: "field" }] });
    const moved = event({ player: 0, zone: "field", faceUp: true });
    if (moved.type !== "cardsMoved") throw new Error("expected move");
    moved.moves[0]!.to = { player: 0, zone: "evolveDeck", faceUp: false };
    observer.observe([moved], []);
    expect(observer.drain()[0]).toMatchObject({ to: "evolveDeck", cards: [{ id: "old", from: "field" }] });
  });
});
