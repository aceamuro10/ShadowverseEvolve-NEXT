import { useT } from "../../i18n";
import type { AbilityDisplayContext } from "../../presentation/protocol";

export function TriggerDie({ die }: { die: AbilityDisplayContext["triggerDie"] }) {
  const t = useT();
  return die ? <span className="sve-trigger-die" data-testid="trigger-die" data-result={die.result}>{t("decision.triggerDie", { n: die.result })}</span> : null;
}
