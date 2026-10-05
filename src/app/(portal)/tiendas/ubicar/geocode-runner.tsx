"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { geocodificarLote } from "@/lib/actions-stores";
import { fmtNumber } from "@/lib/format";
import { Meter } from "@/components/ui";
import { IconAlert, IconPin, IconRefresh } from "@/components/icons";

type Totals = { located: number; review: number; notFound: number };

/**
 * Corre la geocodificación por lotes desde el navegador: cada llamada procesa
 * unas pocas tiendas, así se ve el avance y se puede detener sin perder nada.
 */
export function GeocodeRunner({ pending, notFound, configured }: { pending: number; notFound: number; configured: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState<"pendientes" | "reintento" | null>(null);
  const [done, setDone] = useState(0);
  const [goal, setGoal] = useState(0);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noPlaces, setNoPlaces] = useState(false);
  const stop = useRef(false);

  const run = async (mode: "pendientes" | "reintento") => {
    const retry = mode === "reintento";
    const startedAt = new Date().toISOString();
    stop.current = false;
    setRunning(mode);
    setDone(0);
    setGoal(retry ? notFound : pending);
    setTotals({ located: 0, review: 0, notFound: 0 });
    setError(null);
    setNoPlaces(false);

    try {
      for (;;) {
        const r = await geocodificarLote({ retry, startedAt });
        setDone((d) => d + r.processed);
        setTotals((t) => ({
          located: (t?.located ?? 0) + r.located,
          review: (t?.review ?? 0) + r.review,
          notFound: (t?.notFound ?? 0) + r.notFound,
        }));
        if (r.placesUnavailable) setNoPlaces(true);
        if (r.error) {
          setError(r.error);
          break;
        }
        if (!r.remaining || !r.processed || stop.current) break;
      }
    } catch {
      setError("Se perdió la conexión con el servidor. Lo ya ubicado quedó guardado; puedes continuar.");
    }
    setRunning(null);
    router.refresh();
  };

  if (!configured) {
    return (
      <p className="flex items-center gap-2 px-4 py-3.5 text-[12.5px] text-[var(--text-secondary)]">
        <IconAlert size={14} /> Para geocodificar, guarda la API key en{" "}
        <Link href="/conexiones" className="font-medium text-[var(--brand)] hover:underline">Conexiones → Google Maps</Link>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={!!running || pending === 0} onClick={() => run("pendientes")}>
          <IconPin size={14} /> {running === "pendientes" ? "Ubicando…" : `Ubicar ${fmtNumber(pending)} pendientes`}
        </button>
        <button type="button" className="btn btn-secondary" disabled={!!running || notFound === 0} onClick={() => run("reintento")}>
          <IconRefresh size={14} /> {running === "reintento" ? "Reintentando…" : `Reintentar ${fmtNumber(notFound)} no encontradas`}
        </button>
        {running && (
          <button type="button" className="btn btn-ghost" onClick={() => (stop.current = true)}>
            Detener
          </button>
        )}
      </div>

      {totals && (
        <div className="flex flex-col gap-1.5">
          <Meter value={done} max={Math.max(goal, done)} />
          <p className="text-[12px] text-[var(--text-muted)]">
            {fmtNumber(done)} de {fmtNumber(goal)} · {fmtNumber(totals.located)} ubicadas · {fmtNumber(totals.review)} por revisar ·{" "}
            {fmtNumber(totals.notFound)} no encontradas
          </p>
        </div>
      )}

      {noPlaces && (
        <p className="text-[12px] text-[var(--text-secondary)]">
          Places API no está habilitada en la clave: las tiendas sin dirección no se pueden buscar por nombre. Actívala en Google
          Cloud y usa «Reintentar».
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 text-[12.5px] text-[var(--critical)]">
          <IconAlert size={14} /> {error}
        </p>
      )}
    </div>
  );
}
