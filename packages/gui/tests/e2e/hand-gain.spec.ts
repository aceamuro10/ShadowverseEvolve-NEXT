import { expect, test, type Page } from "@playwright/test";
import { startGame, toMainPhase, useSettings } from "./helpers";

async function prepare(page: Page) {
  await useSettings(page, { uiLang: "en", cardLang: "en", animations: false, bgm: false, manualDebug: true, manualSlots: false,
    setupControllers: ["human", "human"], setupTurnOrder: "player1" });
  await startGame(page, "hand-gain-bootstrap");
  await page.evaluate(async () => {
    const { engine } = await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store");
    const deck = { main: [...Array(8).fill("BP02-031"), ...Array(8).fill("BP08-108"), ...Array(4).fill("CP01-080"), ...Array(24).fill("BP01-038")], evolve: ["BP02-032"] };
    engine.send({ kind: "settings", settings: { manualDebug: true } });
    engine.send({ kind: "start", options: { seed: "hand-gain-browser", decks: [deck, deck], deckNames: ["Search", "Search"],
      controllers: ["human", "human"], deckRestrictions: false, manualActions: true, showEveryMainPhase: true, turnOrder: "player1" } });
  });
  await expect.poll(() => page.evaluate(async () => ((await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store"))).getApp().update?.seed)).toBe("hand-gain-browser");
  await toMainPhase(page);
  const order = page.getByTestId("turn-order");
  if (await order.isVisible()) await order.click();
}

async function manual(page: Page, kind: "search" | "field" | "evolve" | "play", def: string) {
  const before = await page.locator(".sve-decision").getAttribute("data-inputs");
  await page.evaluate(async ({ kind, def }) => {
    const { engine, getApp } = await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store");
    const u = getApp().update!;
    let op: import("@sve/core").ManualOp;
    if (kind === "search") op = { kind: "search", player: 0, def };
    else {
      const card = (kind === "evolve" ? u.view.players[0].field : u.view.players[0].hand).find((c) => "def" in c && c.def === def)!;
      if (kind === "field") op = { kind: "move", card: card.id, to: "field" };
      else if (kind === "evolve") op = { kind: "evolve", card: card.id, evolveCard: u.manual!.evolveWith[card.id]![0]!.card, superEvolve: false };
      else op = { kind: "play", card: card.id };
    }
    engine.send({ kind: "answer", seat: 0, answer: { type: "mainPhase", action: { type: "manual", op } } });
  }, { kind, def });
  await expect(page.locator(".sve-decision")).not.toHaveAttribute("data-inputs", before!);
}

async function pick(page: Page, n: number) {
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectCards");
  await page.evaluate(async (n) => {
    const { engine, getApp } = await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store");
    const d = getApp().update!.decision!.decision;
    if (d.type !== "selectCards") throw new Error("expected selection");
    engine.send({ kind: "answer", seat: d.player, answer: { type: "selectCards", cards: d.candidates.slice(0, n) } });
  }, n);
}

test("one's own two-card search does not display a notice or pause controls", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await prepare(page);
  await manual(page, "search", "BP02-031");
  await manual(page, "field", "BP02-031");
  await manual(page, "evolve", "BP02-031");
  await pick(page, 2);
  const notice = page.getByTestId("hand-gain");
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId("decision-dialog")).toHaveCount(0);
  const inputs = await page.locator(".sve-decision").getAttribute("data-inputs");
  await page.getByTestId("table-end").click();
  await expect(page.locator(".sve-decision")).not.toHaveAttribute("data-inputs", inputs!);
  await expect(notice).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Tart Man's number-only deck search does not reveal the selected card", async ({ page }) => {
  await prepare(page);
  await manual(page, "search", "BP08-108");
  await manual(page, "play", "BP08-108");
  await pick(page, 1);
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "mainPhase");
  await expect(page.getByTestId("hand-gain")).toHaveCount(0);
});

test("one's own six-card recovery does not display a notice", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await manual(page, "search", "CP01-080");
  await manual(page, "play", "CP01-080");
  await expect(page.getByTestId("hand-gain")).toHaveCount(0);
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "mainPhase");
});
