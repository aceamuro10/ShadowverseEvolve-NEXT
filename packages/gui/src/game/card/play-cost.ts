import type { CardView } from "@sve/core";
import type { GameUpdate } from "../../engine/protocol";

/** main's price preview, only while this instance is still in the viewer's hand or EX area. */
export function normalPlayCost(update: GameUpdate | null, card: CardView | undefined): number | undefined {
  if (!update || !card) return undefined;
  const side = update.view.players[update.perspective];
  if (![...side.hand, ...side.ex].some((c) => c.id === card.id && !c.hidden)) return undefined;
  return update.playCosts?.[card.id] ?? card.cost ?? undefined;
}
