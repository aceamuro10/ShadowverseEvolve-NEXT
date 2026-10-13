import type { Engine } from "@sve/core";
import { GameHost, timerScheduler, type GameHostOptions, type Scheduler } from "../engine/game-host";
import { cardRuntimeDetails } from "./card-details";
import { observePresentationEngine } from "./effect-context";
import type { FromWorker } from "./protocol";
import { DICE_TIMING } from "./dice-timing";

/**
 * Outside the online fingerprint: observe actual inputs and extend output. The underlying host
 * owns scheduling/state; each act is delegated once. Non-update messages pass through intact.
 */
export function createPresentationHost(
  engine: Engine,
  send: (message: FromWorker) => void,
  scheduler: Scheduler = timerScheduler,
  options: GameHostOptions = {},
): GameHost {
  const observed = observePresentationEngine(engine);
  let displayUntil = 0;
  // Automatic bot/replay progression leaves room for serial playback. Actual dialog release still
  // depends on the page's animation completion. Hand-gain notices never participate in scheduling.
  const paced: Scheduler = { schedule: (fn, ms) => scheduler.schedule(fn, Math.max(ms, displayUntil - Date.now())) };
  // GameHost's constructor does not publish. Every update is sent synchronously with an active session.
  const host = new GameHost(observed.engine, (message) => {
    if (message.kind !== "update") return send(message);
    const session = host.session!;
    const cardDetails = cardRuntimeDetails(session.reader(), engine.scripts, message.update.view);
    const observer = observed.observers.get(session)!;
    const abilities = observer.presentation(message.update);
    const diceSteps = observer.dice.drain(message.update.logReset);
    if (message.update.logReset) displayUntil = 0;
    else {
      const throwBudget = Math.max(DICE_TIMING.roll + DICE_TIMING.hold + DICE_TIMING.fallback, DICE_TIMING.hold + DICE_TIMING.gap);
      const budget = diceSteps.reduce((ms, step) => ms + (step.type === "throw" ? throwBudget : step.type === "prompt" ? DICE_TIMING.inquiry : 0), 0);
      if (budget) displayUntil = Math.max(displayUntil, Date.now()) + budget;
    }
    send({ kind: "update", update: { ...message.update, cardDetails, ...abilities, diceSteps, diePrompt: observer.dice.prompt,
      handGains: observer.handGains.drain(message.update.logReset) } });
  }, paced, options);
  return host;
}
