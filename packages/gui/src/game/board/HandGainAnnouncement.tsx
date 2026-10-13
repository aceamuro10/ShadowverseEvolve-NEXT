import { useEffect, useLayoutEffect, useRef } from "react";
import { cardName } from "../../app/catalog";
import { useBack } from "../../app/back";
import { useSettings } from "../../app/settings";
import { engine, useApp } from "../../app/store";
import type { GameUpdate, HandGainAnnouncement as Announcement } from "../../presentation/protocol";
import { useT } from "../../i18n";
import { flyIn } from "../animation/effects";
import { CardTile } from "../card/CardTile";
import { playerLabel } from "../labels";
import { AnnouncementFrame } from "./AnnouncementFrame";

export function HandGainAnnouncement({ update }: { update: GameUpdate }) {
  return update.handGain ? <HandGainWindow key={update.handGain.key} update={update} gain={update.handGain} /> : null;
}

function HandGainWindow({ update, gain }: { update: GameUpdate; gain: Announcement }) {
  const t = useT();
  const catalog = useApp((s) => s.catalog);
  const { cardLang, animations } = useSettings();
  const cardsRef = useRef<HTMLDivElement>(null);
  const ok = () => engine.send({ kind: "handGainSeen", key: gain.key });
  const automatic = update.watch ? update.watch.playing : !update.controllers.includes("human") && !update.online?.spectating && !update.settings.paused;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); ok(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useBack(true, ok);
  useLayoutEffect(() => {
    const element = cardsRef.current;
    const mats = document.querySelector(".sve-mats")?.getBoundingClientRect();
    if (!element || !mats || !animations) return;
    const box = element.getBoundingClientRect();
    flyIn(element, new DOMRect(mats.left + mats.width / 2 - box.width / 2, mats.top + mats.height / 2 - box.height / 2, box.width, box.height), 420);
  }, [animations]);
  if (!catalog) return null;
  return (
    <AnnouncementFrame own={gain.player === update.perspective} watching={false} testId="hand-gain" labelledBy="sve-hand-gain-text" className="sve-hand-gain">
      <span className="sve-announce-title">{t("handGain.title", { n: gain.cards.length })}</span>
      <p id="sve-hand-gain-text" className="sve-announce-line">
        {t("handGain.text", { player: playerLabel(gain.player, update, t), n: gain.cards.length })}
      </p>
      <div ref={cardsRef} className="sve-hand-gain-cards" tabIndex={0} aria-label={t("handGain.title", { n: gain.cards.length })}>
        {gain.cards.map(({ id, card, from }) => (
          <figure key={id} data-testid="hand-gain-card" data-from={from}>
            <CardTile info={card} />
            <figcaption>
              <span>{cardName(catalog.def(card.def), cardLang)}</span>
              <small>{t(`handGain.from.${from}`)}</small>
            </figcaption>
          </figure>
        ))}
      </div>
      <button type="button" className="sve-primary" onClick={ok} autoFocus={!automatic} data-testid="hand-gain-ok">{t("announce.ok")}</button>
    </AnnouncementFrame>
  );
}
