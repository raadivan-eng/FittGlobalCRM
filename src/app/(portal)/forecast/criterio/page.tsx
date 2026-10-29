import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { companyForecasts, getForecastCriteria, leadForecasts, NOT_VOID, periodKey, periodShort, startOfMonth, sumForecasts } from "@/lib/analytics";
import { criteriaFromInput, DEFAULT_CRITERIA, describeCriteria, periodStart, sameCriteria, type ForecastCriteria } from "@/lib/forecast-criteria";
import { guardarCriterioForecast } from "@/lib/actions-sales";
import { FORECAST_METHODS } from "@/lib/enums";
import { fmtCompact, fmtDateTime, fmtMoney, fmtNumber, fmtPct, fmtPeriod } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { Card, CardHeader, PageHeader, StatTile } from "@/components/ui";
import { GroupedBarChart } from "@/components/charts";
import { IconForecast, IconLead, IconTarget } from "@/components/icons";
import { ForecastTabs } from "../tabs";

export const metadata = { title: "Criterio de forecast" };
export const dynamic = "force-dynamic";

/** Meses cerrados con que se mide qué tan bien acierta cada criterio. */
const BACKTEST_MONTHS = 6;

/** Query string que simula un criterio: con ella se comparte una simulación. */
function criteriaQuery(c: ForecastCriteria) {
  const q = new URLSearchParams({
    sim: "1",
    metodo: c.method,
    ventana: String(c.windowMonths),
    crecimiento: String(c.growthPct),
    factor: String(c.outlierFactor),
    inactivo: String(c.dormantMonths),
    caliente: String(c.hotLeadPct),
    tibio: String(c.warmLeadPct),
    mesesLead: String(c.leadMonths),
    nuevos: String(Math.round(c.newBusiness)),
  });
  if (c.fromFirstPurchase) q.set("primeraCompra", "on");
  if (c.capOutliers) q.set("recortar", "on");
  return `?${q}`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

function Check({ name, label, hint, checked }: { name: string; label: string; hint: string; checked: boolean }) {
  return (
    <label className="flex items-start gap-2 text-[13px]">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5" />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-[11px] text-[var(--text-muted)]">{hint}</span>
      </span>
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3.5 first:border-t-0">
      <legend className="float-left mb-0.5 w-full text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</legend>
      {children}
    </fieldset>
  );
}

const signed = (v: number) => (Math.round(v) === 0 ? "—" : `${v > 0 ? "+" : "−"}${fmtMoney(Math.abs(v))}`);
const deltaColor = (v: number) => (Math.round(v) === 0 ? "var(--text-muted)" : v > 0 ? "var(--good)" : "var(--critical)");
/** Lo que proyecta el criterio para todos los clientes, aunque alguno tenga carga manual encima. */
const sumBaseline = (byCompany: Map<string, { baseline: number }> | undefined) => {
  let total = 0;
  for (const f of byCompany?.values() ?? []) total += f.baseline;
  return total;
};

export default async function CriterioForecastPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("forecast");
  const sp = await searchParams;
  const canSave = user.role === "ADMIN";
  const now = new Date();

  const [saved, row] = await Promise.all([
    getForecastCriteria(),
    prisma.forecastCriteria.findUnique({ where: { id: "default" }, select: { updatedAt: true, updatedBy: { select: { name: true } } } }),
  ]);
  const simulating = one(sp.sim) === "1";
  const sim = simulating ? criteriaFromInput((name) => (sp[name] == null ? null : one(sp[name]))) : saved;
  const differs = !sameCriteria(sim, saved);

  const upcoming = Array.from({ length: 4 }, (_, i) => periodKey(startOfMonth(i, now)));
  const backtest = Array.from({ length: BACKTEST_MONTHS }, (_, i) => periodKey(startOfMonth(i - BACKTEST_MONTHS, now)));
  const next = upcoming[1];

  const [simUp, savedUp, simLeads, savedLeads, simBack, savedBack, invoices, companies] = await Promise.all([
    companyForecasts(upcoming, undefined, { criteria: sim }),
    differs ? companyForecasts(upcoming, undefined, { criteria: saved }) : null,
    leadForecasts(upcoming, sim),
    differs ? leadForecasts(upcoming, saved) : null,
    companyForecasts(backtest, undefined, { criteria: sim, manual: false }),
    differs ? companyForecasts(backtest, undefined, { criteria: saved, manual: false }) : null,
    prisma.invoice.findMany({
      where: { issueDate: { gte: periodStart(backtest[0]), lt: startOfMonth(0, now) }, status: NOT_VOID },
      select: { issueDate: true, net: true },
    }),
    prisma.company.findMany({ select: { id: true, name: true } }),
  ]);
  const savedUpcoming = savedUp ?? simUp;
  const savedLeadsBy = savedLeads ?? simLeads;
  const savedBacktest = savedBack ?? simBack;
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  // Próximos meses: base de clientes, leads y negocios sin identificar.
  const months = upcoming.map((p) => {
    const fc = simUp.get(p)!;
    const clients = sumForecasts(fc);
    const leads = simLeads.get(p)!;
    const total = clients + leads.total + sim.newBusiness;
    const savedTotal = sumForecasts(savedUpcoming.get(p)) + savedLeadsBy.get(p)!.total + saved.newBusiness;
    const manual = [...fc.values()].filter((f) => f.source === "MANUAL").length;
    const auto = sumBaseline(fc);
    const savedAuto = sumBaseline(savedUpcoming.get(p));
    return { period: p, auto, savedAuto, clients, leads: leads.total, leadCount: new Set(leads.leads.map((l) => l.id)).size, total, savedTotal, manual };
  });
  const nextMonth = months[1];

  // Backtest: lo que cada criterio habría proyectado para los meses cerrados,
  // sin cargas manuales ni leads (los ganados dejan de contar y no se pueden
  // reconstruir), contra lo que de verdad se facturó.
  const realBy = new Map<string, number>();
  for (const inv of invoices) {
    const k = periodKey(inv.issueDate);
    realBy.set(k, (realBy.get(k) ?? 0) + inv.net);
  }
  const back = backtest.map((p) => {
    const real = realBy.get(p) ?? 0;
    const simF = sumForecasts(simBack.get(p)) + sim.newBusiness;
    const savedF = sumForecasts(savedBacktest.get(p)) + saved.newBusiness;
    return {
      period: p,
      real,
      sim: simF,
      saved: savedF,
      simErr: real > 0 ? ((simF - real) / real) * 100 : null,
      savedErr: real > 0 ? ((savedF - real) / real) * 100 : null,
    };
  });
  const measured = back.filter((b) => b.real > 0);
  const mape = (key: "simErr" | "savedErr") =>
    measured.length ? measured.reduce((s, b) => s + Math.abs(b[key]!), 0) / measured.length : null;
  const bias = (key: "sim" | "saved") => {
    const real = measured.reduce((s, b) => s + b.real, 0);
    return real > 0 ? ((measured.reduce((s, b) => s + b[key], 0) - real) / real) * 100 : null;
  };
  const simMape = mape("simErr");
  const savedMape = mape("savedErr");
  const simBias = bias("sim");

  // Clientes cuya proyección automática más se mueve el mes siguiente al pasar
  // del criterio vigente al simulado. Si tienen carga manual, rige la carga.
  const simNext = simUp.get(next)!;
  const savedNext = savedUpcoming.get(next)!;
  const changes = [...new Set([...simNext.keys(), ...savedNext.keys()])]
    .map((id) => {
      const s = simNext.get(id);
      const v = savedNext.get(id);
      return { id, name: companyName.get(id) ?? "—", saved: v?.baseline ?? 0, sim: s?.baseline ?? 0, manual: s?.source === "MANUAL", dormant: s?.dormant ?? false, seasonal: s?.seasonal ?? false };
    })
    .filter((c) => Math.round(c.sim) !== Math.round(c.saved))
    .sort((a, b) => Math.abs(b.sim - b.saved) - Math.abs(a.sim - a.saved));
  const dormant = [...simNext.values()].filter((f) => f.dormant).length;

  const nbNext = nextMonth.leads + sim.newBusiness;

  return (
    <>
      <PageHeader
        title="Forecast de ventas"
        subtitle="Define con qué historia se proyecta cada cliente y cuánto pesan los negocios nuevos. Simula antes de guardar: el cambio se ve en los próximos meses y en qué tan bien habría acertado en los últimos seis."
      />
      <ForecastTabs active="/forecast/criterio" />

      {one(sp.guardado) === "1" && !simulating && (
        <p className="mb-4 rounded-lg border border-[var(--tone-success-bd)] bg-[var(--tone-success-bg)] px-4 py-2.5 text-[13px] text-[var(--tone-success-fg)]">
          Criterio guardado: el forecast, el tablero y la ejecución ya se proyectan con él.
        </p>
      )}
      {differs && (
        <p className="mb-4 rounded-lg border border-[var(--tone-warning-bd)] bg-[var(--tone-warning-bg)] px-4 py-2.5 text-[13px] text-[var(--tone-warning-fg)]">
          Estás viendo una simulación. Nada cambia en el forecast hasta que {canSave ? "la guardes" : "un administrador la guarde"}; puedes compartir este enlace para discutirla.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-4">
          <CardHeader
            title="Criterio"
            subtitle={row ? `Vigente desde ${fmtDateTime(row.updatedAt)}${row.updatedBy ? ` · ${row.updatedBy.name}` : ""}` : "Vigente: el de fábrica, promedio del año"}
          />
          <form action="/forecast/criterio">
            <input type="hidden" name="sim" value="1" />
            <Section title="Base histórica">
              <div className="flex flex-col gap-2">
                {FORECAST_METHODS.options.map((m) => (
                  <label key={m.value} className="flex items-start gap-2 text-[13px]">
                    <input type="radio" name="metodo" value={m.value} defaultChecked={sim.method === m.value} className="mt-0.5" />
                    <span>
                      <span className="font-medium">{m.label}</span>
                      <span className="block text-[11px] text-[var(--text-muted)]">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Meses de la ventana" hint="Móvil, ponderado y respaldo del estacional">
                  <input name="ventana" type="number" min={2} max={24} defaultValue={sim.windowMonths} className="field" />
                </Field>
                <Field label="Crecimiento %" hint="Sobre la base; negativo contrae">
                  <input name="crecimiento" inputMode="decimal" defaultValue={String(sim.growthPct).replace(".", ",")} className="field" />
                </Field>
              </div>
              <Check
                name="primeraCompra"
                label="Contar desde la primera compra"
                hint="Un cliente que entró a mitad de la ventana no se diluye entre los meses en que no existía."
                checked={sim.fromFirstPurchase}
              />
            </Section>

            <Section title="Depuración">
              <Check
                name="recortar"
                label="Recortar picos"
                hint="Los meses de un cliente por encima del factor × su mediana cuentan como ese tope. Complementa los meses extraordinarios marcados a mano."
                checked={sim.capOutliers}
              />
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Factor de pico" hint="También marca los meses atípicos">
                  <input name="factor" inputMode="decimal" defaultValue={String(sim.outlierFactor).replace(".", ",")} className="field" />
                </Field>
                <Field label="Inactivo tras (meses)" hint="Sin compra: se proyecta en 0. 0 lo apaga">
                  <input name="inactivo" type="number" min={0} max={12} defaultValue={sim.dormantMonths} className="field" />
                </Field>
              </div>
            </Section>

            <Section title="Nuevos negocios">
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Leads calientes %" hint="Del valor esperado">
                  <input name="caliente" type="number" min={0} max={100} defaultValue={sim.hotLeadPct} className="field" />
                </Field>
                <Field label="Leads tibios %" hint="0 para no contarlos">
                  <input name="tibio" type="number" min={0} max={100} defaultValue={sim.warmLeadPct} className="field" />
                </Field>
              </div>
              <Field label="Meses que aporta cada negocio" hint="1: sólo el mes de cierre. 3: cierre y los dos siguientes, hasta que tenga historia propia.">
                <input name="mesesLead" type="number" min={1} max={12} defaultValue={sim.leadMonths} className="field" />
              </Field>
              <Field label="Nuevos negocios sin identificar, por mes" hint="Lo que se espera abrir y todavía no tiene lead. Suma igual a todos los meses.">
                <input name="nuevos" inputMode="numeric" defaultValue={sim.newBusiness ? String(Math.round(sim.newBusiness)) : ""} placeholder="0" className="field" />
              </Field>
            </Section>

            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-3">
              <button className="btn btn-secondary">Simular</button>
              {canSave && (
                <button formAction={guardarCriterioForecast} className="btn btn-primary">
                  Guardar criterio
                </button>
              )}
              <span className="flex-1" />
              {differs && (
                <Link href="/forecast/criterio" className="btn btn-ghost !px-2 text-[12.5px]">
                  Descartar
                </Link>
              )}
              {!sameCriteria(sim, DEFAULT_CRITERIA) && (
                <Link href={`/forecast/criterio${criteriaQuery(DEFAULT_CRITERIA)}`} className="btn btn-ghost !px-2 text-[12.5px]" title="Promedio del año vigente y sólo leads calientes al 100%">
                  De fábrica
                </Link>
              )}
            </div>
          </form>
        </Card>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label={`Base automática ${periodShort(periodStart(next))}`}
              value={fmtCompact(nextMonth.auto)}
              delta={differs && nextMonth.savedAuto > 0 ? ((nextMonth.auto - nextMonth.savedAuto) / nextMonth.savedAuto) * 100 : null}
              hint={differs ? `vigente ${fmtCompact(nextMonth.savedAuto)}` : "Lo que proyecta el criterio para los clientes"}
              icon={<IconForecast size={15} />}
            />
            <StatTile
              label="Error histórico"
              value={simMape == null ? "—" : fmtPct(simMape)}
              delta={differs && simMape != null && savedMape != null ? simMape - savedMape : null}
              invertDelta
              hint={differs && savedMape != null ? `vigente ${fmtPct(savedMape)}` : `Desvío medio, ${measured.length} meses`}
              icon={<IconTarget size={15} />}
            />
            <StatTile
              label="Sesgo"
              value={simBias == null ? "—" : `${simBias >= 0 ? "+" : ""}${fmtPct(simBias)}`}
              hint={simBias == null ? "Sin facturación para medir" : simBias >= 0 ? "Proyecta por encima de lo real" : "Proyecta por debajo de lo real"}
              icon={<IconTarget size={15} />}
            />
            <StatTile
              label="Nuevos negocios"
              value={fmtCompact(nbNext)}
              hint={`${fmtNumber(nextMonth.leadCount)} leads${sim.newBusiness ? " + sin identificar" : ""} en ${periodShort(periodStart(next))}`}
              icon={<IconLead size={15} />}
            />
          </div>

          <Card>
            <CardHeader
              title="Así quedaría el forecast"
              subtitle={`Con el criterio ${differs ? "simulado" : "vigente"}: ${describeCriteria(sim)}. La base automática es lo que proyecta el criterio; en el total, los clientes con carga manual cuentan con su carga.`}
            />
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="num">Base automática</th>
                    <th className="num">Clientes</th>
                    <th className="num">Leads</th>
                    <th className="num">Sin identificar</th>
                    <th className="num">Total</th>
                    {differs && <th className="num">Vigente</th>}
                    {differs && <th className="num">Cambio</th>}
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.period}>
                      <td>
                        <Link href={`/forecast?periodo=${m.period}`} className="inline-block font-medium first-letter:uppercase hover:text-[var(--brand)] hover:underline">
                          {fmtPeriod(m.period)}
                        </Link>
                      </td>
                      <td className="num">
                        {fmtMoney(m.auto)}
                        {differs && (
                          <span className="block text-[11.5px]" style={{ color: deltaColor(m.auto - m.savedAuto) }}>
                            {signed(m.auto - m.savedAuto)}
                          </span>
                        )}
                      </td>
                      <td className="num">
                        {fmtMoney(m.clients)}
                        {m.manual > 0 && <span className="block text-[11.5px] text-[var(--text-muted)]">{fmtNumber(m.manual)} con carga manual</span>}
                      </td>
                      <td className="num">{m.leads ? fmtMoney(m.leads) : "—"}</td>
                      <td className="num">{sim.newBusiness ? fmtMoney(sim.newBusiness) : "—"}</td>
                      <td className="num font-semibold">{fmtMoney(m.total)}</td>
                      {differs && <td className="num text-[var(--text-secondary)]">{fmtMoney(m.savedTotal)}</td>}
                      {differs && (
                        <td className="num whitespace-nowrap" style={{ color: deltaColor(m.total - m.savedTotal) }}>
                          {signed(m.total - m.savedTotal)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="¿Qué tan bien habría acertado?"
              subtitle={`Lo que el criterio habría proyectado para los últimos ${BACKTEST_MONTHS} meses cerrados con lo que se sabía antes de cada uno, contra lo facturado. Sin cargas manuales ni leads, que no se pueden reconstruir.`}
            />
            <div className="px-4 py-4">
              <GroupedBarChart
                data={back.map((b) => ({ label: periodShort(periodStart(b.period)), values: differs ? [b.real, b.sim, b.saved] : [b.real, b.sim] }))}
                series={[
                  { name: "Facturación real", color: "var(--series-1)" },
                  { name: differs ? "Simulado" : "Criterio vigente", color: "var(--series-2)" },
                  ...(differs ? [{ name: "Vigente", color: "var(--series-3)" }] : []),
                ]}
                format="compact"
                height={220}
              />
            </div>
            <div className="scroll-x border-t border-[var(--border)]">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="num">Real</th>
                    <th className="num">{differs ? "Simulado" : "Proyectado"}</th>
                    <th className="num">Desvío</th>
                    {differs && <th className="num">Vigente</th>}
                    {differs && <th className="num">Desvío</th>}
                  </tr>
                </thead>
                <tbody>
                  {back.map((b) => (
                    <tr key={b.period}>
                      <td><span className="inline-block first-letter:uppercase">{fmtPeriod(b.period)}</span></td>
                      <td className="num font-semibold">{fmtMoney(b.real)}</td>
                      <td className="num">{fmtMoney(b.sim)}</td>
                      <td className="num">{b.simErr == null ? "—" : `${b.simErr >= 0 ? "+" : ""}${fmtPct(b.simErr)}`}</td>
                      {differs && <td className="num text-[var(--text-secondary)]">{fmtMoney(b.saved)}</td>}
                      {differs && <td className="num text-[var(--text-secondary)]">{b.savedErr == null ? "—" : `${b.savedErr >= 0 ? "+" : ""}${fmtPct(b.savedErr)}`}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[var(--surface-2)] font-semibold">
                    <td colSpan={3}>Desvío medio absoluto</td>
                    <td className="num">{simMape == null ? "—" : fmtPct(simMape)}</td>
                    {differs && <td />}
                    {differs && <td className="num">{savedMape == null ? "—" : fmtPct(savedMape)}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {differs && (
            <Card>
              <CardHeader
                title={`Clientes que más cambian · ${fmtPeriod(next)}`}
                subtitle={`${fmtNumber(changes.length)} clientes cambian su proyección automática${dormant ? `; ${fmtNumber(dormant)} quedan inactivos` : ""}. En los que tienen carga manual sigue rigiendo la carga.`}
              />
              {changes.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Ningún cliente cambia con este criterio.</p>
              ) : (
                <div className="scroll-x">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th className="num">Vigente</th>
                        <th className="num">Simulado</th>
                        <th className="num">Cambio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.slice(0, 12).map((c) => (
                        <tr key={c.id}>
                          <td>
                            <Link href={`/clientes/${c.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                              {c.name}
                            </Link>
                            {c.dormant && <span className="ml-1.5 text-[11.5px] text-[var(--text-muted)]">inactivo</span>}
                            {c.seasonal && <span className="ml-1.5 text-[11.5px] text-[var(--text-muted)]">estacional</span>}
                            {c.manual && <span className="ml-1.5 text-[11.5px] text-[var(--text-muted)]">con carga manual</span>}
                          </td>
                          <td className="num text-[var(--text-secondary)]">{fmtMoney(c.saved)}</td>
                          <td className="num font-semibold">{fmtMoney(c.sim)}</td>
                          <td className="num whitespace-nowrap" style={{ color: deltaColor(c.sim - c.saved) }}>
                            {signed(c.sim - c.saved)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
