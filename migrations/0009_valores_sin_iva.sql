-- Facturación, ventas y forecast se miden sin IVA. `net` guarda el valor antes
-- de IVA (subtotal − descuento); `total` sigue con IVA y sólo lo usa la cartera.

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN "net" REAL NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "net" REAL NOT NULL DEFAULT 0;

-- Rellena lo ya sincronizado. Repetible sin daño.
UPDATE "SalesOrder" SET "net" = ROUND("subtotal" - "discount", 2);
UPDATE "Invoice" SET "net" = COALESCE(
  (SELECT o."net" FROM "SalesOrder" o WHERE o."id" = "Invoice"."orderId"),
  "total"
);
