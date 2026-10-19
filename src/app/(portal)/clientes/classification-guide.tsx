import { CHANNELS, COMPANY_TYPES, type Option } from "@/lib/enums";
import { EnumBadge } from "@/components/ui";

function Criterio({ title, question, options }: { title: string; question: string; options: readonly Option[] }) {
  return (
    <div>
      <h4 className="text-[13px] font-semibold">{title}</h4>
      <p className="mb-2 text-[12px] text-[var(--text-muted)]">{question}</p>
      <dl className="flex flex-col gap-2">
        {options.map((o) => (
          <div key={o.value} className="grid grid-cols-[7.5rem_1fr] items-start gap-2">
            <dt><EnumBadge option={o} /></dt>
            <dd className="text-[12.5px] text-[var(--text-secondary)]">{o.hint}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Explica los dos ejes con los que se clasifica un cliente. Sale de los mismos
 * catálogos que pintan los badges, así que la definición nunca se desfasa.
 */
export function ClassificationGuide() {
  return (
    <details className="card mb-4 group">
      <summary className="cursor-pointer select-none px-4 py-3 text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        ¿Cómo se clasifica un cliente? Tipo de cliente y canal
      </summary>
      <div className="border-t border-[var(--border)] px-4 py-4">
        <div className="grid gap-6 lg:grid-cols-2">
          <Criterio title="Tipo de cliente" question="¿Qué clase de empresa nos compra? Define cómo se negocia: quién decide, cómo paga y con qué volumen." options={COMPANY_TYPES.options} />
          <Criterio title="Canal" question="¿Por dónde llega el producto al consumidor final? Define cómo se ejecuta en el punto de venta." options={CHANNELS.options} />
        </div>
        <p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] text-[var(--text-muted)]">
          Son dos ejes independientes. Una cadena suele estar en canal moderno, pero también puede ser una cadena de minimercados en canal tradicional o un
          supermercado online en e-commerce. Un mayorista casi siempre surte el canal tradicional. Si dudas, clasifica el canal según dónde ve el producto
          el consumidor final.
        </p>
      </div>
    </details>
  );
}
