#!/usr/bin/env bash
# Carga inicial de producción: copia los datos de prisma/dev.db a la base D1
# remota. Sólo para la primera vez, sobre una D1 con el esquema recién aplicado
# (`npm run d1:migrate`) y sin datos: si una fila ya existe, D1 rechaza el lote.
#
# Los INSERT llevan los nombres de columna porque `prisma db push` añade las
# columnas nuevas al final y el orden local puede no coincidir con la migración.
set -euo pipefail

DB_FILE="${1:-prisma/dev.db}"
OUT="$(mktemp -t fitt-d1).sql"

# Primero las raíces y luego lo que depende de ellas; además se difieren las
# llaves foráneas por si algún ciclo se escapa a este orden.
TABLES=(User Company Store Contact StoreAssignment Visit ShelfReport Incident
        Product Warehouse InventoryLot SalesOrder SalesOrderLine Invoice Forecast
        Shipment ShipmentEvent ApiConnection ApiConnectionEvent)

echo "PRAGMA defer_foreign_keys = true;" > "$OUT"
for t in "${TABLES[@]}"; do
  sqlite3 -header "$DB_FILE" ".mode insert \"$t\"" "SELECT * FROM \"$t\";" >> "$OUT"
done

echo "Filas por tabla:"
for t in "${TABLES[@]}"; do
  printf "  %-20s %s\n" "$t" "$(sqlite3 "$DB_FILE" "SELECT count(*) FROM \"$t\";")"
done

# D1_DESTINO=--local prueba la carga contra la D1 de `npm run preview`.
npx wrangler d1 execute fitt-crm "${D1_DESTINO:---remote}" --file "$OUT"
rm -f "$OUT"
