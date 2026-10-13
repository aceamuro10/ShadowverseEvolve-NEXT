import type { GameUpdate, HandGainAnnouncement } from "./protocol";

/** A local notification lifetime, independent of engine inputs, replay speed and network progress. */
export const HAND_GAIN_DURATION_MS = 8_000;

export class HandGainDisplay {
  private queue: HandGainAnnouncement[] = [];
  private current: HandGainAnnouncement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seed: string | null = null;
  private perspective: GameUpdate["perspective"] | null = null;

  constructor(private readonly changed: (gain: HandGainAnnouncement | null) => void) {}

  /** Called once per visible engine publication, after preceding dice playback finishes. */
  publish(update: GameUpdate): HandGainAnnouncement | null {
    if (update.logReset || this.seed !== update.seed || this.perspective !== update.perspective) this.clear(false);
    this.seed = update.seed;
    this.perspective = update.perspective;
    const decision = update.decision?.decision;
    // Give target choices and both the Quick opportunity and its resolution summary the whole screen.
    // Discard pending notices too: nothing should reopen after the player finishes the choice.
    const choosingTarget = decision?.type === "selectCards" && decision.reason === "target";
    if (update.logReset || update.result || update.announcement || choosingTarget || decision?.type === "quick") {
      this.clear(false);
    } else {
      this.queue.push(...(update.handGains ?? []));
      if (!this.current) this.next(false);
    }
    return this.current;
  }

  dismiss(key: string): void {
    if (this.current?.key === key) this.clear();
  }

  clear(notify = true): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.current = null;
    if (notify) this.changed(null);
  }

  private next(notify: boolean): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.current = this.queue.shift() ?? null;
    this.timer = this.current ? setTimeout(() => this.next(true), HAND_GAIN_DURATION_MS) : null;
    if (notify) this.changed(this.current);
  }
}
