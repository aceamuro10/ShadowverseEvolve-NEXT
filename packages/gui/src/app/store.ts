// The app's state: what the engine worker published (catalog, the game's latest update, the log) and the errors to show.
// Components read it with useApp(select); only the worker's messages change it.
import { useSyncExternalStore } from "react";
import { EngineClient } from "../engine/client";
import type { LogEntry } from "../engine/protocol";
import type { GameUpdate } from "../presentation/protocol";
import { playUpdateSounds } from "../resources/sound";
import { Catalog } from "./catalog";
import { getSettings } from "./settings";
import { DicePlayback, type DiceFrame } from "../presentation/dice-playback";
import { tableAnimations } from "../presentation/animation-barrier";

export interface AppError {
  id: number;
  message: string;
}

export interface AppState {
  ready: boolean;
  /** The engine failed to start. */
  startError: string | null;
  catalog: Catalog | null;
  update: GameUpdate | null;
  log: LogEntry[];
  errors: AppError[];
  authoritative: GameUpdate | null;
  dice: DiceFrame | null;
  diceBusy: boolean;
}

let state: AppState = { ready: false, startError: null, catalog: null, update: null, log: [], errors: [], authoritative: null, dice: null, diceBusy: false };
const listeners = new Set<() => void>();

/** The state now, outside React (online play reads how far the game is). */
export function getApp(): AppState {
  return state;
}

function setState(change: Partial<AppState>): void {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

/** The engine worker (one for the whole app). */
export const engine = new EngineClient();

let nextError = 1;

const beforeUpdate = new Set<(update: GameUpdate) => void>();

/** Run `fn` with each update just before it is shown (the table's animations note where the cards were). */
export function onBeforeUpdate(fn: (update: GameUpdate) => void): () => void {
  beforeUpdate.add(fn);
  return () => beforeUpdate.delete(fn);
}

function publishUpdate(update: GameUpdate, interactive: boolean, appendLog = true): void {
  if (update.logReset) tableAnimations.reset();
  update.animationKey = diceScreenActive ? tableAnimations.reserve() : undefined;
  for (const fn of beforeUpdate) fn(update);
  playUpdateSounds({ ...update, log: update.animationLog ?? update.log }, state.update?.view ?? null, state.catalog, state.update?.announcement?.seq ?? null);
  const allowed = interactive && update === state.authoritative;
  setState({ update: allowed ? update : { ...update, decision: null, manual: null, announcement: null, looked: null, handGain: null },
    log: appendLog ? update.logReset ? update.log : [...state.log, ...update.log] : state.log, diceBusy: !allowed });
}

export const dicePlayback = new DicePlayback({
  block: () => {
    const update = state.update ? { ...state.update, decision: null, manual: null, announcement: null, looked: null, handGain: null, effectContext: null, log: [], animationLog: [], animationKey: undefined } : null;
    if (update) for (const fn of beforeUpdate) fn(update);
    setState({ diceBusy: true, ...(update ? { update } : {}) });
  },
  frame: (dice) => setState({ dice }),
  publish: publishUpdate,
  idle: () => setState({ diceBusy: false }),
  animate: (update, entries, done) => {
    publishUpdate({ ...update, log: [], animationLog: entries, effectContext: null, decision: null, manual: null, announcement: null, looked: null, handGain: null }, false, false);
    void tableAnimations.wait().then(done);
  },
  waitForAnimations: (done) => { void tableAnimations.wait().then(done); },
  resetAnimations: () => tableAnimations.reset(),
}, () => getSettings().animations && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

let diceScreenActive = false;
export function setDiceScreenActive(active: boolean): void {
  diceScreenActive = active;
  if (!active) dicePlayback.flush();
}

engine.subscribe((message) => {
  switch (message.kind) {
    case "ready":
      setState({ ready: true, catalog: new Catalog(message.catalog) });
      break;
    case "update": {
      const update = message.update;
      setState({ authoritative: update });
      if (diceScreenActive) dicePlayback.enqueue(update);
      else { dicePlayback.reset(); publishUpdate(update, true); }
      break;
    }
    case "error":
      setState({
        ...(state.ready ? {} : { startError: message.message }),
        errors: [...state.errors, { id: nextError++, message: message.message }].slice(-8),
      });
      break;
    default:
      break;
  }
});

export function reportError(message: string): void {
  setState({ errors: [...state.errors, { id: nextError++, message }].slice(-8) });
}

export function dismissError(id: number): void {
  setState({ errors: state.errors.filter((e) => e.id !== id) });
}

/** Read part of the state; the selector must return a value from the state (not a new object), or React re-renders forever. */
export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
  );
}
