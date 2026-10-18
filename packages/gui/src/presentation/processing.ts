// Adapt the observer's identities to main's display protocol. Text is always located by main's ability-display.ts.
import type { Engine } from "@sve/core";
import { abilityOf } from "../engine/core-internals";
import { rankOf, summarizeAbility } from "../engine/game-host";
import type { ProcessingInfo } from "../engine/protocol";
import type { AbilityDisplayContext } from "./protocol";

export function processingOf(engine: Engine, context: AbilityDisplayContext): ProcessingInfo | null {
  const card = context.sourceCard;
  if (!card) return null;
  const base = { controller: context.controller, source: context.source, card };
  if (context.kind === "cardPlay" || context.kind === "spell") {
    return { ...base, kind: "card", ...(context.playOptionId ? { playOption: { id: context.playOptionId, label: context.playOptionLabel ?? context.playOptionId } } : {}) };
  }
  if (context.abilityIndex === undefined) return null;
  const def = context.sourceDef;
  const equipment = def.startsWith("equip:") ? def.slice(6) : null;
  const abilities = (equipment ? engine.scripts[equipment]?.equipment?.abilities : engine.scripts[def]?.abilities) ?? [];
  return { ...base, kind: "ability", ability: {
    ...summarizeAbility(abilityOf(engine, def, context.abilityIndex), def, engine),
    ...rankOf(abilities, context.abilityIndex), source: context.source, sourceDef: def,
    ...(context.keyword ? { keyword: context.keyword } : {}),
    ...(context.providerDef ? { giver: context.providerDef } : {}),
  } };
}

/** Only the reviewed free-UB handoff fills main's deliberately absent processing identity. */
export function freeUnionBurstProcessing(engine: Engine, context: AbilityDisplayContext | null): ProcessingInfo | null {
  if (!context?.instanceId?.endsWith(":freeUB") || context.abilityIndex === undefined) return null;
  const ability = abilityOf(engine, context.sourceDef, context.abilityIndex);
  return ability && ability.kind !== "spell" && ability.unionBurst ? processingOf(engine, context) : null;
}
