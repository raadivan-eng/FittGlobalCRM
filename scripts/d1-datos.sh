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
TABLES=(User Company Store Contact StoreContact StoreAssignment Visit ShelfReport Incident
        Product Warehouse InventoryLot SalesOrder SalesOrderLine Invoice Forecast
        ForecastExclusion Lead LeadStore LeadContact LeadEvent
        Shipment ShipmentEvent ApiConnection ApiConnectionEvent
        ApiConnectionModule LocatorSearch StoreCandidate Notification
        SellOutImport SellOut ProductAlias TradeActivity TradeActivityProduct
        TradeExecution)

echo "PRAGMA defer_foreign_keys = true;" > "$OUT"
for t in "${TABLES[@]}"; do
  sqlite3 -header "$DB_FILE" ".mode insert \"$t\"" "SELECT * FROM \"$t\";" >> "$OUT"
done

# SQLite local guarda las fechas como milisegundos; el adaptador de D1 las
# escribe y las lee en texto ISO. Se convierten al cargar para no mezclar, con
# la misma fórmula de la migración 0004 pero sobre toda columna DATETIME: así
# las tablas que nacieron después de esa migración también quedan en ISO.
for t in "${TABLES[@]}"; do
  sqlite3 "$DB_FILE" "SELECT name FROM pragma_table_info('$t') WHERE type = 'DATETIME';" | while read -r c; do
    echo "UPDATE \"$t\" SET \"$c\" = strftime('%Y-%m-%dT%H:%M:%S', \"$c\" / 1000, 'unixepoch') || '.' || printf('%03d', \"$c\" % 1000) || '+00:00' WHERE typeof(\"$c\") = 'integer';" >> "$OUT"
  done
done

echo "Filas por tabla:"
for t in "${TABLES[@]}"; do
  printf "  %-20s %s\n" "$t" "$(sqlite3 "$DB_FILE" "SELECT count(*) FROM \"$t\";")"
done

# D1_DESTINO=--local prueba la carga contra la D1 de `npm run preview`.
npx wrangler d1 execute fitt-crm "${D1_DESTINO:---remote}" --file "$OUT"
rm -f "$OUT"
