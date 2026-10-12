import { useEffect } from "react";
import { dicePlayback, useApp } from "../../app/store";
import { useT } from "../../i18n";

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function DiceOverlay() {
  const frame = useApp((s) => s.dice);
  const t = useT();
  useEffect(() => {
    if (!frame || frame.type !== "throw") return;
    // Static results need a readable stay; the timer also handles cancelled CSS animations/background tabs.
    const timer = window.setTimeout(() => dicePlayback.complete(frame.key), frame.duration + (frame.animated ? 150 : 0));
    return () => window.clearTimeout(timer);
  }, [frame]);
  if (!frame) return null;
  const player = t("game.playerN", { n: frame.player + 1 });
  return <div className="sve-dice-overlay" role="status" data-testid="dice-overlay" data-result={frame.result} data-phase={frame.type} data-frame={frame.key}>
    <div className="sve-dice-caption">{t(frame.type === "prompt" ? "dice.inquiry" : frame.reroll ? "dice.reroll" : "dice.roll", { player })}</div>
    <div key={frame.key} className={`sve-die${frame.type === "throw" && frame.animated ? " sve-die-rolling" : ""}`}
      style={{ animationDuration: `${frame.duration}ms` }} onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && frame.type === "throw") dicePlayback.complete(frame.key);
      }} aria-label={t("dice.result", { n: frame.result })}>
      {Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[frame.result]?.includes(i) ? "sve-die-pip" : undefined} />)}
    </div>
    <div className="sve-dice-result">{t("dice.result", { n: frame.result })}</div>
  </div>;
}
