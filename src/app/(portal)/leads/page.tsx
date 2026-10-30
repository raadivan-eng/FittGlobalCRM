import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { getForecastCriteria, leadForecasts, periodKey, startOfMonth } from "@/lib/analytics";
import { leadPct } from "@/lib/forecast-criteria";
import { CONNECTION_STATUS, LEAD_ENTRIES, LEAD_OPEN, LEAD_SOURCES, LEAD_STATUS, LEAD_TEMPERATURE } from "@/lib/enums";
import { closePeriodOptions, channelToken, LEAD_ROLES } from "@/lib/leads";
import { daysBetween, fmtCompact, fmtMoney, fmtNumber, fmtPeriod, relativeDays } from "@/lib/format";
import { anyOf, flatten, many, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, CardHeader, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconForecast, IconLead, IconPlus, IconTarget, IconCheck } from "@/components/icons";
import { CopyField, SyncMetaButton } from "./lead-controls";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

/** Lapso con que se mide la conversión: lo que se cerró, ganado o perdido. */
const DIAS_CONVERSION = 90;

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("leads");
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const status = one(sp.estado);
  const temperatures = many(sp.temperatura);
  const sources = many(sp.origen);
  // «Sin asignar» se puede combinar con responsables concretos: va como OR con `ownerId: null`.
  const ownerParams = many(sp.responsable);
  const unassigned = ownerParams.includes("SIN_ASIGNAR");
  const ownerIds = ownerParams.filter((o) => o !== "SIN_ASIGNAR");
  const close = one(sp.cierre);
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const now = new Date();
  const currentPeriod = periodKey(startOfMonth(0, now));
  const since = new Date(now.getTime() - DIAS_CONVERSION * 86_400_000);

  const where = {
    ...(status === "ABIERTOS" ? { status: { in: [...LEAD_OPEN] } } : status ? { status } : {}),
    ...(temperatures.length ? { temperature: anyOf(temperatures) } : {}),
    ...(sources.length ? { source: anyOf(sources) } : {}),
    // Va en AND para no chocar con el OR de la búsqueda.
    ...(unassigned && ownerIds.length
      ? { AND: [{ OR: [{ ownerId: null }, { ownerId: { in: ownerIds } }] }] }
      : unassigned
        ? { ownerId: null }
        : ownerIds.length
          ? { ownerId: anyOf(ownerIds) }
          : {}),
    ...(close ? { closePeriod: close } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { code: { contains: q } },
            { contacts: { some: { OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }] } } },
            { stores: { some: { OR: [{ name: { contains: q } }, { city: { contains: q } }] } } },
          ],
        }
      : {}),
  };

  const criteria = await getForecastCriteria();
  const [leads, total, open, hot, bySource, won, lost, monthLeads, owners, meta] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ lastActivityAt: "desc" }],
      skip,
      take,
      include: {
        owner: { select: { name: true } },
        company: { select: { id: true, code: true } },
        stores: { orderBy: { createdAt: "asc" }, select: { city: true } },
        contacts: { orderBy: { createdAt: "asc" }, take: 1, select: { name: true } },
      },
    }),
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ["status"], where: { status: { in: [...LEAD_OPEN] } }, _count: true }),
    prisma.lead.aggregate({
      where: { status: { in: [...LEAD_OPEN] }, temperature: "CALIENTE" },
      _count: true,
      _sum: { expectedValue: true },
    }),
    prisma.lead.groupBy({ by: ["source"], where: { status: { in: [...LEAD_OPEN] } }, _count: true }),
    prisma.lead.count({ where: { status: "GANADO", convertedAt: { gte: since } } }),
    prisma.lead.count({ where: { status: "PERDIDO", updatedAt: { gte: since } } }),
    leadForecasts([currentPeriod], criteria),
    prisma.user.findMany({ where: { active: true, role: { in: LEAD_ROLES } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.apiConnection.findUnique({ where: { provider: "META" }, select: { status: true } }),
  ]);

  const openTotal = open.reduce((s, r) => s + r._count, 0);
  const fresh = open.find((r) => r.status === "NUEVO")?._count ?? 0;
  const month = monthLeads.get(currentPeriod)!;
  const closed = won + lost;
  const filtered = Boolean(q || status || temperatures.length || sources.length || ownerParams.length || close);

  // Las URLs de los canales se arman con el host por el que se entró: así sirven
  // igual en producción que en una vista previa.
  const isAdmin = user.role === "ADMIN";
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Negocios que todavía no son clientes y se quieren convertir: los que llegan por redes, WhatsApp, la web o contacto directo, y los que sale a buscar el área comercial. Los que tienen mes y valor suman al forecast según su temperatura y el criterio."
        actions={
          <>
            {meta?.status && meta.status !== "SIN_CONFIGURAR" && <SyncMetaButton />}
            <Link href="/leads/nuevo" className="btn btn-primary">
              <IconPlus size={14} /> Nuevo lead
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Leads abiertos"
          value={fmtNumber(openTotal)}
          hint={`${fmtNumber(fresh)} sin contactar todavía`}
          icon={<IconLead size={15} />}
          href="/leads?estado=ABIERTOS"
        />
        <StatTile
          label="Calientes"
          value={fmtNumber(hot._count)}
          hint={`${fmtCompact(hot._sum.expectedValue ?? 0)} en valor esperado`}
          icon={<IconTarget size={15} />}
          href="/leads?estado=ABIERTOS&temperatura=CALIENTE"
        />
        <StatTile
          label={`Al forecast de ${fmtPeriod(currentPeriod).split(" ")[0]}`}
          value={fmtCompact(month.total)}
          hint={`${fmtNumber(month.leads.length)} lead${month.leads.length === 1 ? "" : "s"} aporta${month.leads.length === 1 ? "" : "n"} este mes según el criterio`}
          icon={<IconForecast size={15} />}
          href="/forecast"
        />
        <StatTile
          label={`Conversión · ${DIAS_CONVERSION} días`}
          value={closed ? `${Math.round((won / closed) * 100)}%` : "—"}
          hint={`${fmtNumber(won)} ganados · ${fmtNumber(lost)} perdidos`}
          icon={<IconCheck size={15} />}
          href="/leads?estado=GANADO"
        />
      </div>

      {bySource.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[12px]">
          <span className="font-semibold text-[var(--text-secondary)]">Abiertos por origen</span>
          {LEAD_SOURCES.options
            .map((o) => ({ o, n: bySource.find((b) => b.source === o.value)?._count ?? 0 }))
            .filter((x) => x.n > 0)
            .map(({ o, n }) => (
              <Link key={o.value} href={`/leads?estado=ABIERTOS&origen=${o.value}`} className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--brand)]">
                <span className={`h-1.5 w-1.5 rounded-full dot-${o.tone}`} />
                {o.label}
                <span className="font-semibold tabular-nums text-[var(--text-primary)]">{fmtNumber(n)}</span>
              </Link>
            ))}
        </div>
      )}

      <div className="mt-5">
        <Filters
          fields={[
            { type: "search", name: "q", placeholder: "Negocio, contacto, teléfono, ciudad o código…", width: "w-full sm:w-80" },
            {
              type: "select", name: "estado", label: "Estado",
              options: [{ value: "ABIERTOS", label: "Abiertos (todos)" }, ...LEAD_STATUS.options.map((o) => ({ value: o.value, label: o.label }))],
              width: "w-48",
            },
            { type: "select", name: "temperatura", label: "Temperatura", options: LEAD_TEMPERATURE.options.map((o) => ({ value: o.value, label: o.label })), width: "w-40", multi: true },
            { type: "select", name: "origen", label: "Origen", options: LEAD_SOURCES.options.map((o) => ({ value: o.value, label: o.label })), width: "w-40", multi: true },
            {
              type: "select", name: "responsable", label: "Responsable",
              options: [{ value: "SIN_ASIGNAR", label: "Sin asignar" }, ...owners.map((u) => ({ value: u.id, label: u.name }))],
              width: "w-48",
              multi: true,
            },
            {
              type: "select", name: "cierre", label: "Mes de cierre",
              options: [...new Set([...(close ? [close] : []), ...closePeriodOptions(now)])].sort().map((p) => ({ value: p, label: fmtPeriod(p) })),
              width: "w-48",
            },
          ]}
        />

        <Card>
          {leads.length === 0 ? (
            <EmptyState
              icon={<IconLead size={26} />}
              title={filtered ? "Ningún lead coincide" : "Todavía no hay leads"}
              description={
                filtered
                  ? "Prueba con otro estado, origen o responsable."
                  : "Los que lleguen por Meta o la web aparecen aquí solos. Para prospectar una tienda, arranca un sales hunt."
              }
              action={
                <Link href="/leads/nuevo" className="btn btn-primary">
                  <IconPlus size={14} /> Nuevo lead
                </Link>
              }
            />
          ) : (
            <>
              <div className="scroll-x">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Origen</th>
                      <th>Estado</th>
                      <th>Temperatura</th>
                      <th>Cierre tentativo</th>
                      <th className="num">Valor</th>
                      <th>Responsable</th>
                      <th>Última actividad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l) => {
                      const days = daysBetween(l.lastActivityAt, now);
                      const pct = leadPct(l.temperature, criteria);
                      const counts = pct > 0 && LEAD_OPEN.includes(l.status as never) && l.closePeriod && l.expectedValue;
                      return (
                        <tr key={l.id}>
                          <td className="min-w-[200px]">
                            <Link href={`/leads/${l.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                              {l.name}
                            </Link>
                            <span className="block text-[11.5px] text-[var(--text-muted)]">
                              <span className="font-mono">{l.code}</span>
                              {l.contacts[0] && l.contacts[0].name !== l.name ? ` · ${l.contacts[0].name}` : ""}
                              {l.stores[0]?.city ? ` · ${l.stores[0].city}` : ""}
                              {l.stores.length > 1 ? ` · ${l.stores.length} tiendas` : ""}
                            </span>
                          </td>
                          <td className="min-w-[150px]">
                            <span className="flex flex-wrap items-center gap-1">
                              <EnumBadge option={LEAD_SOURCES.get(l.source)} />
                              {l.entry === "SALES_HUNT" && l.source !== "SALES_HUNT" && <EnumBadge option={LEAD_ENTRIES.get(l.entry)} />}
                            </span>
                            {l.sourceDetail && (
                              <span className="mt-0.5 block max-w-[220px] truncate text-[11.5px] text-[var(--text-muted)]" title={l.sourceDetail}>
                                {l.sourceDetail}
                              </span>
                            )}
                          </td>
                          <td>
                            <EnumBadge option={LEAD_STATUS.get(l.status)} dot />
                            {l.company && (
                              <Link href={`/clientes/${l.company.id}`} className="mt-0.5 block text-[11.5px] text-[var(--brand)] hover:underline">
                                Cliente {l.company.code}
                              </Link>
                            )}
                          </td>
                          <td><EnumBadge option={LEAD_TEMPERATURE.get(l.temperature)} /></td>
                          <td className="whitespace-nowrap">
                            {l.closePeriod ? (
                              <span className="first-letter:uppercase inline-block">{fmtPeriod(l.closePeriod)}</span>
                            ) : (
                              <span className="text-[var(--text-muted)]">—</span>
                            )}
                            {counts && <span className="block text-[11px] text-[var(--text-muted)]">Suma al forecast{pct < 100 ? ` al ${pct}%` : ""}</span>}
                          </td>
                          <td className="num whitespace-nowrap">{l.expectedValue ? fmtMoney(l.expectedValue) : <span className="text-[var(--text-muted)]">—</span>}</td>
                          <td className="whitespace-nowrap text-[var(--text-secondary)]">{l.owner?.name ?? <span className="text-[var(--text-muted)]">Sin asignar</span>}</td>
                          <td className="whitespace-nowrap text-[var(--text-secondary)]">{relativeDays(days)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/leads" />
            </>
          )}
        </Card>
      </div>

      {isAdmin && (
        <Card className="mt-5">
          <CardHeader
            title="Canales de entrada"
            subtitle="Lo que llega por estas vías entra solo como lead nuevo y avisa al equipo comercial. Si la persona ya era lead —mismo teléfono, correo o id— el mensaje se suma a su bitácora."
          />
          <div className="grid gap-5 px-4 py-4 lg:grid-cols-2">
            <section className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <h3 className="text-[13.5px] font-semibold">Meta · Facebook, Instagram y WhatsApp</h3>
                <EnumBadge option={CONNECTION_STATUS.get(meta?.status ?? "SIN_CONFIGURAR")} />
              </div>
              <p className="text-[12.5px] text-[var(--text-secondary)]">
                En la app de Meta, registra esta URL como webhook con el token de verificación. Suscribe el campo <code>leadgen</code> de
                cada página (formularios de Lead Ads) y <code>messages</code> de la cuenta de WhatsApp Business. Quien escriba desde un
                anuncio queda con el anuncio como origen; quien escriba directo, como WhatsApp.
              </p>
              <CopyField label="URL del webhook" value={`${base}/api/webhooks/meta`} />
              <CopyField label="Token de verificación" value={channelToken("meta")} secret />
              <p className="text-[12px] text-[var(--text-muted)]">
                Necesita la clave secreta de la app en{" "}
                <Link href="/conexiones" className="text-[var(--brand)] hover:underline">Conexiones API</Link>: con ella se comprueba que cada aviso viene de Meta.
              </p>
            </section>
            <section className="flex flex-col gap-2.5">
              <h3 className="text-[13.5px] font-semibold">Formulario de contacto del sitio web</h3>
              <p className="text-[12.5px] text-[var(--text-secondary)]">
                El servidor del sitio (o el constructor de formularios) envía un POST con <code>nombre</code>, <code>empresa</code>,{" "}
                <code>telefono</code>, <code>correo</code>, <code>ciudad</code> y <code>mensaje</code>, en JSON o como formulario, con la clave
                en la cabecera <code>x-lead-key</code>. No la pongas en el HTML de la página: quedaría pública.
              </p>
              <CopyField label="URL" value={`${base}/api/leads/web`} />
              <CopyField label="Clave" value={channelToken("web")} secret />
            </section>
          </div>
        </Card>
      )}
    </>
  );
}
