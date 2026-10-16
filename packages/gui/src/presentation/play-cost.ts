import type { CardId, GameReader, PlayerId, ScriptRegistry } from "@sve/core";
import { playCost } from "../../../core/src/engine/costs";

/**
 * Reuse the engine's read-only cost query for normal play, without an option or caller setTo.
 * Import the existing internal export here so core and fingerprinted files stay unchanged.
 * Cards with no cost remain absent from the GUI's cost display rather than becoming zero.
 */
export function createPlayCostQuery(reader: GameReader, scripts: ScriptRegistry): (id: CardId, player: PlayerId) => number | undefined {
  const env = { state: reader.state, db: reader.db, scripts };
  return (id, player) => reader.info(id).cost === null ? undefined : playCost(env, id, player, null);
}
