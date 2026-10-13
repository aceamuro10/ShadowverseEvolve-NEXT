import { afterEach, describe, expect, it, vi } from "vitest";
import { HandGainGate } from "../src/presentation/hand-gain-gate";
import type { GameUpdate, HandGainAnnouncement } from "../src/presentation/protocol";

const gain = (key: string): HandGainAnnouncement => ({ key, player: 0, cards: [{ id: key, card: { def: "X", printing: null }, from: "deck" }] });
// The gate reads only pacing fields; the actual session/state behavior is tested with real hosts in hand-gain.test.ts.
const update = (extra: Partial<GameUpdate> = {}) => ({ controllers: ["human", "remote"], settings: { paused: false }, log: [], diceSteps: [],
  announcement: null, watch: null, online: null, logReset: false, decision: { decision: { type: "mainPhase" } }, ...extra }) as GameUpdate;
const scheduler = { schedule(fn: () => void, ms: number) { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); } };
afterEach(() => vi.useRealTimers());

describe("local hand gain pacing", () => {
  it("holds automatic callbacks until all notices are seen, and honors cancellation", () => {
    vi.useFakeTimers();
    const sent: GameUpdate[] = [];
    const gate = new HandGainGate((u) => sent.push(u), scheduler);
    const run = vi.fn(); const cancelled = vi.fn();
    gate.publish(update(), [gain("1"), gain("2")]);
    gate.scheduler().schedule(run, 10);
    const cancel = gate.scheduler().schedule(cancelled, 10);
    vi.advanceTimersByTime(10); cancel();
    expect(run).not.toHaveBeenCalled();
    gate.handle({ kind: "handGainSeen", key: "1" }, () => {});
    expect(sent.at(-1)?.handGain?.key).toBe("2");
    vi.advanceTimersByTime(10);
    expect(run).not.toHaveBeenCalled();
    gate.handle({ kind: "handGainSeen", key: "2" }, () => {});
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
    expect(sent.at(-1)?.decision).not.toBeNull();
  });

  it("automatically advances bot/replay displays, while spectators confirm locally", () => {
    vi.useFakeTimers();
    for (const [extra, auto] of [
      [{ controllers: ["random", "random"] }, true],
      [{ watch: { playing: true } }, true],
      [{ watch: { playing: false } }, false],
      [{ controllers: ["remote", "remote"], online: { spectating: true } }, false],
    ] as const) {
      const sent: GameUpdate[] = [];
      const gate = new HandGainGate((u) => sent.push(u), scheduler);
      gate.publish(update(extra as Partial<GameUpdate>), [gain("1")]);
      vi.advanceTimersByTime(2200);
      expect(!!sent.at(-1)?.handGain).toBe(!auto);
    }
  });

  it("drops stale notices, timers and queued remote inputs on a new game", () => {
    vi.useFakeTimers();
    const sent: GameUpdate[] = []; const delegate = vi.fn();
    const gate = new HandGainGate((u) => sent.push(u), scheduler);
    gate.publish(update(), [gain("1")]);
    gate.handle({ kind: "remoteInput", index: 2, input: { type: "quick", action: { type: "pass" } }, hash: "hash" }, delegate);
    gate.publish(update({ logReset: true }), []);
    gate.handle({ kind: "handGainSeen", key: "1" }, delegate);
    vi.runAllTimers();
    expect(sent.at(-1)?.handGain).toBeNull();
    expect(delegate).not.toHaveBeenCalled();
  });

  it("keeps automatic notices until the preceding dice playback has had time to finish", () => {
    vi.useFakeTimers();
    const sent: GameUpdate[] = [];
    const gate = new HandGainGate((u) => sent.push(u), scheduler);
    gate.publish(update({ controllers: ["random", "random"] }), [gain("1")], 5000);
    vi.advanceTimersByTime(5000);
    expect(sent.at(-1)?.handGain?.key).toBe("1");
    vi.advanceTimersByTime(2200);
    expect(sent.at(-1)?.handGain).toBeNull();
  });

  it("releases a replay Quick summary before the hand gain without playing another rule input", () => {
    vi.useFakeTimers();
    const sent: GameUpdate[] = []; const delegate = vi.fn();
    const gate = new HandGainGate((u) => sent.push(u), scheduler);
    gate.handle({ kind: "settings", settings: {} }, delegate);
    delegate.mockClear();
    gate.publish(update({ watch: { playing: true, speed: 1 } as GameUpdate["watch"], announcement: { seq: 7 } as GameUpdate["announcement"] }), [gain("1")]);
    vi.advanceTimersByTime(1800);
    expect(delegate).toHaveBeenCalledExactlyOnceWith({ kind: "acknowledge", seq: 7 });
    gate.publish(update({ watch: { playing: true, speed: 1 } as GameUpdate["watch"] }), []);
    expect(sent.at(-1)?.handGain?.key).toBe("1");
    expect(sent.at(-1)?.decision).toBeNull();
  });
});
