import { updateSettings, useSettings } from "../app/settings";
import { useT } from "../i18n";

const OPTIONS = [
  { field: "showPlayCosts", label: "display.playCosts", help: "display.playCostsHelp", id: "play-costs" },
  { field: "showDetailTags", label: "display.detailTags", help: "display.detailTagsHelp", id: "detail-tags" },
  { field: "showTurnOrderLabels", label: "display.turnOrder", help: "display.turnOrderHelp", id: "turn-order" },
  { field: "showCardMoveNotices", label: "display.cardMoves", help: "display.cardMovesHelp", id: "card-moves" },
] as const;

/** Local display preferences; changing them never sends an engine input. */
export function DisplayPanel() {
  const settings = useSettings();
  const t = useT();
  return (
    <section className="sve-display-settings" data-testid="display-settings" aria-label={t("tab.display")}>
      {OPTIONS.map(({ field, label, help, id }) => (
        <div key={field}>
          <label className="sve-check">
            <input type="checkbox" checked={settings[field]} onChange={(e) => updateSettings({ [field]: e.target.checked })}
              data-testid={`display-${id}`} aria-describedby={`display-${id}-help`} />
            <span>{t(label)}</span>
          </label>
          <p className="sve-hint" id={`display-${id}-help`}>{t(help)}</p>
        </div>
      ))}
      <p className="sve-hint">{t("display.saved")}</p>
    </section>
  );
}
