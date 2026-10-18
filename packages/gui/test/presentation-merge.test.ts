import { describe, expect, it } from "vitest";
import { createEngine, type Answer, type Engine } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, testFollower } from "@sve/core/testing";
import { GameHost, stateHash } from "../src/engine/game-host";
import type { FromWorker as EngineMessage, GameOptions } from "../src/engine/protocol";
import { createPresentationHost } from "../src/presentation/host";
import type { FromWorker, GameUpdate } from "../src/presentation/protocol";

// A real midgame fixture gives both hosts the same Ameth/UB position without depending on shuffled opening hands.
const core = createEngine({ cards: [...ALL_CARDS, testFollower("PLAIN", 0, 1, 20)], scripts: ALL_SCRIPTS });
const engine: Engine = new Proxy(core, { get(target, key) {
  if (key === "newGame") return () => {
    const t = drive(core, { me: { universe: "princessConnect", field: ["CP04-113", "CP04-021", "CP04-001"],
      evolveDeck: ["CP04-114"], deck: Array(10).fill("PLAIN"), playPoints: 10 },
      opp: { field: ["PLAIN", "PLAIN"] }, config: { autoResolve: ["quick", "selectPending"] } });
    t.game.state.players[0].thisTurn = { ...t.game.state.players[0].thisTurn, turn: t.game.state.turn, unionBursts: 2 };
    return t.game;
  };
  const value = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
} });

describe("main processing with gui-dev presentation", () => {
  it("keeps main's identities and fills only the missing free-UB target identity, with identical real games", () => {
    const original: EngineMessage[] = [], decorated: FromWorker[] = [];
    const scheduler = { schedule: () => () => {} };
    const plain = new GameHost(engine, (m) => original.push(m), scheduler);
    const gui = createPresentationHost(engine, (m) => decorated.push(m), scheduler);
    const options: GameOptions = { seed: "merge-ub", decks: [{ main: [], evolve: [] }, { main: [], evolve: [] }],
      deckNames: ["A", "B"], controllers: ["human", "human"], deckRestrictions: false };
    plain.handle({ kind: "start", options }); gui.handle({ kind: "start", options });
    const latest = (messages: EngineMessage[]) => messages.filter((m) => m.kind === "update").at(-1)!.update;
    const act = (input: Answer) => {
      const player = plain.session!.decision!.player;
      plain.handle({ kind: "answer", seat: player, answer: input });
      gui.handle({ kind: "answer", seat: player, answer: input });
      expect(stateHash(gui.session!.state)).toBe(stateHash(plain.session!.state));
      expect(gui.session!.decision).toEqual(plain.session!.decision);
      expect(gui.replay()).toEqual(plain.replay());
      expect(decorated.filter((m) => m.kind === "error")).toEqual([]);
      return latest(decorated) as GameUpdate;
    };
    const first = plain.session!.decision!;
    if (first.type !== "mainPhase") throw new Error("expected main phase");
    const source = Object.values(plain.session!.state.cards).find((c) => c.def === "CP04-113" && c.zone === "field")!.id;
    const action = first.actions.find((a) => a.type === "evolve" && a.card === source)!;
    const parent = act({ type: "mainPhase", action });
    expect(parent.decision?.processing).toEqual(latest(original).decision?.processing);
    act({ type: "choose", ids: ["2"] });
    const recipient = Object.values(plain.session!.state.cards).find((c) => c.def === "CP04-021" && c.zone === "field")!.id;
    const child = act({ type: "selectCards", cards: [recipient] });
    expect(latest(original).decision?.processing).toBeUndefined();
    expect(child.decision?.processing).toMatchObject({ kind: "ability", source: recipient,
      ability: { sourceDef: "CP04-021", kind: "automatic", timing: "strike", rank: 0, count: 1 } });
    expect(child.effectContext?.instanceId).toMatch(/:freeUB$/);
  });
});
