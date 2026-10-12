import { describe, expect, it } from "vitest";
import { createEngine, script, type Decision, type GameEvent, type Input } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, testFollower } from "@sve/core/testing";
import { EffectContextObserver } from "../src/presentation/effect-context";
import { DiceObserver, rerollResult } from "../src/presentation/dice-observer";
import { stateHash } from "../src/engine/game-host";

const engine = createEngine({ cards: [...ALL_CARDS, ...["ROLL1", "ROLL2", "ROLL3", "WATCH", "PLAIN"].map((id) => testFollower(id, 1, 1, 10))],
  scripts: { ...ALL_SCRIPTS, ...Object.fromEntries([1, 2, 3].map((n) => [`ROLL${n}`, script.defineCard({ abilities: [script.activated({}, {
    *resolve(fx) { for (let i = 0; i < n; i++) yield* fx.rollDie(); },
  })] })])), WATCH: script.defineCard({ abilities: [script.whenYouRollADie({
    *resolve(fx) { yield* fx.choose([{ id: "a", label: "A" }, { id: "b", label: "B" }]); },
  })] }) } });

function setup(times = 1, rerolls = 0, extra: string[] = [], autoResolve?: ("quick")[]) {
  const spec = { seed: "dice-observe", me: { field: [`ROLL${times}`, ...Array(rerolls).fill("ECP02-065"), ...extra] },
    opp: { field: ["PLAIN", "PLAIN"] }, ...(autoResolve ? { config: { autoResolve } } : {}) };
  const driver = drive(engine, spec);
  const original = drive(engine, spec);
  const observer = new EffectContextObserver(engine, driver.game);
  const events: GameEvent[] = [];
  const act = (input: Input) => {
    const actual = observer.act(input, undefined, () => driver.game.act(input));
    expect(actual).toEqual(original.game.act(input));
    expect(stateHash(driver.game.state)).toBe(stateHash(original.game.state));
    expect(driver.game.snapshot()).toEqual(original.game.snapshot());
    events.push(...actual);
    return actual;
  };
  const activate = () => {
    const d = driver.game.decision;
    if (d?.type !== "mainPhase") throw new Error("main phase required");
    const action = d.actions.find((a) => a.type === "activate" && driver.game.state.cards[a.card]?.def === `ROLL${times}`)!;
    act({ type: "mainPhase", action });
  };
  const presentation = () => observer.presentation({ perspective: 0, view: driver.game.view(0),
    decision: driver.game.decision ? { decision: driver.game.decision, cards: {}, abilities: {} } : null });
  return { ...driver, driver, observer, activate, act, events, presentation };
}

