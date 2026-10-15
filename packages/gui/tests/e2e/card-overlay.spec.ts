import { expect, test, type Page } from "@playwright/test";
import type { Keyword, ManualOp } from "@sve/core";
import { startGame, toMainPhase, useSettings } from "./helpers";

async function boot(page: Page) {
  await page.route("**/api/decks/samples/sd01.json", route => route.fulfill({ json: {
    format: "sve-deck", version: 1, name: "Overlay", leader: "SD03-LD01",
    main: { "BP01-170": 20, "BP13-060": 8, "BP15-041": 8, "BP05-070": 8, "BP03-038": 8, "BP14-046": 8, "BP01-001": 20 }, evolve: {},
  } }));
  await useSettings(page, { uiLang: "en", cardLang: "en", format: "unlimited", manualDebug: true, animations: false, revealAll: true,
    setupControllers: ["human", "human"], setupTurnOrder: "player1", setupDecks: ["samples/sd01.json", "samples/sd01.json"] });
  await startGame(page, "overlay-ui");
  await toMainPhase(page);
  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    (await import(/* @vite-ignore */ path)).engine.send({ kind: "settings", settings: { revealAll: true, announceQuick: false } });
  });
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update.view.players[1].hand.every((c: { hidden: boolean }) => !c.hidden);
  })).toBe(true);
  await manual(page, { kind: "points", player: 0, playPoints: 30, maxPlayPoints: 10 });
}
async function inputs(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update.inputCount as number;
  });
}
async function manual(page: Page, op: ManualOp) {
  const before = await inputs(page);
  await page.evaluate(async op => {
    const path = "/src/app/store.ts";
    const { engine, getApp } = await import(/* @vite-ignore */ path);
    engine.send({ kind: "answer", seat: getApp().update.decision.decision.player, answer: { type: "mainPhase", action: { type: "manual", op } } });
  }, op);
  await expect.poll(() => inputs(page)).toBeGreaterThan(before);
  await toMainPhase(page);
}
async function cardId(page: Page, def: string, zone = "hand", player = 0): Promise<string> {
  return page.evaluate(async ({ def, zone, player }) => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update.view.players[player][zone].find((c: { def: string }) => c.def === def)?.id ?? "";
  }, { def, zone, player });
}
async function getCard(page: Page, def: string, player = 0): Promise<string> {
  if (!await cardId(page, def, "hand", player)) await manual(page, { kind: "search", player: player as 0 | 1, def });
  return cardId(page, def, "hand", player);
}
async function action(page: Page, card: string, type: "play" | "activate", settle = true) {
  const before = await inputs(page);
  await page.evaluate(async ({ card, type }) => {
    const path = "/src/app/store.ts";
    const { engine, getApp } = await import(/* @vite-ignore */ path);
    const decision = getApp().update.decision.decision;
    const action = decision.actions.find((a: { type: string; card?: string }) => a.type === type && a.card === card);
    if (!action) throw new Error(`Missing ${type} for ${card}`);
    engine.send({ kind: "answer", seat: decision.player, answer: { type: "mainPhase", action } });
  }, { card, type });
  await expect.poll(() => inputs(page)).toBeGreaterThan(before);
  if (settle) await toMainPhase(page);
}
const tile = (page: Page, id: string) => page.locator(`.sve-table .sve-card[data-card="${id}"]`);
async function openZone(page: Page, zone: string, player = 0) {
  await page.evaluate(async ({ zone, player }) => {
    const path = "/src/game/board/zone-browser.ts";
    (await import(/* @vite-ignore */ path)).openZone({ zone, player });
  }, { zone, player });
}

