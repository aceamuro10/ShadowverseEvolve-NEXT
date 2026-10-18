// Observer regression tests use the same text locator as main's ProcessingPrompt.
import type { Engine } from "@sve/core";
import type { Catalog } from "../src/app/catalog";
import type { CardLang } from "../src/app/settings";
import { abilityText, cardPlayText } from "../src/game/card/ability-display";
import { processingOf } from "../src/presentation/processing";
import type { AbilityDisplayContext } from "../src/presentation/protocol";

export function contextText(engine: Engine, context: AbilityDisplayContext, catalog: Catalog, lang: CardLang) {
  const processing = processingOf(engine, context);
  return processing ? processing.kind === "card" ? cardPlayText(processing, true, catalog, lang) : abilityText(processing.ability, catalog, lang) : null;
}
