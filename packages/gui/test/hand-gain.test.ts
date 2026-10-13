import { describe, expect, it, vi } from "vitest";
import { createEngine, randomAnswer, script, seedRng, type Answer, type CardMove, type GameEvent } from "@sve/core";
import { testFollower } from "@sve/core/testing";
import { GameHost, stateHash, type Scheduler } from "../src/engine/game-host";
import type { GameOptions } from "../src/engine/protocol";
import type { FromWorker, GameUpdate, ToWorker } from "../src/presentation/protocol";
import { createPresentationHost } from "../src/presentation/host";
import { HandGainObserver } from "../src/presentation/hand-gain-observer";

const engine = createEngine({ cards: ["SEARCH", "QUICK", "SECRET", "CROSS", "RECOVER", "BANISH", "POST", "LOOK", "TARGET"].map((id) => testFollower(id, 0, 1, 10)), scripts: {
  SEARCH: script.defineCard({ abilities: [script.activated({}, { *resolve(fx) { yield* fx.search((id) => fx.game.card(id)!.def === "TARGET", { max: 2 }); } })] }),
  QUICK: script.defineCard({ abilities: [script.activated({}, { quick: true, *resolve(fx) { yield* fx.search((id) => fx.game.card(id)!.def === "TARGET", { max: 2 }); } })] }),
  SECRET: script.defineCard({ abilities: [script.activated({}, { *resolve(fx) { yield* fx.search(() => true, { reveal: false, required: true }); } })] }),
  CROSS: script.defineCard({ abilities: [script.activated({}, { *resolve(fx) { yield* fx.search((id) => fx.game.card(id)!.def === "TARGET", {
    *destination() { return (yield* fx.confirm()) ? "hand" : "field"; },
  }); } })] }),
  RECOVER: script.defineCard({ abilities: [script.activated({}, { *resolve(fx) { yield* fx.returnToHand(fx.game.cards(fx.controller, "cemetery")); } })] }),
  BANISH: script.defineCard({ abilities: [script.activated({}, { *resolve(fx) { yield* fx.returnToHand(fx.game.cards(fx.controller, "banished")); } })] }),
  POST: script.defineCard({ abilities: [script.activated({}, { *resolve(fx) { const moved = yield* fx.returnToHand(fx.topCards(1)); yield* fx.reveal(moved); } })] }),
  LOOK: script.defineCard({ abilities: [script.activated({}, { *resolve(fx) { const cards = fx.topCards(1); yield* fx.lookAt(cards); yield* fx.returnToHand(cards); } })] }),
} });

function setup(def = "SEARCH", scheduler: Scheduler = { schedule: vi.fn(() => () => {}) }) {
  const messages: FromWorker[] = [];
  const a = new GameHost(engine, () => {}, scheduler);
  const b = createPresentationHost(engine, (m) => messages.push(m), scheduler);
  const deck = { main: [...Array(10).fill(def), ...Array(30).fill("TARGET")], evolve: [] };
  const options: GameOptions = { seed: "hand-gain-test", decks: [deck, deck], deckNames: ["A", "B"], controllers: ["human", "human"],
    deckRestrictions: false, manualActions: true, showEveryMainPhase: true, askEveryQuickWindow: true, turnOrder: "player1" };
  const latest = () => messages.filter((m): m is { kind: "update"; update: GameUpdate } => m.kind === "update").at(-1)!.update;
  const equal = () => {
    expect(stateHash(b.session!.state)).toBe(stateHash(a.session!.state));
    expect(b.replay()).toEqual(a.replay());
    expect(b.session!.decision).toEqual(a.session!.decision);
    expect(messages.filter((m) => m.kind === "error")).toEqual([]);
  };
  const send = (m: Exclude<ToWorker, { kind: "handGainSeen" }>) => { a.handle(m); b.handle(m); equal(); };
  const act = (answer: Answer) => send({ kind: "answer", seat: a.session!.decision!.player, answer });
  const manual = (op: import("@sve/core").ManualOp) => act({ type: "mainPhase", action: { type: "manual", op } });
  send({ kind: "start", options });
  const rng = seedRng("setup");
  while (a.session!.decision?.type !== "mainPhase") act(randomAnswer(rng, a.session!.decision!));
  const source = Object.values(a.session!.state.cards).find((c) => c.def === def && c.owner === 0 && c.zone === "hand") ??
    Object.values(a.session!.state.cards).find((c) => c.def === def && c.owner === 0 && c.zone === "deck")!;
  manual({ kind: "move", card: source.id, to: "field" });
  const activate = () => act({ type: "mainPhase", action: { type: "activate", card: Object.values(a.session!.state.cards).find((c) => c.def === def && c.owner === 0 && c.zone === "field")!.id, ability: 0 } });
  const pick = (n: number) => {
    const d = a.session!.decision!;
    if (d.type !== "selectCards") throw new Error(`Expected cards, got ${d.type}`);
    act({ type: "selectCards", cards: d.candidates.slice(0, n) });
  };
  const seen = () => { b.handle({ kind: "handGainSeen", key: latest().handGain!.key }); equal(); };
  return { a, b, latest, options, messages, send, act, manual, activate, pick, seen, equal };
}