test("costs follow normal taxes and next-card consumption across table, browser, drag ghost and details", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await boot(page);
  const base = await getCard(page, "BP13-060");
  await expect(tile(page, base).locator(".sve-stat-cost")).toHaveText("2");
  await tile(page, base).hover();
  await expect(page.getByTestId("details-cost").locator("strong")).toHaveText("2");
  await expect(page.getByTestId("details-cost").locator("small")).toHaveCount(0);
  const optional = await getCard(page, "BP15-041");
  await expect(tile(page, optional).locator(".sve-stat-cost")).toHaveText("5");
  const tax = await getCard(page, "BP05-070", 1);
  await manual(page, { kind: "move", card: tax, to: "field" });
  await expect(tile(page, base).locator(".sve-stat-cost")).toHaveText("3");
  const originalColor = await tile(page, base).locator(".sve-stat-cost").evaluate(el => getComputedStyle(el).color);
  const exSource = await getCard(page, "BP01-170");
  await manual(page, { kind: "move", card: exSource, to: "ex" });
  const ex = await cardId(page, "BP01-170", "ex");
  const hand = await getCard(page, "BP01-170");
  const oz = await getCard(page, "BP03-038");
  await manual(page, { kind: "move", card: oz, to: "field" });
  const fieldOz = await cardId(page, "BP03-038", "field");
  await manual(page, { kind: "token", player: 0, token: "BP01-T10", to: "field" });
  await action(page, fieldOz, "activate");
  for (const id of [base, hand, ex]) await expect(tile(page, id).locator(".sve-stat-cost")).toHaveText("0");
  expect(await tile(page, base).locator(".sve-stat-cost").evaluate(el => getComputedStyle(el).color)).toBe(originalColor);
  await expect(tile(page, base).locator(".sve-stat-cost")).not.toHaveClass(/sve-up|sve-down/);

  await tile(page, hand).hover();
  const detail = page.getByTestId("details-cost");
  await expect(detail).toContainText("Cost");
  await expect(detail.locator("strong")).toHaveText("0");
  await expect(detail.locator("small")).toHaveText("printed 2");
  await openZone(page, "ex");
  await expect(page.locator(`.sve-modal .sve-card[data-card="${ex}"] .sve-stat-cost`)).toHaveText("0");
  await page.keyboard.press("Escape");
  const box = (await tile(page, hand).boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y - 40, { steps: 5 });
  await expect(page.locator(".sve-drag-ghost .sve-stat-cost")).toHaveText("0");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(tile(page, ex).locator(".sve-stat-cost")).toHaveText("0");

  // Keep another candidate's detail and EX browser open while a normal play consumes the offer.
  await tile(page, base).hover();
  await openZone(page, "ex");
  await action(page, hand, "play");
  await expect(tile(page, base).locator(".sve-stat-cost")).toHaveText("3");
  await expect(page.locator(`.sve-modal .sve-card[data-card="${ex}"] .sve-stat-cost`)).toHaveText("3");
  await expect(detail.locator("strong")).toHaveText("3");
  await page.keyboard.press("Escape");
  for (const [uiLang, label] of [["zh", "费用"], ["zh-Hant", "費用"], ["ja", "コスト"], ["en", "Cost"]]) {
    const before = await inputs(page);
    await page.evaluate(async uiLang => {
      const path = "/src/app/settings.ts";
      (await import(/* @vite-ignore */ path)).updateSettings({ uiLang });
    }, uiLang);
    await expect(detail).toContainText(label!);
    expect(await inputs(page)).toBe(before);
  }
  await manual(page, { kind: "move", card: ex, to: "cemetery" });
  await openZone(page, "cemetery");
  await expect(page.locator('.sve-modal .sve-card[data-def="BP01-170"] .sve-stat-cost').first()).toHaveText("2");
  expect(errors).toEqual([]);
});

test("BP14-046 previews all shared-group members and refreshes the others after one normal play", async ({ page }) => {
  await boot(page);
  const spell = await getCard(page, "BP14-046");
  await action(page, spell, "play");
  const members: { id: string; cost: number; type: string }[] = await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update.view.players[0].ex;
  });
  expect(members.length).toBe(5);
  for (const member of members) await expect(tile(page, member.id).locator(".sve-stat-cost")).toHaveText("0");
  const playable = members.find(c => c.type === "follower" || c.type === "amulet") ?? members.find(c => c.cost === 2)!;
  await tile(page, members.find(c => c.id !== playable.id)!.id).hover();
  await openZone(page, "ex");
  await action(page, playable.id, "play");
  for (const member of members.filter(c => c.id !== playable.id)) {
    await expect(tile(page, member.id).locator(".sve-stat-cost")).toHaveText(String(member.cost));
    await expect(page.locator(`.sve-modal .sve-card[data-card="${member.id}"] .sve-stat-cost`)).toHaveText(String(member.cost));
  }
  await expect(page.getByTestId("details-cost").locator("strong")).not.toHaveText("0");
});

