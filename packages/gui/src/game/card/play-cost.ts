import type { CardView } from "@sve/core";
import type { GameUpdate } from "../../presentation/protocol";

/** The core's normal price, only while this instance is in a visible hand or EX area. */
export function normalPlayCost(update: GameUpdate | null, card: CardView | undefined): number | undefined {
  if (!update || !card) return undefined;
  if (!update.view.players.some((side) => [...side.hand, ...side.ex].some((c) => c.id === card.id && !c.hidden))) return undefined;
  return update.cardDetails?.[card.id]?.normalPlayCost ?? update.playCosts?.[card.id] ?? card.cost ?? undefined;
}
