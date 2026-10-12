import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimationBarrier } from "../src/presentation/animation-barrier";

afterEach(() => vi.useRealTimers());

describe("table animation completion before dice", () => {
  it("waits for render and all actual animations, including work scheduled after rendering", async () => {
    vi.useFakeTimers();
    const barrier = new AnimationBarrier();
    const key = barrier.reserve();
    const finished = vi.fn();
    const wait = barrier.wait().then(finished);
    const card = barrier.task(key);
    const delayedEffect = barrier.task(key);
    barrier.started(key);
    card(); card();
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    const flight = barrier.task(key);
    delayedEffect();
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    flight(); await wait;
    expect(finished).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases abandoned renders on reset without affecting the new animation batch", async () => {
    vi.useFakeTimers();
    const barrier = new AnimationBarrier();
    const old = barrier.reserve();
    const oldDone = barrier.task(old);
    const oldWait = barrier.wait();
    barrier.reset(); await oldWait;
    const current = barrier.reserve();
    const completed = vi.fn();
    const wait = barrier.wait().then(completed);
    oldDone();
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    barrier.started(current); await wait;
    expect(completed).toHaveBeenCalledTimes(1);
  });
});
