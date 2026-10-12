import { afterEach, describe, expect, it, vi } from "vitest";
import { DicePlayback, type DiceFrame } from "../src/presentation/dice-playback";
import type { DiceStep, GameUpdate } from "../src/presentation/protocol";

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
    const t = setup(false);
    t.playback.enqueue(update([thrown("first"), prompt("q")], 1, "q"));
    expect(t.frame()).toMatchObject({ animated: false, duration: 260 });
    expect(t.publish).not.toHaveBeenCalled();
    t.finish();
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
});
