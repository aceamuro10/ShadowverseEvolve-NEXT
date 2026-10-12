import { afterEach, describe, expect, it, vi } from "vitest";
import { DicePlayback, type DiceFrame } from "../src/presentation/dice-playback";
import type { DiceStep, GameUpdate } from "../src/presentation/protocol";
import { DICE_TIMING } from "../src/presentation/dice-timing";

const thrown = (key: string, result = 3): DiceStep => ({ type: "throw", key, player: 0, result, reroll: key !== "first" });
const prompt = (key: string): DiceStep => ({ type: "prompt", key, player: 0, result: 3 });
function update(steps: DiceStep[], inputCount = 1, choice?: string): GameUpdate {
  return { seed: "dice", inputCount, diceSteps: steps, logReset: false, log: [],
    diePrompt: choice ? { key: choice, player: 0, result: 3 } : null,
    decision: choice ? { decision: { type: "choose", reason: "dieReroll", player: 0, source: null, min: 1, max: 1,
      options: [{ id: "keep", label: "Keep 3" }, { id: "reroll", label: "Reroll 3" }] }, cards: {}, abilities: {} } : null } as unknown as GameUpdate;
}
function setup(animated = true) {
  let frame: DiceFrame | null = null;
  const frames: DiceFrame[] = [];
  const publish = vi.fn();
  const block = vi.fn();
  const playback = new DicePlayback({ frame: (f) => { frame = f; if (f) frames.push(f); }, publish, block, idle: vi.fn() }, () => animated);
  const finish = () => { if (!frame) throw new Error("no visible frame"); playback.complete(frame.key); };
  return { playback, publish, block, frames, finish, frame: () => frame };
}
afterEach(() => vi.useRealTimers());

