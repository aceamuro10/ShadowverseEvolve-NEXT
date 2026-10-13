import type { GameUpdate, HandGainAnnouncement } from "./protocol";

/** A local notification lifetime, independent of engine inputs, replay speed and network progress. */
export const HAND_GAIN_DURATION_MS = 8_000;

export class HandGainDisplay {
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
    // Nothing should reopen after the player finishes the choice.
    const choosingTarget = decision?.type === "selectCards" && decision.reason === "target";
    if (update.logReset || update.result || update.announcement || choosingTarget || decision?.type === "quick") {
      this.clear(false);
    } else {
      // Each publication can contain several gains. The latest eligible result replaces the
      // panel immediately; superseded results never wait in a queue or return after timeout.
      const gain = update.handGains?.findLast((gain) => gain.operator !== update.perspective);
      if (gain && gain.key !== this.current?.key) {
        this.clear(false);
        this.current = gain;
        this.timer = setTimeout(() => this.clear(), HAND_GAIN_DURATION_MS);
      }
    }
    return this.current;
  }

  dismiss(key: string): void {
    if (this.current?.key === key) this.clear();
  }

  clear(notify = true): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.current = null;
    if (notify) this.changed(null);
  }
}
