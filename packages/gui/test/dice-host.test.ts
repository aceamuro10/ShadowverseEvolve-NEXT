import { describe, expect, it, vi } from "vitest";
import { createEngine, randomAnswer, script, seedRng, type Answer } from "@sve/core";
import { testFollower } from "@sve/core/testing";
import { GameHost, stateHash } from "../src/engine/game-host";
import type { GameOptions, ToWorker } from "../src/engine/protocol";
import { createPresentationHost } from "../src/presentation/host";
import type { FromWorker, GameUpdate } from "../src/presentation/protocol";

const engine = createEngine({ cards: [testFollower("ROLLER", 1, 1, 10), testFollower("TALENT", 1, 1, 10)], scripts: {
  ROLLER: script.defineCard({ abilities: [script.activated({}, { *resolve(fx) { for (let i = 0; i < 3; i++) yield* fx.rollDie(); } })] }),
  TALENT: script.defineCard({ field: { dieRerolls: 2 } }),
} });
const deck = { main: [...Array(20).fill("ROLLER"), ...Array(20).fill("TALENT")], evolve: [] };
const options: GameOptions = { seed: "dice-host", decks: [deck, deck],
  deckNames: ["A", "B"], controllers: ["human", "human"], deckRestrictions: false, manualActions: true, showEveryMainPhase: true, turnOrder: "player1" };

function setup() {
  const messages: FromWorker[] = [];
  const schedule = vi.fn(() => () => {});
  const a = new GameHost(engine, () => {}, { schedule });
  const b = createPresentationHost(engine, (m) => messages.push(m), { schedule });
  const latest = () => messages.filter((m): m is { kind: "update"; update: GameUpdate } => m.kind === "update").at(-1)!.update;
  const send = (message: ToWorker) => {
    a.handle(message); b.handle(message);
    expect(stateHash(b.session!.state)).toBe(stateHash(a.session!.state));
    expect(b.replay()).toEqual(a.replay());
    expect(b.session!.decision).toEqual(a.session!.decision);
    expect(messages.filter((m) => m.kind === "error")).toEqual([]);
  };
  const act = (input: Answer) => send({ kind: "answer", seat: a.session!.decision!.player, answer: input });
  send({ kind: "start", options });
  const rng = seedRng("setup");
  while (a.session!.decision?.type !== "mainPhase") act(randomAnswer(rng, a.session!.decision!));
  for (const def of ["ROLLER", "TALENT"]) {
    const card = Object.values(a.session!.state.cards).find((c) => c.def === def && c.owner === 0 && c.zone === "hand") ??
      Object.values(a.session!.state.cards).find((c) => c.def === def && c.owner === 0 && c.zone === "deck")!;
    act({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: card.id, to: "field" } } });
  }
  const d = a.session!.decision!;
  if (d.type !== "mainPhase") throw new Error("expected main phase");
  const activate = d.actions.find((action) => action.type === "activate")!;
  return { a, b, messages, send, act, latest, activate, schedule };
}

describe("dice presentation host transport, replay and state equivalence", () => {
  it("publishes the current prompt once and all nine real throws while preserving original inputs and hashes", () => {
    const t = setup();
    t.act({ type: "mainPhase", action: t.activate });
    const all = [...t.latest().diceSteps!];
    expect(t.latest().diePrompt?.key).toBe(all.at(-1)!.key);
    for (let i = 0; i < 6; i++) {
      t.act({ type: "choose", ids: ["reroll"] });
      all.push(...t.latest().diceSteps!);
    }
    expect(all.filter((s) => s.type === "throw")).toHaveLength(9);
    expect(all.filter((s) => s.type === "prompt")).toHaveLength(6);
    expect(t.latest().diePrompt).toBeNull();
    t.send({ kind: "rewind", inputs: t.a.replay()!.inputs.length });
    expect(t.latest().logReset).toBe(true);
    expect(t.latest().diceSteps).toEqual([]);
    t.send({ kind: "watch", replay: t.a.replay()! });
    expect(t.latest().diceSteps).toEqual([]); // validation/seek must not replay historical dice.
    t.send({ kind: "watchControl", playing: false, seek: t.a.replay()!.inputs.length });
    expect(t.latest().diceSteps).toEqual([]);
  });

  it("replay stepping batches every original reroll boundary without requiring new Core events", () => {
    const t = setup();
    t.act({ type: "mainPhase", action: t.activate });
    for (let i = 0; i < 6; i++) t.act({ type: "choose", ids: ["reroll"] });
    const replay = t.a.replay()!;
    const firstRoll = replay.inputs.findIndex(({ input }) => input.type === "mainPhase" && input.action.type === "activate");
    t.send({ kind: "watch", replay });
    t.send({ kind: "watchControl", playing: false, seek: firstRoll });
    t.send({ kind: "watchControl", step: 1 });
    expect(t.latest().diceSteps?.map((s) => s.type)).toEqual(["throw", "prompt"]);
    t.send({ kind: "watchControl", step: 1 });
    expect(t.latest().diceSteps?.map((s) => s.type)).toEqual(["throw", "prompt"]);
    expect(t.schedule.mock.calls.length).toBeGreaterThan(0);
  });

  it("retains intermediate prompts when seven queued remote inputs execute inside one pump", () => {
    const t = setup();
    const prefix = t.a.replay()!.inputs.length;
    const inputs: { index: number; input: Answer; hash: string }[] = [];
    const record = (input: Answer) => {
      inputs.push({ index: t.a.replay()!.inputs.length, input, hash: stateHash(t.a.session!.state) });
      t.act(input);
    };
    record({ type: "mainPhase", action: t.activate });
    for (let i = 0; i < 6; i++) record({ type: "choose", ids: ["reroll"] });
    const replay = t.a.replay()!;
    t.send({ kind: "spectate", options: { ...options, controllers: ["remote", "remote"] }, inputs: replay.inputs.slice(0, prefix) });
    for (const queued of inputs.toReversed()) t.send({ kind: "remoteInput", ...queued });
    expect(t.latest().online?.desync).toBeNull();
    expect(t.latest().inputCount).toBe(prefix + 7);
    expect(t.latest().diceSteps?.filter((s) => s.type === "throw")).toHaveLength(9);
    expect(t.latest().diceSteps?.filter((s) => s.type === "prompt")).toHaveLength(6);
    expect(t.latest().decision).toBeNull();
  });
});