describe("public hand gains from real rule execution", () => {
  it("shows both identical search results, pauses local controls, and acknowledges without any rule input", () => {
    const t = setup(); t.activate(); t.pick(2);
    const gain = t.latest().handGain!;
    expect(gain.cards.map((c) => [c.card.def, c.from])).toEqual([["TARGET", "deck"], ["TARGET", "deck"]]);
    expect(new Set(gain.cards.map((c) => c.id)).size).toBe(2);
    expect(t.latest().decision).toBeNull();
    const replay = t.b.replay();
    t.b.handle({ kind: "answer", seat: 0, answer: { type: "mainPhase", action: { type: "endMainPhase" } } });
    t.b.handle({ kind: "handGainSeen", key: "stale" });
    expect(t.latest().handGain).toEqual(gain);
    expect(t.b.replay()).toEqual(replay);
    t.seen();
    expect(t.latest().handGain).toBeNull();
    expect(t.latest().decision?.decision.type).toBe("mainPhase");
    expect(t.latest().log).toEqual([]);
    expect(t.b.replay()).toEqual(replay);
  });

  it("never promotes private searches or looked-at cards to public, even with revealAll enabled", () => {
    for (const def of ["SECRET", "LOOK"]) {
      const t = setup(def); t.send({ kind: "settings", settings: { revealAll: true } });
      t.activate(); if (def === "SECRET") t.pick(1);
      expect(t.latest().handGain).toBeNull();
    }
  });

  it("remembers an actual reveal across a destination choice, but shows only cards actually put in hand", () => {
    for (const accept of [true, false]) {
      const t = setup("CROSS"); t.activate(); t.pick(1);
      expect(t.latest().handGain).toBeNull();
      expect(t.a.session!.decision?.type).toBe("confirm");
      t.act({ type: "confirm", yes: accept });
      expect(t.latest().handGain?.cards.length ?? 0).toBe(accept ? 1 : 0);
    }
  });

  it("handles explicit reveal after moving to hand and empty searches", () => {
    const t = setup("POST"); t.activate();
    expect(t.latest().handGain?.cards).toHaveLength(1);
    const empty = setup(); empty.activate(); empty.pick(0);
    expect(empty.latest().handGain).toBeNull();
  });

  it.each(["cemetery", "banished"] as const)("recovers public cards from %s, excluding direct manual moves", (zone) => {
    const t = setup(zone === "cemetery" ? "RECOVER" : "BANISH");
    const card = Object.values(t.a.session!.state.cards).find((c) => c.owner === 0 && c.zone === "hand")!;
    t.manual({ kind: "move", card: card.id, to: zone });
    expect(t.latest().handGain).toBeNull();
    t.activate();
    expect(t.latest().handGain?.cards.map((c) => c.from)).toEqual([zone]);
    t.seen();
  });

  it("does not replay old notices on rewind/load and continues to observe future real inputs", () => {
    const t = setup(); t.activate(); t.pick(2);
    const replay = t.a.replay()!;
    t.send({ kind: "rewind", inputs: replay.inputs.length });
    expect(t.latest().handGain).toBeNull();
    expect(t.latest().logReset).toBe(true);
    t.activate(); t.pick(1);
    expect(t.latest().handGain?.cards).toHaveLength(1);
  });

  it("shows Quick resolution first, then its complete public search result without extra inputs", () => {
    const t = setup("QUICK");
    t.send({ kind: "settings", settings: { announceQuick: true } });
    t.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    t.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    const d = t.a.session!.decision!;
    if (d.type !== "quick") throw new Error(`Expected quick, got ${d.type}`);
    t.act({ type: "quick", action: d.actions.find((a) => a.type === "activate")! });
    t.pick(2);
    expect(t.latest().announcement).not.toBeNull();
    expect(t.latest().handGain).toBeNull();
    const count = t.latest().inputCount;
    t.send({ kind: "acknowledge", seq: t.latest().announcement!.seq });
    expect(t.latest().announcement).toBeNull();
    expect(t.latest().handGain?.cards).toHaveLength(2);
    t.seen();
    expect(t.latest().inputCount).toBe(count);
  });

  it("queues a later remote answer until the local reveal is seen, without desynchronizing", () => {
    const t = setup(); t.activate(); t.pick(2);
    const prefix = t.a.replay()!.inputs;
    const peer: FromWorker[] = [];
    const remote = createPresentationHost(engine, (m) => peer.push(m), { schedule: () => () => {} });
    const last = () => (peer.filter((m) => m.kind === "update").at(-1) as { update: GameUpdate }).update;
    remote.handle({ kind: "spectate", options: { ...t.options, controllers: ["remote", "remote"] }, inputs: prefix.slice(0, -1) });
    const pickInput = prefix.at(-1)!.input;
    const beforePick = stateHash(remote.session!.state);
    remote.handle({ kind: "remoteInput", index: prefix.length - 1, input: pickInput, hash: beforePick });
    const key = last().handGain!.key;
    const nextHash = stateHash(t.a.session!.state);
    const next: Answer = { type: "mainPhase", action: { type: "endMainPhase" } };
    t.a.handle({ kind: "answer", seat: 0, answer: next });
    remote.handle({ kind: "remoteInput", index: prefix.length, input: next, hash: nextHash });
    expect(last().inputCount).toBe(prefix.length);
    remote.handle({ kind: "handGainSeen", key });
    expect(last().inputCount).toBe(t.a.replay()!.inputs.length);
    expect(last().online?.desync).toBeNull();
    expect(stateHash(remote.session!.state)).toBe(stateHash(t.a.session!.state));
  });

  it("stepping a real replay through a Quick search releases its summary and then shows the cards", () => {
    vi.useFakeTimers();
    try {
      const t = setup("QUICK", { schedule(fn, ms) { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); } });
      t.send({ kind: "settings", settings: { announceQuick: true } });
      t.act({ type: "mainPhase", action: { type: "endMainPhase" } });
      t.act({ type: "mainPhase", action: { type: "endMainPhase" } });
      const d = t.a.session!.decision!;
      if (d.type !== "quick") throw new Error("expected quick");
      t.act({ type: "quick", action: d.actions.find((a) => a.type === "activate")! });
      t.pick(2);
      const replay = t.a.replay()!;
      t.send({ kind: "watch", replay });
      t.send({ kind: "watchControl", playing: false, seek: replay.inputs.length - 2 });
      t.send({ kind: "watchControl", step: 1 });
      t.send({ kind: "watchControl", step: 1 });
      expect(t.latest().announcement).not.toBeNull();
      expect(t.latest().handGain).toBeNull();
      const count = t.latest().inputCount;
      vi.advanceTimersByTime(1800);
      expect(t.latest().announcement).toBeNull();
      expect(t.latest().handGain?.cards).toHaveLength(2);
      expect(t.latest().inputCount).toBe(count);
      t.seen();
    } finally { vi.useRealTimers(); }
  });
});

