/** Selector de año del presupuesto; conserva la vista en la que se está. */
export function YearSelect({ years, year, keep = {} }: { years: number[]; year: number; keep?: Record<string, string> }) {
  return (
    <form className="flex items-center gap-2">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <select name="anio" defaultValue={year} className="field w-28">
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <button className="btn btn-secondary">Ver año</button>
    </form>
  );
}