describe("serial dice playback and decision gates", () => {
  it("does not publish the real reroll dialog until the animation completes", () => {
    const t = setup();
    const u = update([thrown("first"), prompt("ask")], 1, "ask");
    t.playback.enqueue(u);
    expect(t.publish).not.toHaveBeenCalled();
    expect(t.frame()).toMatchObject({ type: "throw" });
    t.playback.complete("unrelated-old-animation");
    expect(t.publish).not.toHaveBeenCalled();
    t.finish();
    expect(t.publish).toHaveBeenCalledWith(u, true);
    expect(t.frames.map((f) => f.type)).toEqual(["throw"]);
  });

  it("serializes three identical results rather than deduplicating by number", () => {
    const t = setup();
    const u = update([thrown("a"), thrown("b"), thrown("c")]);
    t.playback.enqueue(u);
    for (let i = 0; i < 3; i++) { expect(t.publish).not.toHaveBeenCalled(); t.finish(); }
    expect(t.frames.map((f) => f.key)).toEqual(["a", "b", "c"]);
    expect(t.publish).toHaveBeenCalledTimes(1);
  });

  it("preserves every inquiry in a batched bot/remote update and plays the final reroll", () => {
    vi.useFakeTimers();
    const t = setup();
    t.playback.enqueue(update([thrown("first"), prompt("q1"), thrown("second"), prompt("q2"), thrown("last"),
      { type: "settled", key: "final", player: 0, result: 3 }]));
    t.finish();
    expect(t.frame()).toMatchObject({ type: "prompt", key: "q1" });
    vi.advanceTimersByTime(400);
    expect(t.frame()).toMatchObject({ type: "throw", key: "second" });
    t.finish(); vi.advanceTimersByTime(400); t.finish();
    expect(t.frames.map((f) => f.type)).toEqual(["throw", "prompt", "throw", "prompt", "throw"]);
    expect(t.publish).toHaveBeenCalledTimes(1);
  });

  it("never makes a superseded decision interactive when newer updates arrive during its throw", () => {
    vi.useFakeTimers();
    const t = setup();
    const a = update([thrown("first"), prompt("old")], 1, "old");
    const b = update([thrown("next")], 2);
    t.playback.enqueue(a); t.playback.enqueue(b);
    t.finish(); vi.advanceTimersByTime(400);
    expect(t.publish).toHaveBeenCalledWith(a, false);
    expect(t.frame()).toMatchObject({ key: "next" });
    t.finish();
    expect(t.publish).toHaveBeenLastCalledWith(b, true);
  });

  it("uses static results with the same gate when animations are disabled", () => {
    vi.useFakeTimers();
    const t = setup(false);
    t.playback.enqueue(update([thrown("first"), prompt("q")], 1, "q"));
    expect(t.frame()).toMatchObject({ animated: false, duration: DICE_TIMING.hold, hold: 0 });
    expect(t.publish).not.toHaveBeenCalled();
    t.finish();
    expect(t.frame()).toBeNull();
    expect(t.publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DICE_TIMING.gap);
    expect(t.publish).toHaveBeenCalledTimes(1);
  });

  it("cancels obsolete animation completions and historical inquiries on reset/seek", () => {
    vi.useFakeTimers();
    const t = setup();
    t.playback.enqueue(update([thrown("first"), prompt("old")]));
    t.finish();
    const reset = { ...update([thrown("history")]), logReset: true };
    t.playback.enqueue(reset);
    t.playback.complete("first"); vi.runAllTimers();
    expect(t.frame()).toBeNull();
    expect(t.publish).toHaveBeenCalledTimes(1);
    expect(t.publish).toHaveBeenCalledWith(reset, true);
  });

  it("flushes pending updates on leaving, with only the latest interactive", () => {
    const t = setup();
    const a = update([thrown("first")]); const b = update([thrown("second")], 2);
    t.playback.enqueue(a); t.playback.enqueue(b); t.playback.flush();
    expect(t.publish.mock.calls).toEqual([[a, false], [b, true]]);
    expect(t.frame()).toBeNull();
  });

  it("duplicate publication does not play the same observed throw twice", () => {
    const t = setup(); const u = update([thrown("first")]);
    t.playback.enqueue(u); t.finish(); t.playback.enqueue(u);
    expect(t.frames).toHaveLength(1);
  });

  it("holds the landed face before allowing a reroll inquiry", () => {
    vi.useFakeTimers();
    const t = setup();
    t.playback.enqueue(update([thrown("first"), prompt("ask")], 1, "ask"));
    t.playback.landed("first");
    vi.advanceTimersByTime(DICE_TIMING.hold - 1);
    expect(t.publish).not.toHaveBeenCalled();
    t.playback.landed("first"); // A duplicate animation end must not extend or skip the hold.
    vi.advanceTimersByTime(1);
    expect(t.publish).toHaveBeenCalledTimes(1);
  });

  it("hides each static result for 100ms, including identical dice and the final transition", () => {
    vi.useFakeTimers();
    const t = setup(false);
    t.playback.enqueue(update([thrown("a"), thrown("b"), thrown("c")]));
    for (const key of ["a", "b", "c"]) {
      expect(t.frame()).toMatchObject({ key });
      t.finish();
      expect(t.frame()).toBeNull();
      expect(t.publish).not.toHaveBeenCalled();
      vi.advanceTimersByTime(99);
      expect(t.frame()).toBeNull();
      expect(t.publish).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
    }
    expect(t.frames.map((f) => f.key)).toEqual(["a", "b", "c"]);
    expect(t.publish).toHaveBeenCalledTimes(1);
  });

  it("cancels an empty static interval on seek without resurrecting its next die", () => {
    vi.useFakeTimers();
    const t = setup(false);
    t.playback.enqueue(update([thrown("first"), thrown("second")]));
    t.finish();
    const reset = { ...update([]), logReset: true };
    t.playback.enqueue(reset);
    vi.runAllTimers();
    expect(t.frames.map((f) => f.key)).toEqual(["first"]);
    expect(t.publish.mock.calls).toEqual([[reset, true]]);
  });

  it("cancels the landed hold on seek and ignores its stale completion", () => {
    vi.useFakeTimers();
    const t = setup();
    t.playback.enqueue(update([thrown("first")]));
    t.playback.landed("first");
    const reset = { ...update([]), logReset: true };
    t.playback.enqueue(reset);
    vi.runAllTimers();
    expect(t.publish.mock.calls).toEqual([[reset, true]]);
    expect(t.frame()).toBeNull();
  });

  it("waits for prior animations and plays event slices before each die without republishing their cosmetics", () => {
    const calls: string[] = [];
    let priorDone!: () => void;
    let sliceDone!: () => void;
    let frame: DiceFrame | null = null;
    const playback = new DicePlayback({
      block() {}, idle() {}, frame(f) { frame = f; if (f) calls.push(f.key); },
      waitForAnimations(done) { priorDone = done; },
      animate(_u, entries, done) { calls.push(entries.map((e) => e.event.type).join(",")); sliceDone = done; },
      publish(u) { calls.push(`publish:${u.animationLog?.map((e) => e.event.type).join(",")}`); },
    }, () => true);
    const u = { ...update([{ ...thrown("first"), afterEvents: 1 }, { ...thrown("second"), afterEvents: 3 }]),
      log: ["cardPlayed", "dieRolled", "cardsMoved", "dieRolled", "damageDealt"].map((type, seq) => ({ seq, event: { type }, cards: {} })) } as GameUpdate;
    playback.enqueue(u);
    expect(calls).toEqual([]);
    priorDone();
    expect(calls).toEqual(["cardPlayed"]);
    sliceDone();
    expect(frame).toMatchObject({ key: "first" });
    playback.complete("first");
    expect(calls.at(-1)).toBe("dieRolled,cardsMoved");
    sliceDone(); playback.complete("second");
    expect(calls).toEqual(["cardPlayed", "first", "dieRolled,cardsMoved", "second", "publish:dieRolled,damageDealt"]);
    expect(u.log).toHaveLength(5);
  });

  it("does not resurrect a prelude or a pending throw after reset", () => {
    let done!: () => void;
    const publish = vi.fn();
    const frame = vi.fn();
    const playback = new DicePlayback({ block() {}, idle() {}, frame, publish,
      waitForAnimations(callback) { done = callback; } }, () => true);
    playback.enqueue(update([thrown("first")]));
    const reset = { ...update([]), logReset: true };
    playback.enqueue(reset); done();
    expect(publish.mock.calls).toEqual([[reset, true]]);
    expect(frame).not.toHaveBeenCalledWith(expect.objectContaining({ type: "throw" }));
  });

  it("does not animate a Quick card again in its summary after an earlier dice prelude", () => {
    let preludeDone!: () => void;
    const publish = vi.fn();
    const playback = new DicePlayback({ block() {}, idle() {}, frame() {}, publish,
      animate(_update, _entries, done) { preludeDone = done; } }, () => true);
    const first = { ...update([{ ...thrown("first"), afterEvents: 1 }]),
      log: [{ seq: 1, event: { type: "cardPlayed", card: "quick-card", player: 0, def: "SPELL", from: "hand" }, cards: {} }] } as GameUpdate;
    playback.enqueue(first); preludeDone(); playback.complete("first");
    const summary = { ...update([], 2), announcement: { source: "quick-card", seq: 1 } } as GameUpdate;
    playback.enqueue(summary);
    expect(summary.announcementIntroduced).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(summary, true);
  });
});
