import { expect, test } from "@playwright/test";
import { openSetup, useSettings } from "./helpers";

test("reloading card texts keeps the validated decks and start button ready", async ({ page }) => {
  await useSettings(page, { uiLang: "en", setupDecks: ["samples/sd01.json", "samples/sd02.json"], setupControllers: ["human", "human"] });
  await openSetup(page);
  let reloads = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/decks/samples/*.json", async (route) => {
    reloads++;
    await pending;
    await route.continue();
  });
  try {
    const changed = await page.evaluate(async () => {
      const { getApp } = await import(/* @vite-ignore */ String("/src/app/store.ts")) as typeof import("../../src/app/store");
      const { loadCardTexts } = await import(/* @vite-ignore */ String("/src/resources/card-texts.ts")) as typeof import("../../src/resources/card-texts");
      const previous = getApp().catalog;
      const rules = getApp().rulesCatalog;
      await loadCardTexts([]);
      // Let effects caused by the display-catalog update run; a stale validation would now be blocked by the route.
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      return { display: getApp().catalog !== previous, rules: getApp().rulesCatalog === rules };
    });
    expect(changed).toEqual({ display: true, rules: true });
    await expect(page.getByTestId("start-game")).toBeEnabled();
    expect(reloads).toBe(0);
    await page.getByTestId("start-game").click();
    await expect(page.locator(".sve-table")).toBeVisible();
  } finally { release(); }
});
