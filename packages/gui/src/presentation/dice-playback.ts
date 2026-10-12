import type { DiceStep, GameUpdate } from "./protocol";
import type { LogEntry } from "../engine/protocol";
import { DICE_TIMING } from "./dice-timing";

export type DiceFrame = Extract<DiceStep, { type: "throw" | "prompt" }> & { animated: boolean; duration: number; hold: number };
interface Sink {
  block(): void;
  frame(frame: DiceFrame | null): void;
  publish(update: GameUpdate, interactive: boolean): void;
  idle(): void;
  /** Play only these cosmetics, with all decisions masked and without appending the rule log. */
  animate?(update: GameUpdate, entries: LogEntry[], done: () => void): void;
  waitForAnimations?(done: () => void): void;
  resetAnimations?(): void;
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
  private holding = false;
  private gapAfterFrame = false;
  private introducedPlays = new Set<string>();

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

  /** Called after the visible result's hold, or by its background-tab fallback. */
  complete(key: string): void {
    if (key !== this.frameKey) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const finish = this.finishFrame;
    this.finishFrame = null;
    this.frameKey = null;
    const gap = this.gapAfterFrame;
    this.gapAfterFrame = false;
    if (gap) {
      this.sink.frame(null);
      this.timer = setTimeout(() => { this.timer = null; finish?.(); }, DICE_TIMING.gap);
    } else finish?.();
  }

  /** Motion has ended; keep this exact result visible before releasing the next step. */
  landed(key: string): void {
    if (key !== this.frameKey || this.holding) return;
    this.holding = true;
    this.timer = setTimeout(() => { this.timer = null; this.complete(key); }, DICE_TIMING.hold);
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
    let cursor = 0;
    let events = 0;
    if (steps.length && this.sink.animate) update.animationGroup = steps[0]!.key;
    const show = (index: number): void => {
      if (generation !== this.generation) return;
      const step = steps[index];
      if (!step) {
        this.sink.frame(null);
        if (steps.length && this.sink.animate) update.animationLog = update.log.slice(cursor);
        if (update.announcement && this.introducedPlays.has(update.announcement.source)) update.announcementIntroduced = true;
        this.sink.publish(update, this.queue.length === 0);
        this.next();
        return;
      }
      if (step.type === "settled") return show(index + 1);
      // The observer anchors throws to actual act/event boundaries, also in batched replay/remote updates.
      const start = cursor;
      while (cursor < update.log.length && events < (step.afterEvents ?? 0)) {
        if (update.log[cursor]!.event.type !== "cardsLookedAt") events++;
        cursor++;
      }
      if (cursor > start && this.sink.animate) {
        for (const { event } of update.log.slice(start, cursor)) {
          if (event.type === "cardPlayed") this.introducedPlays.add(event.card);
        }
        this.sink.frame(null);
        this.sink.block();
        this.sink.animate(update, update.log.slice(start, cursor), () => {
          if (generation === this.generation) show(index);
        });
        return;
      }
      // The terminal human choice uses the actual dialog, after its preceding throw finishes.
      const realChoice = step.type === "prompt" && step.key === update.diePrompt?.key &&
        update.decision?.decision.type === "choose" && update.decision.decision.reason === "dieReroll" && this.queue.length === 0;
      if (realChoice) return show(index + 1);
      this.sink.block();
      const animated = this.animated();
      this.frameKey = step.key;
      this.holding = false;
      this.gapAfterFrame = step.type === "throw" && !animated;
      this.finishFrame = () => show(index + 1);
      this.sink.frame({ ...step, animated, duration: step.type === "prompt" ? DICE_TIMING.inquiry : animated ? DICE_TIMING.roll : DICE_TIMING.hold,
        hold: step.type === "throw" && animated ? DICE_TIMING.hold : 0 });
      if (step.type === "prompt") {
        this.timer = setTimeout(() => { this.timer = null; this.complete(step.key); }, DICE_TIMING.inquiry);
      }
    };
    if (steps.length && this.sink.waitForAnimations) {
      this.sink.block();
      this.sink.waitForAnimations(() => { if (generation === this.generation) show(0); });
    } else show(0);
  }

  reset(): void {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.active = null;
    this.frameKey = null;
    this.finishFrame = null;
    this.gapAfterFrame = false;
    this.seen.clear();
    this.introducedPlays.clear();
    this.sink.resetAnimations?.();
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
