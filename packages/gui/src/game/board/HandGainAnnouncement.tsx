import { cardName } from "../../app/catalog";
import { useSettings } from "../../app/settings";
import { dismissHandGain, useApp } from "../../app/store";
import type { GameUpdate, HandGainAnnouncement as Announcement } from "../../presentation/protocol";
import { useT } from "../../i18n";
import { CardTile } from "../card/CardTile";
import { playerLabel } from "../labels";

export function HandGainAnnouncement({ update }: { update: GameUpdate }) {
  const gain = useApp((s) => s.handGain);
  return gain ? <HandGainWindow key={gain.key} update={update} gain={gain} /> : null;
}

function HandGainWindow({ update, gain }: { update: GameUpdate; gain: Announcement }) {
  const t = useT();
  const catalog = useApp((s) => s.catalog);
  const { cardLang } = useSettings();
  const title = t(gain.to === "hand" ? "handGain.title" : `cardTransfer.${gain.to}.title`, { n: gain.cards.length });
  if (!catalog) return null;
  return (
    <aside className={`sve-announce sve-hand-gain ${gain.player === update.perspective ? "sve-announce-own" : "sve-announce-opponent"}`}
      data-testid="hand-gain" data-to={gain.to} aria-labelledby="sve-hand-gain-text" onClick={(e) => e.stopPropagation()}>
      <span className="sve-announce-title">{title}</span>
      <p id="sve-hand-gain-text" className="sve-announce-line">
        {t(gain.to === "hand" ? "handGain.text" : `cardTransfer.${gain.to}.text`, { player: playerLabel(gain.player, update, t), n: gain.cards.length })}
      </p>
      <div className="sve-hand-gain-cards" tabIndex={0} aria-label={title}>
        {gain.cards.map(({ id, card, from }) => (
          <figure key={id} data-testid="hand-gain-card" data-from={from}>
            <CardTile info={card} />
            <figcaption>
              <span>{cardName(catalog.def(card.def), cardLang)}</span>
              <small>{t("cardTransfer.from", { zone: t(`log.zone.${from}`) })}</small>
            </figcaption>
          </figure>
        ))}
      </div>
      <button type="button" onClick={() => dismissHandGain(gain.key)} data-testid="hand-gain-close">{t("game.close")}</button>
    </aside>
  );
}
