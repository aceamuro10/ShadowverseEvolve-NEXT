// The table moves with the game, in an order that reads without the log. Each update's events
// (already hidden for the viewer) say what happened; the snapshot says where things were; plan.ts puts them in order
// (planTimeline, which the sounds follow too):
//  1. cards fly from their old places to their new ones; a card that is hit waits where it was until it has been hit;
//  2. an attack nothing stopped before its combat shows its red arrow first (one still going on has its own, AttackArrow);
//     at the combat the attacker lunges at its target and the damage shows as it strikes;
//  3. a played card (spell, follower, amulet) shows in its player's corner once it has landed on the field or in the
//     cemetery — the opponent's at the top right, one's own at the bottom left — wiping in and out (a Quick one played at
//     quick timing is shown by its announcement instead);
//  4. the cards an effect selected get a blue arrow from its source (a played card: from its corner), then their damage;
//  5. numbers rise for damage and healing, evolving followers turn over.
// All of it is short and purely cosmetic: the table itself always shows the engine's latest view.
import type { CardId } from "@sve/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../app/settings";
import { onBeforeUpdate } from "../../app/store";
import type { CardInfo } from "../../engine/protocol";
import type { GameUpdate } from "../../presentation/protocol";
import { tableAnimations } from "../../presentation/animation-barrier";
import { Arrow, type Point } from "../board/Arrow";
import { CardTile } from "../card/CardTile";
import { flip, floatText, flyIn, flyOut, lunge, popIn, shake } from "./effects";
import { planFlights, planTimeline, TIMING } from "./plan";
import { captureTable, takeSnapshot, type Snapshot } from "./snapshot";

onBeforeUpdate(captureTable);

const cardElement = (id: CardId): HTMLElement | null => document.querySelector<HTMLElement>(`.sve-table [data-card="${CSS.escape(id)}"]`);

const zoneBox = (key: string | null): DOMRect | undefined =>
  key ? document.querySelector<HTMLElement>(`.sve-table [data-zone="${CSS.escape(key)}"]`)?.getBoundingClientRect() : undefined;

const center = (box: DOMRect | undefined): Point | null => (box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null);

interface Showcase {
  key: string;
  card: CardInfo;
  own: boolean;
  delay: number;
  done?: () => void;
}

interface Flash {
  key: string;
  from: Point;
  to: Point;
  variant: "attack" | "target";
}

interface Effects {
  /** Run `fn` after `ms` (cancelled if the table goes away). */
  later(ms: number, fn: () => void): void;
  show(showcase: Showcase): void;
  /** An arrow shown at `ms`, between the points found then. */
  flash(ms: number, variant: Flash["variant"], from: () => Point | null, to: () => Point | null): void;
}

/** Start the animations of one update. */
function animate(update: GameUpdate, snapshot: Snapshot, fx: Effects): void {
  // Where a card is now, or was just before the update (it has left).
  const position = (id: CardId): Point | null => center(cardElement(id)?.getBoundingClientRect() ?? snapshot.cards.get(id)?.rect);
  const plan = planTimeline(update.log, update.announcement?.source ?? null);

  // 3. Played cards in their corners.
  const corner = new Map<CardId, string>();
  for (const p of plan.played) {
    const key = `${update.animationKey ?? update.inputCount}:${p.id}`;
    corner.set(p.id, key);
    fx.show({ key, card: p.card, own: p.player === update.perspective, delay: p.at });
  }

  // 2. Attacks nothing stopped before their combat: the arrow; then every attacker lunges as its combat comes.
  for (const attack of plan.attacks) fx.flash(0, "attack", () => position(attack.attacker), () => position(attack.target));
  for (const { attacker, target, at } of plan.lunges) {
    fx.later(at, () => {
      const a = cardElement(attacker);
      const b = cardElement(target);
      if (a && b) lunge(a, b);
    });
  }

  // 4. Cards an effect selected: an arrow from its source (a played card's corner), then they are hit.
  for (const { source, target, at, corner: fromCorner } of plan.selections) {
    const key = corner.get(source);
    const from =
      fromCorner && key
        ? () => center(document.querySelector(`[data-showcase="${CSS.escape(key)}"] .sve-card`)?.getBoundingClientRect()) ?? position(source)
        : () => position(source);
    fx.flash(at, "target", from, () => position(target));
  }

  // 1. The flights; a card hit on its way out waits where it was until it has been hit.
  for (const flight of planFlights(update.log)) {
    const { origin } = flight;
    const struck = origin.card !== null ? plan.hits.get(origin.card) : undefined;
    const delay = struck !== undefined ? struck + TIMING.leave : 0;
    const from = (origin.card ? snapshot.cards.get(origin.card)?.rect : undefined) ?? (origin.zone ? snapshot.zones.get(origin.zone) : undefined);
    const element = flight.card ? cardElement(flight.card) : null;
    if (element) {
      if (from) flyIn(element, from, 380, delay);
      else popIn(element);
      continue;
    }
    // Not shown where it went (a deck, a face-down pile, the evolve zone): its old picture goes there.
    const source = origin.card ? snapshot.cards.get(origin.card) : undefined;
    const to = zoneBox(flight.to);
    if (source && to) flyOut(source, to, 420, delay);
  }

  // 5. Numbers and turns.
  for (const entry of update.log) {
    const event = entry.event;
    switch (event.type) {
      case "damageDealt": {
        if (event.amount <= 0) break;
        const at = position(event.target);
        fx.later(plan.hits.get(event.target) ?? 0, () => {
          if (at) floatText(at.x, at.y, `-${event.amount}`, "damage");
          const element = cardElement(event.target);
          if (element) shake(element);
        });
        break;
      }
      case "leaderDefenseChanged": {
        // Damage shows with damageDealt; this is for healing and "+X" (CR 5.27).
        const leader = update.view.players[event.player].leader;
        const at = leader ? position(leader.id) : null;
        if (at && event.delta > 0) floatText(at.x, at.y, `+${event.delta}`, "heal");
        break;
      }
      case "evolved": {
        const element = cardElement(event.card);
        if (element) flip(element);
        break;
      }
      default:
        break;
    }
  }
}

