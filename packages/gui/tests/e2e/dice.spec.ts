import { expect, test, type Page } from "@playwright/test";
import { startGame, toMainPhase, useSettings } from "./helpers";
import { DICE_TIMING } from "../../src/presentation/dice-timing";

async function prepare(page: Page, animated: boolean, extra: string[] = []) {
  await useSettings(page, { uiLang: "en", cardLang: "ja", animations: animated, bgm: false,
    setupControllers: ["human", "human"], setupTurnOrder: "player1", setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await startGame(page, "dice-bootstrap");
  await page.evaluate(async (extra) => {
    const { engine } = (await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"));
    const main = [...Array(4).fill("ECP02-065"), ...Array(4).fill("BP21-083"), ...Array(4).fill("BP21-080"), ...Array(4).fill("BP21-077"), ...extra.flatMap((id) => Array(4).fill(id)), ...Array(12).fill("BP01-001")];
    engine.send({ kind: "start", options: { seed: "dice-browser", decks: [{ main, evolve: [] }, { main: Array(30).fill("BP01-001"), evolve: [] }],
      deckNames: ["Dice", "Targets"], controllers: ["human", "human"], deckRestrictions: false, manualActions: true, showEveryMainPhase: true, turnOrder: "player1" } });
  }, extra);
  await expect.poll(() => page.evaluate(async () => ((await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"))).getApp().update?.seed)).toBe("dice-browser");
  await toMainPhase(page);
}

async function input(page: Page, build: { kind: "field" | "hand" | "activate" | "play" | "points"; def?: string; owner?: 0 | 1 }) {
  const before = await page.evaluate(async () => ((await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"))).getApp().update!.inputCount);
  await page.evaluate(async (spec) => {
    const { engine, getApp } = (await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"));
    const u = getApp().update!;
    const d = u.decision!.decision;
    if (d.type !== "mainPhase") throw new Error(`Expected main phase, got ${d.type}`);
    let action: import("@sve/core").MainAction;
    if (spec.kind === "points") action = { type: "manual", op: { kind: "points", player: 0, maxPlayPoints: 10, playPoints: 10 } };
    else if (spec.kind === "hand") {
      if (!spec.def) throw new Error("search needs a definition");
      action = { type: "manual", op: { kind: "search", player: spec.owner ?? 0, def: spec.def } };
    }
    else if (spec.kind === "field") {
      const side = u.view.players[spec.owner ?? 0];
      const card = side.hand.find((c) => "def" in c && c.def === spec.def) ?? (spec.owner === 1 ? side.hand[0] : undefined);
      if (!card) throw new Error(`Card ${spec.def} not in hand`);
      action = { type: "manual", op: { kind: "move", card: card.id, to: "field" } };
    } else {
      const found = d.actions.find((a) => a.type === spec.kind && "card" in a && u.view.players[0][spec.kind === "play" ? "hand" : "field"].some((c) => c.id === a.card && "def" in c && c.def === spec.def));
      if (!found) throw new Error(`No ${spec.kind} ${spec.def}`);
      action = found;
    }
    engine.send({ kind: "answer", seat: d.player, answer: { type: "mainPhase", action } });
  }, build);
  if (build.kind !== "activate" && build.kind !== "play") await expect.poll(() => page.evaluate(async () => ((await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"))).getApp().update!.inputCount)).toBeGreaterThan(before);
}

async function field(page: Page, def: string) {
  const inHand = await page.evaluate(async (id) => ((await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"))).getApp().update!.view.players[0].hand.some((c) => "def" in c && c.def === id), def);
  if (!inHand) await input(page, { kind: "hand", def });
  await input(page, { kind: "field", def });
}

async function trace(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { diceTrace: { key: string; phase: string; result: string; dialog: boolean }[]; diceGaps: number[] };
    w.diceTrace = [];
    w.diceGaps = [];
    let key = "";
    let hiddenAt: number | null = null;
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="dice-overlay"]');
      if (!el) {
        if (key && hiddenAt === null) hiddenAt = performance.now();
        return;
      }
      if (key === el.getAttribute("data-frame")) return;
      if (hiddenAt !== null) w.diceGaps.push(performance.now() - hiddenAt);
      hiddenAt = null;
      key = el.getAttribute("data-frame")!;
      w.diceTrace.push({ key, phase: el.getAttribute("data-phase")!, result: el.getAttribute("data-result")!, dialog: !!document.querySelector('[data-testid="decision-dialog"]') });
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
}

test("two Kaede cards show throw, real choice, reroll, real choice, final reroll", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await prepare(page, true);
  await field(page, "ECP02-065"); await field(page, "ECP02-065"); await field(page, "BP21-083");
  await trace(page);
  await input(page, { kind: "activate", def: "BP21-083" });
  await expect(page.getByTestId("dice-overlay")).toBeVisible();
  await expect(page.getByTestId("decision-dialog")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("dice-first-throw.png") });
  await expect(page.getByTestId("dice-overlay")).toHaveCount(0);
  const reroll = page.getByTestId("decision-dialog").getByRole("button", { name: /^Reroll \(now/ });
  await expect(reroll).toBeVisible();
  await reroll.click();
  await expect(page.getByTestId("dice-overlay")).toBeVisible();
  await expect(page.getByTestId("decision-dialog")).toHaveCount(0);
  await expect(reroll).toBeVisible();
  await reroll.click();
  await expect(page.getByTestId("dice-overlay")).toBeVisible();
  await expect(page.getByTestId("decision-dialog")).toHaveCount(0);
  await expect(page.getByTestId("dice-overlay")).toHaveCount(0);
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "mainPhase");
  const recorded = await page.evaluate(() => (window as unknown as { diceTrace: { phase: string; dialog: boolean }[] }).diceTrace);
  expect(recorded.map((f) => f.phase)).toEqual(["throw", "throw", "throw"]);
  expect(recorded.every((f) => !f.dialog)).toBe(true);
  expect(errors).toEqual([]);
});

test("consecutive dice finish before the pending list; reverse selection keeps its result in the compact prompt", async ({ page }) => {
  await prepare(page, false);
  await field(page, "BP21-077");
  await input(page, { kind: "field", owner: 1 }); await input(page, { kind: "field", owner: 1 });
  await input(page, { kind: "points" });
  const have = await page.evaluate(async () => ((await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"))).getApp().update!.view.players[0].hand.some((c) => "def" in c && c.def === "BP21-080"));
  if (!have) await input(page, { kind: "hand", def: "BP21-080" });
  await trace(page);
  await input(page, { kind: "play", def: "BP21-080" });
  // A real card can first ask its normal play method; answer that pre-dice question if present.
  await expect.poll(async () => page.evaluate(async () => {
    const s = ((await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"))).getApp();
    return s.diceBusy || s.update?.decision?.decision.type === "choose";
  })).toBe(true);
  await page.evaluate(async () => {
    const { getApp, engine } = (await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"));
    const d = getApp().update?.decision?.decision;
    if (d?.type === "choose" && d.reason === "playOption") engine.send({ kind: "answer", seat: d.player, answer: { type: "choose", ids: ["normal"] } });
  });
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectPending");
  const pending = page.locator(".sve-pending-option");
  await expect(pending).toHaveCount(2);
  await expect(pending.locator('[data-testid="trigger-die"]')).toHaveCount(2);
  expect(await pending.last().evaluate((el) => {
    const badge = el.querySelector('[data-testid="trigger-die"]')!;
    return badge.parentElement === el.firstElementChild;
  })).toBe(true);
  const point = await pending.last().getByTestId("trigger-die").getAttribute("data-result");
  await pending.last().click();
  await expect(page.getByTestId("table-ability").getByTestId("trigger-die")).toHaveAttribute("data-result", point!);
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.getByTestId("table-ability").locator("summary").getByTestId("trigger-die")).toHaveAttribute("data-result", point!);
  await page.screenshot({ path: test.info().outputPath("dice-trigger-compact.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const recorded = await page.evaluate(() => (window as unknown as { diceTrace: { phase: string }[] }).diceTrace);
  expect(recorded.map((f) => f.phase)).toEqual(["throw", "throw"]);
  const gaps = await page.evaluate(() => (window as unknown as { diceGaps: number[] }).diceGaps);
  expect(gaps).toHaveLength(1);
  expect(gaps[0]).toBeGreaterThanOrEqual(DICE_TIMING.gap - 20);
});

async function orderTrace(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { diceOrder: { kind: string; key: string; at: number }[] };
    w.diceOrder = [];
    for (const event of ["animationstart", "animationend"] as const) document.addEventListener(event, (e) => {
      const target = e.target as HTMLElement;
      if (e.animationName.startsWith("sve-showcase-wipe")) w.diceOrder.push({ kind: `card:${event}`, key: target.parentElement!.dataset.showcase!, at: performance.now() });
      if (target.classList.contains("sve-die-rolling") && event === "animationend") w.diceOrder.push({ kind: "landed", key: target.parentElement!.dataset.frame!, at: performance.now() });
    }, true);
    let key = "";
    new MutationObserver(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="dice-overlay"]');
      if (!el) {
        if (key) w.diceOrder.push({ kind: "hidden", key, at: performance.now() });
        key = "";
      } else if (el.dataset.frame !== key) {
        key = el.dataset.frame!;
        w.diceOrder.push({ kind: "throw", key, at: performance.now() });
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
}

async function normalPlay(page: Page, def: string) {
  await input(page, { kind: "hand", def });
  await input(page, { kind: "points" });
  await input(page, { kind: "play", def });
  await expect.poll(() => page.evaluate(async () => {
    const { getApp } = (await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"));
    const u = getApp().authoritative;
    return !!u?.diceSteps?.length || (u?.decision?.decision.type === "choose" && u.decision.decision.reason === "playOption");
  })).toBe(true);
  await page.evaluate(async () => {
    const { getApp, engine } = (await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"));
    const d = getApp().update?.decision?.decision;
    if (d?.type === "choose" && d.reason === "playOption") engine.send({ kind: "answer", seat: d.player, answer: { type: "choose", ids: ["normal"] } });
  });
}

for (const [def, rolls] of [["BP21-081", 1], ["BP21-080", 2], ["BP06-110", 2]] as const) {
  test(`${def}: the played-card animation finishes before automatic dice, with a readable landed hold`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await prepare(page, true, [def]);
    await orderTrace(page);
    await normalPlay(page, def);
    await expect(page.getByTestId("showcase")).toBeVisible();
    await expect(page.getByTestId("dice-overlay")).toHaveCount(0);
    await expect(page.getByTestId("dice-overlay")).toBeVisible();
    await expect(page.getByTestId("showcase")).toHaveCount(0);
    await expect(page.getByTestId("dice-overlay")).toHaveCount(0);
    await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "mainPhase");
    const order = await page.evaluate(() => (window as unknown as { diceOrder: { kind: string; key: string; at: number }[] }).diceOrder);
    expect(order.filter((s) => s.kind === "card:animationstart")).toHaveLength(1);
    const end = order.find((s) => s.kind === "card:animationend")!;
    const throws = order.filter((s) => s.kind === "throw");
    expect(throws).toHaveLength(rolls);
    expect(throws[0]!.at).toBeGreaterThanOrEqual(end.at);
    for (const landed of order.filter((s) => s.kind === "landed")) {
      const next = order.find((s) => s.at > landed.at && (s.kind === "hidden" || s.kind === "throw"))!;
      expect(next.at - landed.at).toBeGreaterThanOrEqual(DICE_TIMING.hold - 50);
    }
    const published = await page.evaluate(async (def) => {
      const { getApp } = (await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"));
      const s = getApp();
      return { plays: s.log.filter((e) => e.event.type === "cardPlayed" && e.event.def === def).length,
        rolls: s.log.filter((e) => e.event.type === "dieRolled").length, current: s.update === s.authoritative, busy: s.diceBusy };
    }, def);
    expect(published).toEqual({ plays: 1, rolls, current: true, busy: false });
    expect(errors).toEqual([]);
  });
}

test("CP01-081: a sole main-phase trigger waits for the preceding draw animation", async ({ page }) => {
  await prepare(page, true, ["CP01-081"]);
  await field(page, "CP01-081");
  const end = async () => page.evaluate(async () => {
    const { getApp, engine } = (await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"));
    const d = getApp().update!.decision!.decision;
    if (d.type !== "mainPhase") throw new Error("main phase required");
    const action = d.actions.find((a) => a.type === "endMainPhase")!;
    engine.send({ kind: "answer", seat: d.player, answer: { type: "mainPhase", action } });
  });
  await end();
  await expect.poll(() => page.evaluate(async () => {
    const { getApp } = (await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"));
    return getApp().update?.view.activePlayer;
  })).toBe(1);
  await toMainPhase(page);
  await page.evaluate(() => {
    const w = window as unknown as { diceDrawOrder: { kind: string; at: number; ghosts?: number; floats?: number }[] };
    w.diceDrawOrder = [];
    let ghosts = new Set<Element>();
    let seen = false;
    new MutationObserver(() => {
      const next = new Set(document.querySelectorAll(".sve-ghost"));
      if ([...ghosts].some((el) => !next.has(el))) w.diceDrawOrder.push({ kind: "flight:end", at: performance.now() });
      if ([...next].some((el) => !ghosts.has(el))) w.diceDrawOrder.push({ kind: "flight:start", at: performance.now() });
      ghosts = next;
      if (!seen && document.querySelector('[data-testid="dice-overlay"]')) {
        seen = true;
        w.diceDrawOrder.push({ kind: "throw", at: performance.now(), ghosts: next.size, floats: document.querySelectorAll(".sve-float").length });
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await end();
  await expect(page.getByTestId("dice-overlay")).toBeVisible();
  await expect(page.getByTestId("decision-dialog")).toHaveCount(0);
  await expect(page.getByTestId("dice-overlay")).toHaveCount(0);
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "mainPhase");
  const order = await page.evaluate(() => (window as unknown as { diceDrawOrder: { kind: string; at: number; ghosts?: number; floats?: number }[] }).diceDrawOrder);
  const thrown = order.find((s) => s.kind === "throw")!;
  expect(thrown).toMatchObject({ ghosts: 0, floats: 0 });
  expect(order.some((s) => s.kind === "flight:end" && s.at <= thrown.at)).toBe(true);
});
