import type { ReactNode } from "react";

/**
 * Prioridad de visita. El número siempre acompaña al color, y la etiqueta
 * textual evita que el criterio dependa del matiz.
 */
export function ScoreBadge({ score, showLabel = true }: { score: number; showLabel?: boolean }): ReactNode {
  const { tone, label } =
    score >= 62
      ? { tone: "danger" as const, label: "Urgente" }
      : score >= 45
        ? { tone: "warning" as const, label: "Alta" }
        : score >= 28
          ? { tone: "info" as const, label: "Media" }
          : { tone: "neutral" as const, label: "Baja" };

  return (
    <span className={`badge badge-${tone} shrink-0 tabular`} title={`Prioridad ${label} · score ${score}/100`}>
      {score}
      {showLabel && <span className="font-normal opacity-80">· {label}</span>}
    </span>
  );
}
