import type { Decision, GameEvent, Input } from "@sve/core";
import type { DiceStep, DiePrompt } from "./protocol";

let sessionSerial = 0;

/** Only the runtime reroll choice carries intermediate results. Never inspect RNG or replay an input. */
export function rerollResult(d: Decision | null): { player: 0 | 1; result: number } | null {
  if (d?.type !== "choose" || d.reason !== "dieReroll" || d.options.length !== 2) return null;
  const keep = /^Keep ([1-6])$/.exec(d.options.find((o) => o.id === "keep")?.label ?? "");
  const reroll = /^Reroll ([1-6])$/.exec(d.options.find((o) => o.id === "reroll")?.label ?? "");
  return keep && reroll && keep[1] === reroll[1] ? { player: d.player, result: Number(keep[1]) } : null;
}

/** Session-local, cosmetic identities. Nothing is written to game state, sequence counters or events. */
export class DiceObserver {
  private readonly prefix = `dice-session:${++sessionSerial}`;
  private serial = 0;
  private steps: DiceStep[] = [];
  private eventCount = 0;
  private active: { player: 0 | 1; result: number } | null = null;
  prompt: DiePrompt | null = null;

  constructor(events: readonly GameEvent[] = [], decision: Decision | null = null) {
    this.observe(null, null, events, decision);
  }

  private key(): string { return `${this.prefix}:${++this.serial}`; }
  private thrown(player: 0 | 1, result: number, reroll: boolean): void {
    this.steps.push({ type: "throw", key: this.key(), player, result, reroll, afterEvents: this.eventCount });
  }

  /** Call only after a successful real act. Every reroll choice is a separate actual act boundary. */
  observe(before: Decision | null, input: Input | null, events: readonly GameEvent[], after: Decision | null): void {
    const previous = rerollResult(before);
    const answer = previous && input?.type === "choose" ? input.ids[0] : undefined;
    let finishing = this.active;
    this.prompt = null;
    for (const event of events) {
      if (event.type !== "dieRolled") {
        if (event.type !== "cardsLookedAt") this.eventCount++;
        continue;
      }
      if (finishing && previous && event.player === finishing.player && (answer === "keep" || answer === "reroll")) {
        // Keep confirms an already shown throw; the last reroll has no following choice to carry its result.
        if (answer === "reroll" || event.result !== finishing.result) this.thrown(event.player, event.result, answer === "reroll");
        finishing = null;
        this.active = null;
      } else {
        this.thrown(event.player, event.result, false);
      }
      this.eventCount++;
      this.steps.push({ type: "settled", key: this.key(), player: event.player, result: event.result, afterEvents: this.eventCount });
    }
    const current = rerollResult(after);
    if (current) {
      this.thrown(current.player, current.result, !!finishing && answer === "reroll");
      this.active = current;
      this.prompt = { key: this.key(), ...current };
      this.steps.push({ type: "prompt", ...this.prompt, afterEvents: this.eventCount });
    } else this.active = null;
  }

  drain(reset = false): DiceStep[] {
    const steps = this.steps;
    this.steps = [];
    this.eventCount = 0;
    return reset ? [] : steps;
  }
}
