"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buscarTiendasLote } from "@/lib/actions-locator";
import { fmtNumber } from "@/lib/format";
import { Meter } from "@/components/ui";
import { IconAlert, IconSearch } from "@/components/icons";

type Totals = { places: number; linked: number; found: number; requests: number };

/**
 * Corre todas las búsquedas ahora, por lotes desde el navegador, igual que la
 * geocodificación. El cron hace lo mismo cada día sin que nadie esté mirando.
 */
export function LocatorRunner({ searches, configured }: { searches: number; configured: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  const run = async () => {
    const startedAt = new Date().toISOString();
    stop.current = false;
    setRunning(true);
    setDone(0);
    setTotals({ places: 0, linked: 0, found: 0, requests: 0 });
    setError(null);

    try {
      for (;;) {
        const r = await buscarTiendasLote({ startedAt });
        setDone((d) => d + r.processed);
        setTotals((t) => ({
          places: (t?.places ?? 0) + r.places,
          linked: (t?.linked ?? 0) + r.linked,
          found: (t?.found ?? 0) + r.found,
          requests: (t?.requests ?? 0) + r.requests,
        }));
        if (r.error) {
          setError(r.error);
          break;
        }
        if (!r.remaining || !r.processed || stop.current) break;
      }
    } catch {
      setError("Se perdió la conexión con el servidor. Lo ya buscado quedó guardado; puedes continuar.");
    }
    setRunning(false);
    router.refresh();
  };

  if (!configured) {
    return (
      <p className="flex items-center gap-2 px-4 py-3.5 text-[12.5px] text-[var(--text-secondary)]">
        <IconAlert size={14} /> Para buscar tiendas, guarda la API key en{" "}
        <Link href="/conexiones" className="font-medium text-[var(--brand)] hover:underline">Conexiones → Google Maps</Link>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={running || searches === 0} onClick={run}>
          <IconSearch size={14} /> {running ? "Buscando…" : `Buscar ahora · ${fmtNumber(searches)} búsquedas`}
        </button>
        {running && (
          <button type="button" className="btn btn-ghost" onClick={() => (stop.current = true)}>
            Detener
          </button>
        )}
      </div>

      {totals && (
        <div className="flex flex-col gap-1.5">
          <Meter value={done} max={Math.max(searches, done)} />
          <p className="text-[12px] text-[var(--text-muted)]">
            {fmtNumber(done)} de {fmtNumber(searches)} búsquedas · {fmtNumber(totals.places)} lugares de las cadenas ·{" "}
            {fmtNumber(totals.linked)} vinculados al maestro · {fmtNumber(totals.found)} nuevos · {fmtNumber(totals.requests)} consultas a Google
          </p>
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 text-[12.5px] text-[var(--critical)]">
          <IconAlert size={14} /> {error}
        </p>
      )}
    </div>
  );
}