test("keywords show four text labels, an overflow count and smaller type on dense or tiny cards", async ({ page }) => {
  await boot(page);
  const handId = await getCard(page, "BP01-001");
  await manual(page, { kind: "move", card: handId, to: "field" });
  const id = await cardId(page, "BP01-001", "field");
  await manual(page, { kind: "token", player: 1, token: "BP01-T03", to: "field" });
  const card = tile(page, id);
  const labels = card.locator(".sve-card-keywords .sve-kw");
  await expect(card.locator(".sve-card-keywords")).toHaveCount(0);
  const keywords: Keyword[] = ["ward", "bane", "rush", "storm", "assail", "intimidate", "drain", "aura"];
  for (const keyword of keywords.slice(0, 4)) await manual(page, { kind: "keyword", card: id, keyword });
  await expect(labels).toHaveText(["Ward", "Bane", "Rush", "Storm"]);
  const normalSize = await labels.first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await manual(page, { kind: "keyword", card: id, keyword: keywords[4]! });
  await expect(labels).toHaveText(["Ward", "Bane", "Rush", "Storm", "+1"]);
  await expect(card.locator("button, svg")).toHaveCount(0);
  // Starting on the overflow count still starts the card's normal attack drag.
  const before = await inputs(page);
  const more = (await labels.last().boundingBox())!;
  await page.mouse.move(more.x + more.width / 2, more.y + more.height / 2);
  await page.mouse.down();
  await page.mouse.move(more.x + 80, more.y - 40, { steps: 5 });
  await expect(page.locator(".sve-arrow-drag")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await inputs(page)).toBe(before);
  for (const keyword of keywords.slice(5)) await manual(page, { kind: "keyword", card: id, keyword });
  await expect(labels).toHaveText(["Ward", "Bane", "Rush", "Storm", "+4"]);
  expect(await labels.first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(normalSize);
  await card.hover();
  await expect(page.locator(".sve-details-state")).toContainText("Aura");
  await openZone(page, "field");
  const browser = page.locator(`.sve-modal .sve-card[data-card="${id}"]`);
  await expect(browser.locator(".sve-kw")).toHaveText(["Ward", "Bane", "Rush", "Storm", "+4"]);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const path = "/src/app/settings.ts";
    (await import(/* @vite-ignore */ path)).updateSettings({ uiLang: "zh-Hant" });
  });
  await expect(labels).toHaveText(["守護", "毀滅", "突進", "疾馳", "+4"]);
  await page.setViewportSize({ width: 915, height: 412 });
  // Exercise the actual frame width, including the small-card variant.
  await card.evaluate(el => {
    el.classList.add("sve-card-small");
    (el as HTMLElement).style.setProperty("--w", "44px");
  });
  await expect(labels).toHaveCount(5);
  expect(await labels.first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(7);
  const frame = (await card.locator(".sve-card-frame").boundingBox())!;
  for (const label of await labels.all()) {
    const box = (await label.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(frame.x);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height - 44 * 0.24 - 2);
  }
  expect(await labels.first().evaluate(el => getComputedStyle(el).pointerEvents)).toBe("none");
  await page.screenshot({ path: test.info().outputPath("keywords-text-narrow.png") });
});

test("clicking keyword text or its overflow count selects the card normally", async ({ page }) => {
  await boot(page);
  for (let i = 0; i < 2; i++) await manual(page, { kind: "token", player: 1, token: "BP01-T03", to: "field" });
  const ids: string[] = await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update.view.players[1].field.map((c: { id: string }) => c.id);
  });
  for (const id of ids) {
    for (const keyword of ["ward", "rush", "storm", "bane", "drain"] as const) await manual(page, { kind: "keyword", card: id, keyword });
  }
  const spell = await getCard(page, "BP13-060");
  await action(page, spell, "play", false);
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "choose");
  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    const { engine, getApp } = await import(/* @vite-ignore */ path);
    engine.send({ kind: "answer", seat: getApp().update.decision.decision.player, answer: { type: "choose", ids: ["normal"] } });
  });
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectCards");
  const before = await inputs(page);
  const card = tile(page, ids[0]!);
  const label = (await card.locator(".sve-kw").last().boundingBox())!;
  await page.mouse.click(label.x + label.width / 2, label.y + label.height / 2);
  await expect.poll(() => inputs(page)).toBeGreaterThan(before);
  await expect(page.locator(".sve-keyword-popover")).toHaveCount(0);
});