describe("publicity boundaries on zone moves", () => {
  const move = (from: "deck" | "banished" | "cemetery", faceUp: boolean, reason: CardMove["reason"] = "effect"): GameEvent => ({ type: "cardsMoved", moves: [{
    card: "old", newCard: "new", def: "TARGET", printing: "TARGET", owner: 0,
    from: { player: 0, zone: from, faceUp }, to: { player: 0, zone: "hand", faceUp: false }, reason, before: null,
  }] });
  it("never shows face-down banished recovery or draws without an explicit reveal", () => {
    const observer = new HandGainObserver();
    observer.observe([move("banished", false), move("deck", false, "draw")], []);
    expect(observer.drain()).toEqual([]);
    observer.observe([move("banished", false)], ["old"]);
    expect(observer.drain()[0]!.cards).toHaveLength(1);
  });
  it("does not retain a prior effect's revealed instance or confuse identical definitions", () => {
    const observer = new HandGainObserver();
    observer.observe([{ type: "cardsRevealed", player: 0, cards: [{ id: "different", def: "TARGET" }] }, move("deck", false)], []);
    expect(observer.drain()).toEqual([]);
    observer.observe([{ type: "cardsRevealed", player: 0, cards: [{ id: "old", def: "TARGET" }] }], []);
    observer.observe([move("deck", false)], []);
    expect(observer.drain()).toEqual([]);
  });
});
