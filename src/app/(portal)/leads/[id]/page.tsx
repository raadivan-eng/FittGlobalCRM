import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { LEAD_ENTRIES, LEAD_EVENTS, LEAD_OPEN, LEAD_SOURCES, LEAD_STATUS, LEAD_TEMPERATURE, STORE_FORMATS } from "@/lib/enums";
import { closePeriodOptions, LEAD_ROLES } from "@/lib/leads";
import { agregarNota, quitarContactoLead, quitarTiendaLead } from "@/lib/actions-leads";
import { claudeApiKey } from "@/lib/lector-documentos";
import { siigoCustomersReady } from "@/lib/siigo-clientes";
import { getForecastCriteria } from "@/lib/analytics";
import { leadPct } from "@/lib/forecast-criteria";
import { fmtDate, fmtDateTime, fmtMoney, fmtPeriod } from "@/lib/format";
import { Avatar, Card, CardHeader, EnumBadge, KeyValue, PageHeader } from "@/components/ui";
import { IconExternal, IconForecast, IconMail, IconPhone, IconPin } from "@/components/icons";
import { ConvertForm, DataForm, FollowUpForm, LeadContactEditor, LeadStoreEditor } from "../lead-controls";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { name: true } });
  return { title: lead?.name ?? "Lead" };
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("leads");
  const { id } = await params;

  const [lead, owners, reader, siigo, criteria] = await Promise.all([
    prisma.lead.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true, avatarColor: true } },
        createdBy: { select: { name: true } },
        company: { select: { id: true, code: true, name: true } },
        events: { orderBy: { occurredAt: "desc" }, take: 200, include: { user: { select: { name: true } } } },
        stores: { orderBy: { createdAt: "asc" }, include: { store: { select: { id: true, code: true } } } },
        contacts: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.user.findMany({ where: { active: true, role: { in: LEAD_ROLES } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    claudeApiKey().then(Boolean),
    siigoCustomersReady(),
    getForecastCriteria(),
  ]);
  if (!lead) notFound();

  const isOpen = (LEAD_OPEN as readonly string[]).includes(lead.status);
  const pct = leadPct(lead.temperature, criteria);
  const counts = isOpen && pct > 0 && lead.closePeriod && lead.expectedValue;
  const editable = !lead.company;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Leads", href: "/leads" }, { label: lead.code }]}
        title={lead.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <EnumBadge option={LEAD_STATUS.get(lead.status)} dot />
            <EnumBadge option={LEAD_TEMPERATURE.get(lead.temperature)} />
            <EnumBadge option={LEAD_SOURCES.get(lead.source)} />
            <span className="text-[12.5px] text-[var(--text-muted)]">
              {LEAD_ENTRIES.label(lead.entry)} · creado el {fmtDate(lead.createdAt)}
              {lead.createdBy ? ` por ${lead.createdBy.name}` : " por la integración"}
            </span>
          </span>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Card>
            <CardHeader title="Resumen" />
            <dl className="grid gap-x-6 px-4 py-2 sm:grid-cols-2">
              <KeyValue label="Origen">
                {LEAD_SOURCES.label(lead.source)}
                {lead.sourceDetail && <span className="block text-[12px] text-[var(--text-muted)]">{lead.sourceDetail}</span>}
              </KeyValue>
              <KeyValue label="Tiendas y contactos">
                {lead.stores.length} {lead.stores.length === 1 ? "tienda" : "tiendas"} · {lead.contacts.length} {lead.contacts.length === 1 ? "contacto" : "contactos"}
              </KeyValue>
            </dl>
            {lead.notes && (
              <p className="whitespace-pre-line border-t border-[var(--border)] px-4 py-3 text-[13px] text-[var(--text-secondary)]">{lead.notes}</p>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Tiendas"
              subtitle={editable ? "Los puntos de venta del negocio. Siempre queda al menos uno." : "Pasaron al cliente al convertirlo."}
              action={editable ? <LeadStoreEditor leadId={lead.id} /> : undefined}
            />
            <ul className="divide-y divide-[var(--border)]">
              {lead.stores.map((st) => {
                const mapsHref = st.mapsUrl ?? (st.lat != null && st.lng != null ? `https://www.google.com/maps?q=${st.lat},${st.lng}` : null);
                return (
                  <li key={st.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1 text-[13px]">
                      <p className="font-medium">
                        {st.store ? (
                          <Link href={`/tiendas/${st.store.id}`} className="hover:text-[var(--brand)] hover:underline">{st.name}</Link>
                        ) : (
                          st.name
                        )}
                        {st.format && <span className="ml-1.5 text-[12px] font-normal text-[var(--text-muted)]">{STORE_FORMATS.label(st.format)}</span>}
                      </p>
                      <p className="text-[12px] text-[var(--text-secondary)]">{[st.address, st.city].filter(Boolean).join(" · ") || "Sin dirección ni ciudad"}</p>
                      {mapsHref ? (
                        <a href={mapsHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-[var(--brand)] hover:underline">
                          <IconPin size={12} /> Ver en Google Maps <IconExternal size={11} />
                        </a>
                      ) : (
                        <p className="text-[12px] text-[var(--text-muted)]">Sin ubicar</p>
                      )}
                    </div>
                    {editable && (
                      <div className="flex items-start gap-1">
                        <LeadStoreEditor leadId={lead.id} row={st} />
                        {lead.stores.length > 1 && (
                          <form action={quitarTiendaLead}>
                            <input type="hidden" name="leadId" value={lead.id} />
                            <input type="hidden" name="storeId" value={st.id} />
                            <button type="submit" className="btn btn-ghost !px-2 text-[12.5px] text-[var(--tone-danger-fg)]">Quitar</button>
                          </form>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Contactos"
              subtitle={editable ? "Con quién se habla en el negocio. Siempre queda al menos uno." : "Pasaron al cliente al convertirlo."}
              action={editable ? <LeadContactEditor leadId={lead.id} /> : undefined}
            />
            <ul className="divide-y divide-[var(--border)]">
              {lead.contacts.map((c) => {
                const digits = c.phone?.replace(/\D/g, "");
                return (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1 text-[13px]">
                      <p className="font-medium">
                        {c.name}
                        {c.position && <span className="ml-1.5 text-[12px] font-normal text-[var(--text-muted)]">{c.position}</span>}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--text-secondary)]">
                        {c.phone && (
                          <>
                            <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-[var(--brand)]">
                              <IconPhone size={12} /> {c.phone}
                            </a>
                            <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline">WhatsApp</a>
                          </>
                        )}
                        {c.email && (
                          <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-[var(--brand)]">
                            <IconMail size={12} /> {c.email}
                          </a>
                        )}
                        {!c.phone && !c.email && <span className="text-[var(--text-muted)]">Sin teléfono ni correo</span>}
                      </p>
                    </div>
                    {editable && (
                      <div className="flex items-start gap-1">
                        <LeadContactEditor leadId={lead.id} row={c} />
                        {lead.contacts.length > 1 && (
                          <form action={quitarContactoLead}>
                            <input type="hidden" name="leadId" value={lead.id} />
                            <input type="hidden" name="contactId" value={c.id} />
                            <button type="submit" className="btn btn-ghost !px-2 text-[12.5px] text-[var(--tone-danger-fg)]">Quitar</button>
                          </form>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Bitácora" subtitle="Lo que escribió por WhatsApp o el formulario, las notas del equipo y cada cambio de seguimiento." />
            <form action={agregarNota} className="flex flex-col gap-2 border-b border-[var(--border)] px-4 py-3">
              <input type="hidden" name="id" value={lead.id} />
              <textarea name="body" rows={2} required className="field resize-none" placeholder="Llamada, visita, lo que pidió, próximo paso…" />
              <div>
                <button type="submit" className="btn btn-secondary">Agregar nota</button>
              </div>
            </form>
            <ol className="divide-y divide-[var(--border)]">
              {lead.events.map((e) => (
                <li key={e.id} className="flex gap-3 px-4 py-3">
                  <div className="w-[88px] shrink-0">
                    <EnumBadge option={LEAD_EVENTS.get(e.type)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-line break-words text-[13px]">{e.body}</p>
                    <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
                      {fmtDateTime(e.occurredAt)} · {e.user?.name ?? (e.source === "API" ? LEAD_SOURCES.label(lead.source) : "Portal")}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader title="Datos del lead" subtitle="Corrige el nombre del negocio y las observaciones a medida que los confirmes." />
            <div className="px-4 py-4">
              <DataForm lead={lead} />
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {lead.company ? (
            <Card>
              <CardHeader title="Ya es cliente" subtitle={lead.convertedAt ? `Convertido el ${fmtDate(lead.convertedAt)}` : undefined} />
              <div className="px-4 py-4">
                <Link href={`/clientes/${lead.company.id}`} className="font-medium text-[var(--brand)] hover:underline">
                  {lead.company.code} · {lead.company.name}
                </Link>
              </div>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title="Seguimiento" />
                {counts && (
                  <p className="flex items-start gap-2 border-b border-[var(--border)] bg-[var(--brand-soft)] px-4 py-2.5 text-[12.5px] text-[var(--brand-ink)]">
                    <IconForecast size={14} className="mt-px shrink-0" />
                    <span>
                      Suma {fmtMoney((lead.expectedValue! * pct) / 100)}{pct < 100 ? ` (${pct}% de su valor)` : ""} al{" "}
                      <Link href={`/forecast?periodo=${lead.closePeriod}`} className="font-semibold hover:underline">
                        forecast de {fmtPeriod(lead.closePeriod!)}
                      </Link>
                      .
                    </span>
                  </p>
                )}
                <div className="px-4 py-4">
                  <FollowUpForm lead={lead} owners={owners} periods={closePeriodOptions()} />
                </div>
              </Card>
              {isOpen && (
                <Card>
                  <CardHeader
                    title="Convertir en cliente"
                    subtitle="Crea el cliente con las tiendas y los contactos que elijas. Exige el RUT del cliente: de ahí salen sus datos tributarios y con ellos se crea también en Siigo. El valor esperado queda como forecast del cliente para el mes de cierre."
                  />
                  <div className="px-4 py-4">
                    <ConvertForm lead={lead} reader={reader} siigo={siigo} />
                  </div>
                </Card>
              )}
            </>
          )}

          <Card>
            <CardHeader title="Responsable" />
            <div className="flex items-center gap-2.5 px-4 py-3 text-[13px]">
              {lead.owner ? (
                <>
                  <Avatar name={lead.owner.name} color={lead.owner.avatarColor} size={28} />
                  {lead.owner.name}
                </>
              ) : (
                <span className="text-[var(--text-muted)]">Sin asignar: elígelo en Seguimiento.</span>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
