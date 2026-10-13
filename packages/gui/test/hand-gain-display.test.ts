import { afterEach, describe, expect, it, vi } from "vitest";
import { HandGainDisplay, HAND_GAIN_DURATION_MS } from "../src/presentation/hand-gain-display";
import type { GameUpdate, HandGainAnnouncement } from "../src/presentation/protocol";

const gain = (key: string): HandGainAnnouncement => ({ key, operator: 1, player: 0, cards: [{ id: key, card: { def: "X", printing: null }, from: "deck" }] });
const update = (extra: Partial<GameUpdate> = {}) => ({ seed: "game", perspective: 0, logReset: false,
  announcement: null, result: null, decision: null, handGains: [], ...extra }) as GameUpdate;

afterEach(() => vi.useRealTimers());

describe("page-local hand gain notices", () => {
  it("expires each notice without waiting for an answer or resetting its lifetime on routine updates", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const display = new HandGainDisplay(changed);
    expect(display.publish(update({ handGains: [gain("1"), gain("2")] }))?.key).toBe("1");
    vi.advanceTimersByTime(HAND_GAIN_DURATION_MS - 1);
    expect(display.publish(update())?.key).toBe("1");
    vi.advanceTimersByTime(1);
    expect(changed).toHaveBeenLastCalledWith(gain("2"));
    vi.advanceTimersByTime(HAND_GAIN_DURATION_MS);
    expect(changed).toHaveBeenLastCalledWith(null);
  });

  it.each([
    { announcement: { seq: 1 } },
    { decision: { decision: { type: "selectCards", reason: "target" } } },
    { decision: { decision: { type: "quick" } } },
    { logReset: true },
    { seed: "new-game" },
    { perspective: 1 },
  ])("discards the whole queue on interruption: %j", (extra) => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const display = new HandGainDisplay(changed);
    display.publish(update({ handGains: [gain("1"), gain("2")] }));
    expect(display.publish(update(extra as Partial<GameUpdate>))).toBeNull();
    vi.runAllTimers();
    expect(display.publish(update())).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it("does not postpone Quick to show gains from the same publication", () => {
    vi.useFakeTimers();
    const display = new HandGainDisplay(vi.fn());
    expect(display.publish(update({ announcement: { seq: 1 } as GameUpdate["announcement"], handGains: [gain("1")] }))).toBeNull();
    expect(display.publish(update())).toBeNull();
    vi.runAllTimers();
  });

  it("closes locally and ignores a stale close button", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const display = new HandGainDisplay(changed);
    display.publish(update({ handGains: [gain("1"), gain("2")] }));
    display.dismiss("stale");
    expect(changed).not.toHaveBeenCalled();
    display.dismiss("1");
    expect(changed).toHaveBeenCalledExactlyOnceWith(null);
    vi.runAllTimers();
    expect(display.publish(update())).toBeNull();
  });
});