describe("dice observations from the original live session", () => {
  it("anchors each throw before its own real dieRolled event, preserving intervening effects", () => {
    const t = setup(3);
    t.observer.dice.drain(true); // The host's initial publication consumes startup events as well.
    t.activate();
    const visible = t.events.filter((e) => e.type !== "cardsLookedAt");
    const throws = t.observer.dice.drain().filter((s) => s.type === "throw");
    expect(throws.map((s) => s.afterEvents)).toEqual(visible.flatMap((e, i) => e.type === "dieRolled" ? [i] : []));
  });

  it("keeps anchors stable whether private look-at events are retained or hidden by the host", () => {
    const observer = new DiceObserver();
    observer.observe(null, null, [
      { type: "cardPlayed", player: 0, card: "source", def: "ROLL", from: "hand" },
      { type: "cardsLookedAt", player: 0, cards: [] },
      { type: "dieRolled", player: 0, result: 2 },
      { type: "dieRolled", player: 0, result: 5 },
    ], null);
    expect(observer.drain().filter((s) => s.type === "throw").map((s) => s.afterEvents)).toEqual([1, 2]);
    observer.observe(null, null, [{ type: "dieRolled", player: 0, result: 6 }], null);
    expect(observer.drain()[0]?.afterEvents).toBe(0);
  });

  it.each([1, 2, 3])("records every one of %i consecutive rolls without changing state or RNG", (times) => {
    const t = setup(times);
    t.activate();
    const steps = t.observer.dice.drain();
    expect(steps.filter((s) => s.type === "throw").map((s) => s.result)).toEqual(t.events.filter((e) => e.type === "dieRolled").map((e) => e.result));
    expect(steps.filter((s) => s.type === "throw")).toHaveLength(times);
    expect(t.observer.dice.drain()).toEqual([]);
  });

  it("observes first throw, both rerolls and finalization with two Kaede cards", () => {
    const t = setup(1, 2);
    t.activate();
    const first = t.observer.dice.drain();
    expect(first.map((s) => s.type)).toEqual(["throw", "prompt"]);
    expect(t.events.filter((e) => e.type === "dieRolled")).toHaveLength(0);
    t.act({ type: "choose", ids: ["reroll"] });
    const second = t.observer.dice.drain();
    expect(second.map((s) => s.type)).toEqual(["throw", "prompt"]);
    expect(second[0]).toMatchObject({ reroll: true });
    t.act({ type: "choose", ids: ["reroll"] });
    const last = t.observer.dice.drain();
    expect(last.map((s) => s.type)).toEqual(["throw", "settled"]);
    expect(last[0]).toMatchObject({ reroll: true });
    expect(t.events.filter((e) => e.type === "dieRolled")).toHaveLength(1);
    expect(t.game.reader().diceRolledThisTurn(0)).toEqual([last[0]!.result]);
  });

  it("keep finalizes the old die then records the next die's first throw in the same act", () => {
    const t = setup(2, 1);
    t.activate();
    const first = t.observer.dice.drain();
    t.act({ type: "choose", ids: ["keep"] });
    const second = t.observer.dice.drain();
    expect(second.map((s) => s.type)).toEqual(["settled", "throw", "prompt"]);
    expect(second[0]!.result).toBe(first[0]!.result);
    expect(second[1]).toMatchObject({ reroll: false });
    t.act({ type: "choose", ids: ["keep"] });
    expect(t.observer.dice.drain().map((s) => s.type)).toEqual(["settled"]);
    expect(t.game.reader().diceRolledThisTurn(0)).toHaveLength(2);
  });

  it("does not lose intermediate inquiries when many actual acts are drained in one host update", () => {
    const t = setup(3, 2);
    t.activate();
    for (let i = 0; i < 6; i++) t.act({ type: "choose", ids: ["reroll"] });
    const steps = t.observer.dice.drain();
    expect(steps.filter((s) => s.type === "throw")).toHaveLength(9);
    expect(steps.filter((s) => s.type === "prompt")).toHaveLength(6);
    expect(steps.filter((s) => s.type === "settled")).toHaveLength(3);
    expect(new Set(steps.map((s) => s.key)).size).toBe(steps.length);
  });

  it("does not commit failed inputs and discards historical steps on reset", () => {
    const t = setup(1, 1);
    t.activate();
    t.observer.dice.drain();
    const prompt = t.observer.dice.prompt;
    expect(() => t.observer.act({ type: "choose", ids: ["invalid"] }, undefined, () => t.game.act({ type: "choose", ids: ["invalid"] }))).toThrow();
    expect(t.observer.dice.prompt).toEqual(prompt);
    expect(t.observer.dice.drain()).toEqual([]);
    t.act({ type: "choose", ids: ["reroll"] });
    expect(t.observer.dice.drain(true)).toEqual([]);
  });

  it("keeps each pending instance's point when resolving identical abilities in reverse order", () => {
    const t = setup(3, 0, ["BP21-077"], ["quick"]);
    t.activate();
    const pending = [...t.game.state.pending];
    expect(pending).toHaveLength(3);
    expect(new Set(pending.map((p) => p.data?.count)).size).toBeGreaterThan(1);
    for (const p of pending.toReversed()) {
      expect(t.presentation().pendingAbilities[p.id]?.triggerDie?.result).toBe(p.data?.count);
      t.act({ type: "selectPending", id: p.id });
      expect(t.game.decision).toMatchObject({ type: "selectCards", reason: "target" });
      expect(t.presentation().effectContext).toMatchObject({ pendingId: p.id, triggerDie: { player: 0, result: p.data?.count } });
      const d = t.game.decision;
      if (d?.type !== "selectCards") throw new Error("target required");
      t.act({ type: "selectCards", cards: [d.candidates[0]!] });
    }
  });

  it("recovers the causal result when a new pending ability is consumed inside the same act", () => {
    const t = setup(1, 0, ["WATCH"]);
    t.activate();
    expect(t.game.state.pending).toHaveLength(0);
    expect(t.game.decision).toMatchObject({ type: "choose", reason: "effect" });
    expect(t.presentation().effectContext).toMatchObject({ sourceDef: "WATCH", triggerDie: { result: t.events.find((e) => e.type === "dieRolled")!.result } });
  });

  it("does not infer a valid number from malformed runtime choices", () => {
    const d: Decision = { type: "choose", reason: "dieReroll", player: 0, source: null, min: 1, max: 1, options: [{ id: "keep", label: "Keep 2" }, { id: "reroll", label: "Reroll 6" }] };
    expect(rerollResult(d)).toBeNull();
    const observer = new DiceObserver([], d);
    expect(observer.drain()).toEqual([]);
  });

  it("records equal intermediate and final results as separate actual rerolls", () => {
    const d: Decision = { type: "choose", reason: "dieReroll", player: 0, source: null, min: 1, max: 1,
      options: [{ id: "keep", label: "Keep 4" }, { id: "reroll", label: "Reroll 4" }] };
    const observer = new DiceObserver([], d);
    observer.observe(d, { type: "choose", ids: ["reroll"] }, [], d);
    observer.observe(d, { type: "choose", ids: ["reroll"] }, [{ type: "dieRolled", player: 0, result: 4 }], null);
    const steps = observer.drain();
    expect(steps.filter((s) => s.type === "throw").map((s) => s.result)).toEqual([4, 4, 4]);
    expect(steps.map((s) => s.type)).toEqual(["throw", "prompt", "throw", "prompt", "throw", "settled"]);
  });
});
