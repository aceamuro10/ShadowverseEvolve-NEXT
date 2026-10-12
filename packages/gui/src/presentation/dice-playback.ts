import type { DiceStep, GameUpdate } from "./protocol";

export type DiceFrame = Extract<DiceStep, { type: "throw" | "prompt" }> & { animated: boolean; duration: number };
interface Sink {
  block(): void;
  frame(frame: DiceFrame | null): void;
  publish(update: GameUpdate, interactive: boolean): void;
  idle(): void;
}

/** Serial, cosmetic playback. Real rule messages and network progress never wait for this queue. */
export class DicePlayback {
  private queue: GameUpdate[] = [];
  private active: GameUpdate | null = null;
  private finishFrame: (() => void) | null = null;
  private frameKey: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seed: string | null = null;
  private generation = 0;
  private seen = new Set<string>();

  constructor(private readonly sink: Sink, private readonly animated: () => boolean) {}

  enqueue(update: GameUpdate): void {
    if (update.logReset || (this.seed !== null && this.seed !== update.seed)) {
      this.reset();
      this.seed = update.seed;
      this.sink.publish(update, true);
      return;
    }
    this.seed = update.seed;
    this.queue.push(update);
    if (!this.active) this.next();
  }

  /** Called by the visible overlay's animation end, or static-result completion. */
  complete(key: string): void {
    if (key !== this.frameKey) return;
    const finish = this.finishFrame;
    this.finishFrame = null;
    this.frameKey = null;
    finish?.();
  }

  private next(): void {
    const update = this.queue.shift();
    if (!update) {
      this.active = null;
      this.sink.frame(null);
      this.sink.idle();
      return;
    }
    this.active = update;
    const steps = (update.diceSteps ?? []).filter((s) => {
      if (this.seen.has(s.key)) return false;
      this.seen.add(s.key);
      return true;
    });
    const generation = this.generation;
    const show = (index: number): void => {
      if (generation !== this.generation) return;
      const step = steps[index];
      if (!step) {
        this.sink.frame(null);
        this.sink.publish(update, this.queue.length === 0);
        this.next();
        return;
      }
      if (step.type === "settled") return show(index + 1);
      // The terminal human choice uses the actual dialog, after its preceding throw finishes.
      const realChoice = step.type === "prompt" && step.key === update.diePrompt?.key &&
        update.decision?.decision.type === "choose" && update.decision.decision.reason === "dieReroll" && this.queue.length === 0;
      if (realChoice) return show(index + 1);
      this.sink.block();
      const animated = this.animated();
      this.sink.frame({ ...step, animated, duration: step.type === "prompt" ? 400 : animated ? 800 : 260 });
      this.frameKey = step.key;
      this.finishFrame = () => show(index + 1);
      if (step.type === "prompt") {
        this.timer = setTimeout(() => { this.timer = null; this.complete(step.key); }, 400);
      }
    };
    show(0);
  }

  reset(): void {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.active = null;
    this.frameKey = null;
    this.finishFrame = null;
    this.seen.clear();
    this.sink.frame(null);
    this.sink.idle();
  }

  /** Leaving the game shows the latest authoritative update without historical animation. */
  flush(): void {
    const updates = [...(this.active ? [this.active] : []), ...this.queue];
    this.reset();
    updates.forEach((update, i) => this.sink.publish(update, i === updates.length - 1));
  }
}
