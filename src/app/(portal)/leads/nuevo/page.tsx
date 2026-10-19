import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { closePeriodOptions, LEAD_ROLES } from "@/lib/leads";
import { mapsKey } from "@/lib/geocoding";
import { one, type SearchParams } from "@/lib/params";
import { PageHeader } from "@/components/ui";
import { NewLeadForm } from "./lead-form";

export const metadata = { title: "Nuevo lead" };
export const dynamic = "force-dynamic";

export default async function NuevoLeadPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("leads");
  const sp = await searchParams;
  const mode = one(sp.tipo) === "medio" ? "INBOUND" : "SALES_HUNT";

  const [owners, key] = await Promise.all([
    prisma.user.findMany({ where: { active: true, role: { in: LEAD_ROLES } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    mapsKey(),
  ]);

  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-[13px] transition-colors ${active ? "bg-[var(--surface-1)] font-semibold shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Leads", href: "/leads" }, { label: "Nuevo lead" }]}
        title="Nuevo lead"
        subtitle={
          mode === "SALES_HUNT"
            ? "Un sales hunt siempre arranca por la tienda: búscala en Google Maps (o marca su ubicación) y completa lo que sepas del negocio."
            : "Para quien escribió o llamó directo. Lo que llega por Facebook, Instagram, WhatsApp o el formulario web entra solo."
        }
      />
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-[var(--surface-2)] p-1">
        <Link href="/leads/nuevo" className={tab(mode === "SALES_HUNT")}>Sales hunt</Link>
        <Link href="/leads/nuevo?tipo=medio" className={tab(mode === "INBOUND")}>Llegó por un medio</Link>
      </div>
      <NewLeadForm key={mode} mode={mode} owners={owners} defaultOwnerId={user.id} periods={closePeriodOptions()} mapsReady={Boolean(key)} />
    </>
  );
}
