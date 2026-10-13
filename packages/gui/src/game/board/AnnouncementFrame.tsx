import type { ReactNode } from "react";

/** Shared corner-of-table presentation for Quick resolution and public cards added to hand. */
export function AnnouncementFrame({ own, watching, testId, labelledBy, className = "", children, overlay }: {
  own: boolean; watching: boolean; testId: string; labelledBy: string; className?: string; children: ReactNode; overlay?: ReactNode;
}) {
  return (
    <div className={`sve-announce-backdrop${watching ? " sve-announce-watch" : ""}`} onClick={(e) => e.stopPropagation()} data-testid={testId}>
      <div className={`sve-announce ${own ? "sve-announce-own" : "sve-announce-opponent"} ${className}`} role="alertdialog" aria-labelledby={labelledBy}>
        {children}
      </div>
      {overlay}
    </div>
  );
}
