import { useEffect, useState } from "react";
import { cardName } from "../../app/catalog";
import { useSettings } from "../../app/settings";
import { dismissHandGain, useApp } from "../../app/store";
import type { GameUpdate, HandGainAnnouncement as Announcement } from "../../presentation/protocol";
import { useT } from "../../i18n";
import { CardTile } from "../card/CardTile";
import { playerLabel } from "../labels";
import { HAND_GAIN_DURATION_MS } from "../../presentation/hand-gain-display";

export function HandGainAnnouncement({ update }: { update: GameUpdate }) {
  const gain = useApp((s) => s.handGain);
  const expiresAt = useApp((s) => s.handGainExpiresAt);
  return gain && expiresAt !== null ? <HandGainWindow key={gain.key} update={update} gain={gain} expiresAt={expiresAt} /> : null;
}

function HandGainWindow({ update, gain, expiresAt }: { update: GameUpdate; gain: Announcement; expiresAt: number }) {
  const t = useT();
  const catalog = useApp((s) => s.catalog);
  const { cardLang } = useSettings();
  const title = t(gain.to === "hand" ? "handGain.title" : `cardTransfer.${gain.to}.title`, { n: gain.cards.length });
  if (!catalog) return null;
  return (
    <aside className={`sve-announce sve-hand-gain ${gain.player === update.perspective ? "sve-announce-own" : "sve-announce-opponent"}`}
      data-testid="hand-gain" data-to={gain.to} aria-labelledby="sve-hand-gain-text"
      onClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dismissHandGain(gain.key);
      }}>
      <p id="sve-hand-gain-text" className="sve-announce-line">
        {t(gain.to === "hand" ? "handGain.text" : `cardTransfer.${gain.to}.text`, { player: playerLabel(gain.player, update, t), n: gain.cards.length })}
      </p>
      <div className="sve-hand-gain-cards" tabIndex={0} aria-label={title}>
        {gain.cards.map(({ id, card, from }) => (
          <figure key={id} data-testid="hand-gain-card" data-from={from}>
            <CardTile info={card} />
            <figcaption>
              <span>{cardName(catalog.def(card.def), cardLang)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <NoticeCountdown expiresAt={expiresAt} />
    </aside>
  );
}
function NoticeCountdown({ expiresAt }: { expiresAt: number }) {
  const t = useT();
  const remainingNow = () => Math.max(0, Math.min(HAND_GAIN_DURATION_MS, expiresAt - Date.now()));
  const [remaining, setRemaining] = useState(remainingNow);
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.min(HAND_GAIN_DURATION_MS, expiresAt - Date.now())));
    tick();
    const timer = window.setInterval(tick, 100);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [expiresAt]);
  const seconds = Math.ceil(remaining / 1000);
  const label = t("cardTransfer.countdown", { n: seconds });
  return (
    <div className="sve-hand-gain-countdown" data-testid="hand-gain-countdown" data-ending={remaining <= 2000 ? "" : undefined}
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={HAND_GAIN_DURATION_MS / 1000} aria-valuenow={seconds}
      title={label}>
      <span style={{ transform: `scaleX(${remaining / HAND_GAIN_DURATION_MS})` }} />
    </div>
  );
}
