import type { Scheduler } from "../engine/game-host";
import type { GameUpdate, HandGainAnnouncement, ToWorker } from "./protocol";

/** Local pacing only: no synthetic rule answers, protocol changes or session mutations. */
export class HandGainGate {
  private queue: HandGainAnnouncement[] = [];
  private latest: GameUpdate | null = null;
  private remote: ToWorker[] = [];
  private delayed = new Set<{ run(): void; cancelled: boolean }>();
  private cancelAuto: (() => void) | null = null;
  private readyAt = 0;

  constructor(private readonly send: (update: GameUpdate) => void, private readonly base: Scheduler) {}

  scheduler(): Scheduler {
    return { schedule: (fn, ms) => {
      const task = { run: fn, cancelled: false };
      const cancel = this.base.schedule(() => {
        if (task.cancelled) return;
        if (this.queue.length) this.delayed.add(task);
        else fn();
      }, ms);
      return () => { task.cancelled = true; cancel(); this.delayed.delete(task); };
    } };
  }

  publish(update: GameUpdate, gains: HandGainAnnouncement[], displayDelayMs = 0): void {
    if (update.logReset) this.reset();
    this.latest = update;
    this.readyAt = Math.max(this.readyAt, Date.now() + displayDelayMs);
    this.queue.push(...gains);
    this.render(false);
  }

  private render(synthetic: boolean): void {
    if (!this.latest) return;
    this.cancelAuto?.();
    this.cancelAuto = null;
    const update = this.latest;
    const gain = update.announcement ? null : this.queue[0] ?? null;
    this.send({ ...update,
      ...(synthetic ? { log: [], logReset: false, diceSteps: [], animationLog: [] } : {}),
      ...(this.queue.length ? { decision: null, manual: null, looked: null, result: null, thinking: false } : {}),
      handGain: gain,
    });
    const automatic = update.watch ? update.watch.playing : !update.controllers.includes("human") && !update.online?.spectating && !update.settings.paused;
    const delay = Math.max(0, this.readyAt - Date.now());
    if (gain && automatic) this.cancelAuto = this.base.schedule(() => this.seen(gain.key), delay + 2200);
    // Replay Quick windows have no OK button. Release that summary locally before its hand gain,
    // without executing the replay's next rule input (which the scheduler is currently holding).
    if (this.queue.length && update.watch && update.announcement) {
      const seq = update.announcement.seq;
      this.cancelAuto = this.base.schedule(() => this.delegate?.({ kind: "acknowledge", seq }), delay + 1800 / update.watch.speed);
    }
  }

  private reset(): void {
    this.cancelAuto?.();
    this.cancelAuto = null;
    this.queue = [];
    this.remote = [];
    this.delayed.clear();
    this.readyAt = 0;
  }

  private delegate: ((message: ToWorker) => void) | null = null;

  private seen(key: string): void {
    if (this.latest?.announcement || this.queue[0]?.key !== key) return;
    this.queue.shift();
    this.render(true);
    if (this.queue.length) return;
    // Host cancellation still owns each callback; a new publication may cancel it before it runs.
    const tasks = [...this.delayed];
    this.delayed.clear();
    for (const task of tasks) this.base.schedule(() => {
      if (task.cancelled) return;
      if (this.queue.length) this.delayed.add(task);
      else task.run();
    }, 0);
    while (!this.queue.length && this.remote.length) this.delegate?.(this.remote.shift()!);
  }

  handle(message: ToWorker, delegate: (message: ToWorker) => void): void {
    this.delegate = delegate;
    if (message.kind === "handGainSeen") return this.seen(message.key);
    const resetting = ["start", "spectate", "loadReplay", "watch", "rewind", "takeBack", "concede"].includes(message.kind) ||
      (message.kind === "watchControl" && (message.seek !== undefined || message.step !== undefined)) ||
      (message.kind === "remoteInput" && message.input.type === "concede");
    if (resetting) this.reset();
    if (this.queue.length && message.kind === "remoteInput") { this.remote.push(message); return; }
    if (this.queue.length && (message.kind === "answer" || message.kind === "step" || message.kind === "lookSeen")) return;
    delegate(message);
  }
}
