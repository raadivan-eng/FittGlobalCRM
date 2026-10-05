"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { analizarImportacionTiendas, importarTiendas, type ImportResult } from "@/lib/actions-stores";
import type { ImportPreview } from "@/lib/store-import";
import { CHANNELS } from "@/lib/enums";
import { fmtNumber } from "@/lib/format";
import { Badge, Card, CardHeader, StatTile } from "@/components/ui";
import { IconAlert, IconCheck, IconStore } from "@/components/icons";

export function StoreImport() {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<ImportResult["done"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"analizar" | "importar" | null>(null);
  const [pending, startTransition] = useTransition();

  // El archivo se envía a mano y no con <form action>: React reinicia el
  // formulario tras cada acción y el input perdería el archivo elegido.
  const send = (which: "analizar" | "importar") => {
    const file = input.current?.files?.[0];
    if (!file) {
      setError("Elige el archivo .xlsx de puntos de venta.");
      return;
    }
    const data = new FormData();
    data.set("archivo", file);
    setError(null);
    setStep(which);
    startTransition(async () => {
      if (which === "analizar") {
        const r = await analizarImportacionTiendas(data);
        setPreview(r.preview ?? null);
        setDone(null);
        if (r.error) setError(r.error);
      } else {
        const r = await importarTiendas(data);
        if (r.error) setError(r.error);
        if (r.done) {
          setDone(r.done);
          setPreview(null);
        }
      }
    });
  };

  const reset = () => {
    setPreview(null);
    setDone(null);
    setError(null);
  };

  const t = preview?.totals;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader title="Archivo" subtitle="En Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx)" />
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={reset}
            className="field max-w-full flex-1 py-1.5"
          />
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => send("analizar")}>
            {pending && step === "analizar" ? "Leyendo…" : "Analizar"}
          </button>
        </div>
        {error && (
          <p className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2.5 text-[12.5px] text-[var(--critical)]">
            <IconAlert size={14} /> {error}
          </p>
        )}
      </Card>

      {done && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <p className="flex items-center gap-2 text-[13px]">
              <span className="text-[var(--good)]"><IconCheck size={16} /></span>
              Importación aplicada: {fmtNumber(done.created)} tiendas nuevas, {fmtNumber(done.updated)} actualizadas,{" "}
              {fmtNumber(done.companies)} clientes y {fmtNumber(done.merchandisers)} mercaderistas creados,{" "}
              {fmtNumber(done.assignments)} asignaciones nuevas.
            </p>
            <Link href="/tiendas" className="btn btn-primary">Ver tiendas</Link>
          </div>
        </Card>
      )}

      {preview && t && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Tiendas nuevas" value={fmtNumber(t.created)} hint={`de ${fmtNumber(t.stores)} en el archivo`} icon={<IconStore size={15} />} />
            <StatTile label="Con cambios" value={fmtNumber(t.updated)} hint={`${fmtNumber(t.unchanged)} sin cambios`} />
            <StatTile label="No visitables" value={fmtNumber(t.inactive)} hint="Quedan fuera de las rutas" />
            <StatTile label="Conflictos" value={fmtNumber(t.conflicts)} hint="No se importan" />
          </div>

          <Card>
            <CardHeader
              title="Antes de confirmar"
              subtitle={`${preview.fileName} · ${fmtNumber(t.rows)} filas leídas`}
              action={
                <button type="button" className="btn btn-primary" disabled={pending} onClick={() => send("importar")}>
                  {pending && step === "importar" ? "Importando…" : `Importar ${fmtNumber(t.created + t.updated)} tiendas`}
                </button>
              }
            />
            <ul className="flex flex-col gap-1.5 px-4 py-3.5 text-[12.5px] text-[var(--text-secondary)]">
              {preview.sheets.map((s) => (
                <li key={s.name}>
                  Pestaña <strong className="text-[var(--text-primary)]">{s.name}</strong>: {fmtNumber(s.rows)} filas
                  {s.used ? "" : ` · ignorada (${s.note})`}
                </li>
              ))}
              {t.merged > 0 && <li>{fmtNumber(t.merged)} filas repetidas idénticas se fusionaron.</li>}
              {t.withoutAddress > 0 && (
                <li>
                  <strong className="text-[var(--text-primary)]">{fmtNumber(t.withoutAddress)}</strong> tiendas visitables
                  no tienen dirección: no se podrán ubicar en el mapa hasta completarla.
                </li>
              )}
              {t.withoutCity > 0 && <li>{fmtNumber(t.withoutCity)} tiendas no tienen ciudad.</li>}
              {t.skipped > 0 && <li>{fmtNumber(t.skipped)} filas sin código o sin razón social se omiten.</li>}
            </ul>
          </Card>

          <div className="grid items-start gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="Clientes" subtitle="Agrupados por razón social" />
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Razón social</th>
                    <th>Canal</th>
                    <th className="num">Tiendas</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.companies.map((c) => (
                    <tr key={c.name}>
                      <td>
                        {c.name} {c.isNew && <Badge tone="info">nuevo</Badge>}
                      </td>
                      <td className="text-[var(--text-secondary)]">{CHANNELS.label(c.channel)}</td>
                      <td className="num">{fmtNumber(c.stores)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader title="Mercaderistas" subtitle="Los nuevos se crean sin acceso al portal hasta darles correo y clave" />
                {preview.merchandisers.length === 0 ? (
                  <p className="px-4 py-3.5 text-[12.5px] text-[var(--text-muted)]">La hoja no asigna mercaderistas.</p>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th className="num">Tiendas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.merchandisers.map((m) => (
                        <tr key={m.name}>
                          <td>
                            {m.name} {m.exists ? <Badge tone="success">existe</Badge> : <Badge tone="warning">se crea</Badge>}
                          </td>
                          <td className="num">{fmtNumber(m.stores)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              {preview.inactiveByReason.length > 0 && (
                <Card>
                  <CardHeader title="No visitables" subtitle="Se guardan inactivas" />
                  <table className="tbl">
                    <tbody>
                      {preview.inactiveByReason.map((r) => (
                        <tr key={r.reason}>
                          <td>{r.reason}</td>
                          <td className="num">{fmtNumber(r.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          </div>

          {preview.conflicts.length > 0 && (
            <Card>
              <CardHeader
                title="Códigos en conflicto"
                subtitle="El mismo código aparece con tiendas distintas. Corrige la hoja y vuelve a importar."
              />
              <div className="scroll-x">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Cliente · código</th>
                      <th>Dónde</th>
                      <th>Nombre</th>
                      <th>Ciudad</th>
                      <th>Dirección</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.conflicts.flatMap((c) =>
                      c.variants.map((v, i) => (
                        <tr key={`${c.company}-${c.code}-${i}`}>
                          <td className="whitespace-nowrap">{i === 0 ? <strong>{c.company} · {c.code}</strong> : ""}</td>
                          <td className="whitespace-nowrap text-[var(--text-muted)]">{v.where}</td>
                          <td>{v.name}</td>
                          <td className="text-[var(--text-secondary)]">{v.city}</td>
                          <td className="text-[var(--text-secondary)]">{v.address || "—"}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {preview.updates.length > 0 && (
            <Card>
              <CardHeader title="Cambios sobre tiendas existentes" subtitle={t.updated > preview.updates.length ? `Primeras ${preview.updates.length} de ${fmtNumber(t.updated)}` : undefined} />
              <table className="tbl">
                <tbody>
                  {preview.updates.map((u) => (
                    <tr key={`${u.company}-${u.code}`}>
                      <td>
                        {u.name}
                        <p className="text-[11.5px] text-[var(--text-muted)]">{u.company} · {u.code}</p>
                      </td>
                      <td className="text-[var(--text-secondary)]">{u.fields.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {preview.skipped.length > 0 && (
            <Card>
              <CardHeader title="Filas omitidas" />
              <ul className="flex flex-col gap-1 px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">
                {preview.skipped.map((s) => (
                  <li key={s.where}>{s.where}: {s.reason}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