export function AnimationLayer({ update }: { update: GameUpdate }) {
  const { animations } = useSettings();
  const [showcases, setShowcases] = useState<Showcase[]>([]);
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const timers = useRef(new Set<number>());
  const running = useRef(new Set<Animation>());
  const lastSeed = useRef(update.seed);
  const seq = useRef(0);
  const lastKey = useRef<string | undefined>(undefined);
  const groupSnapshot = useRef<{ group: string; snapshot: Snapshot } | null>(null);
  useEffect(() => {
    const pending = timers.current;
    const animations = running.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      for (const animation of animations) animation.cancel();
      tableAnimations.reset();
    };
  }, []);
  useLayoutEffect(() => {
    let snapshot = takeSnapshot();
    const key = update.animationKey;
    if (!key || key === lastKey.current) return;
    lastKey.current = key;
    if (update.logReset || lastSeed.current !== update.seed) {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current.clear();
      for (const animation of running.current) animation.cancel();
      running.current.clear();
      setShowcases([]);
      setFlashes([]);
      groupSnapshot.current = null;
    }
    lastSeed.current = update.seed;
    if (update.animationGroup && snapshot) {
      const previous = groupSnapshot.current;
      if (previous?.group === update.animationGroup) {
        // Later slices may refer to a card already removed by the final authoritative view.
        snapshot = { cards: new Map([...snapshot.cards, ...previous.snapshot.cards]), zones: snapshot.zones };
      }
      groupSnapshot.current = { group: update.animationGroup, snapshot };
    } else groupSnapshot.current = null;
    if (!animations || !snapshot || update.logReset) {
      tableAnimations.started(key);
      return;
    }
    const track = (fn: () => void) => {
      const before = new Set(document.getAnimations());
      fn();
      for (const animation of document.getAnimations()) {
        if (before.has(animation)) continue;
        running.current.add(animation);
        const done = tableAnimations.task(key);
        const finish = () => {
          animation.removeEventListener("finish", finish);
          animation.removeEventListener("cancel", finish);
          running.current.delete(animation);
          done();
        };
        // The finished promise resolves before onfinish removes flight ghosts/restores the card.
        // Wait for the event, after the effect's own cleanup, before releasing the next dice step.
        animation.addEventListener("finish", finish);
        animation.addEventListener("cancel", finish);
      }
    };
    const later = (ms: number, fn: () => void) => {
      if (ms <= 0) return track(fn);
      const done = tableAnimations.task(key);
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        track(fn);
        done();
      }, ms);
      timers.current.add(timer);
    };
    track(() => animate({ ...update, log: update.animationLog ?? update.log }, snapshot, {
      later,
      show: (showcase) => {
        const done = tableAnimations.task(key);
        let timer: number | undefined;
        const finish = () => {
          if (timer !== undefined) { window.clearTimeout(timer); timers.current.delete(timer); }
          done();
          setShowcases((all) => all.filter((s) => s.key !== showcase.key));
        };
        setShowcases((all) => [...all, { ...showcase, done: finish }]);
        // Fallback for cancelled CSS animation/background tabs. Normal completion is the actual animation end.
        timer = window.setTimeout(finish, showcase.delay + TIMING.showcase + 150);
        timers.current.add(timer);
      },
      flash: (ms, variant, from, to) =>
        later(ms, () => {
          const [a, b] = [from(), to()];
          if (!a || !b) return;
          const key = `flash-${++seq.current}`;
          setFlashes((all) => [...all, { key, from: a, to: b, variant }]);
          later(TIMING.arrow, () => setFlashes((all) => all.filter((f) => f.key !== key)));
        }),
    }));
    tableAnimations.started(key);
  }, [update, animations]);
  const table = document.querySelector(".sve-table");
  return (
    <>
      {table
        ? createPortal(
            showcases.map((s) => (
              <div
                key={s.key}
                className={`sve-showcase ${s.own ? "sve-showcase-own" : "sve-showcase-opponent"}`}
                style={{ animationDelay: `${s.delay}ms` }}
                data-showcase={s.key}
                data-testid="showcase"
                onAnimationEnd={(event) => { if (event.animationName.startsWith("sve-showcase-wipe")) s.done?.(); }}
              >
                <div className="sve-showcase-card">
                  <CardTile info={s.card} />
                </div>
              </div>
            )),
            table,
          )
        : null}
      {flashes.map((f) => (
        <Arrow key={f.key} from={f.from} to={f.to} variant={f.variant} flash={TIMING.arrow} />
      ))}
    </>
  );
}
