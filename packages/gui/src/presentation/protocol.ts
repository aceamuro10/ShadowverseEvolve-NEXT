// Local worker-to-page presentation extensions. Keep engine/protocol.ts unchanged: it is fingerprinted.
import type { CardId, DefId, PlayerId } from "@sve/core";
import type { CardInfo, LogEntry } from "../engine/protocol";
import type { FromWorker as EngineMessage, GameUpdate as EngineUpdate } from "../engine/protocol";

export type ToWorker = import("../engine/protocol").ToWorker;

export interface HandGainAnnouncement {
  key: string;
  player: PlayerId;
  cards: { id: CardId; card: CardInfo; from: "deck" | "cemetery" | "banished" }[];
}

/** Additional presentation data for a visible instance. Type, stats and gifts remain in CardView. */
export interface CardRuntimeDetails {
  /** Current normal play PP, only for visible hand/EX instances (0 is a valid value). */
  normalPlayCost?: number;
  enteredFieldThisTurn: boolean;
  cannotAttack: boolean;
  cannotAttackLeader: boolean;
  cannotDealDamage: boolean;
}

export interface GameUpdate extends EngineUpdate {
  /** One-shot public hand gains from this publication; their display is owned entirely by the page. */
  handGains?: HandGainAnnouncement[];
  /** Computed synchronously from the session and the final visible view being sent. */
  cardDetails: Record<CardId, CardRuntimeDetails>;
  /** Local presentation only; optional for older GUI fixtures/messages. The host always supplies both. */
  pendingAbilities?: Record<string, AbilityDisplayContext>;
  effectContext?: AbilityDisplayContext | null;
  diceSteps?: DiceStep[];
  /** The real current reroll boundary, including bot/remote decisions hidden from this viewer. */
  diePrompt?: DiePrompt | null;
  /** Page-local animation slice. The actual rule log is always kept intact. */
  animationLog?: LogEntry[];
  animationKey?: string;
  animationGroup?: string;
  /** A dice prelude already animated this Quick play; its final summary keeps a static card. */
  announcementIntroduced?: boolean;
}

export interface DiePrompt { key: string; player: PlayerId; result: number }
export type DiceStep = (
  | { type: "throw"; key: string; player: PlayerId; result: number; reroll: boolean }
  | ({ type: "prompt" } & DiePrompt)
  | { type: "settled"; key: string; player: PlayerId; result: number }) & {
    /** Number of preceding events in this publication, excluding private cardsLookedAt events. */
    afterEvents?: number;
  };

/** Identity is kept independently of language; the page resolves text when its card language changes. */
export interface AbilityDisplayContext {
  triggerDie?: { player: PlayerId; result: number };
  instanceId?: string;
  kind?: "automatic" | "activated" | "spell" | "cardPlay";
  pendingId?: string;
  controller: PlayerId;
  source: CardId;
  sourceDef: DefId;
  /** Absent for the card's play process (playOptions are not Core ability indexes). */
  abilityIndex?: number;
  sourceCard?: CardInfo;
  providerDef?: DefId;
  timing?: string;
  origin: "printed" | "keyword" | "granted" | "equipment" | "delayed";
  keyword?: string;
  textRef?: { def: DefId; timing: string; rank: number; count: number; quoted?: boolean };
  modeIds?: string[];
  playOptionId?: string;
  playOptionLabel?: string;
}

export type AbilityUpdate = EngineUpdate & Pick<GameUpdate, "pendingAbilities" | "effectContext">;

export type FromWorker = Exclude<EngineMessage, { kind: "update" }> | { kind: "update"; update: GameUpdate };
