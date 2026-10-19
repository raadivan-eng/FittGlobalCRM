-- Tiendas y contactos. Un contacto pertenece a un solo cliente y puede atender
-- varias de sus tiendas (StoreContact reemplaza a Contact.storeId). Un lead
-- nace con al menos una tienda (LeadStore) y un contacto (LeadContact), que
-- reemplazan los campos sueltos del lead y pasan al cliente al convertirlo.
--
-- D1 aplica las claves foráneas siempre: un DROP TABLE ejecuta los ON DELETE
-- CASCADE de quien apunte a la tabla. Por eso Contact se reconstruye antes de
-- que StoreContact y LeadContact la referencien, y a Lead (de la que cuelga
-- LeadEvent) sólo se le quitan columnas, sin recrearla.

-- Los vínculos contacto–tienda se apartan antes de reconstruir Contact.
CREATE TABLE "_ContactStore" AS
SELECT "storeId", "id" AS "contactId", "createdAt" FROM "Contact" WHERE "storeId" IS NOT NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "position" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "lastContactAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Contact" ("companyId", "createdAt", "email", "firstName", "id", "isDecisionMaker", "isPrimary", "lastContactAt", "lastName", "notes", "phone", "position") SELECT "companyId", "createdAt", "email", "firstName", "id", "isDecisionMaker", "isPrimary", "lastContactAt", "lastName", "notes", "phone", "position" FROM "Contact";
DROP TABLE "Contact";
ALTER TABLE "new_Contact" RENAME TO "Contact";
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "StoreContact" (
    "storeId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("storeId", "contactId"),
    CONSTRAINT "StoreContact_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoreContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadStore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "format" TEXT,
    "lat" REAL,
    "lng" REAL,
    "placeId" TEXT,
    "mapsUrl" TEXT,
    "storeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadStore_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "contactId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Datos: se copian mientras existen las columnas viejas del lead.
-- Cada contacto que estaba en una tienda queda vinculado a ella.
INSERT INTO "StoreContact" ("storeId", "contactId", "createdAt")
SELECT "storeId", "contactId", "createdAt" FROM "_ContactStore";
DROP TABLE "_ContactStore";

-- Cada lead conserva su tienda con lo que tenía; la de un lead ya convertido
-- apunta a la tienda 001 que creó la conversión.
INSERT INTO "LeadStore" ("id", "leadId", "name", "address", "city", "format", "lat", "lng", "placeId", "mapsUrl", "storeId", "createdAt")
SELECT 'ls-' || "id", "id", "name", "address", "city", "format", "lat", "lng", "placeId", "mapsUrl",
       (SELECT s."id" FROM "Store" s WHERE s."companyId" = "Lead"."companyId" AND s."code" = '001'),
       "createdAt"
FROM "Lead";

-- Y su contacto: el nombre que se sabía o, si no, el del negocio.
INSERT INTO "LeadContact" ("id", "leadId", "name", "position", "phone", "email", "contactId", "createdAt")
SELECT 'lc-' || "id", "id", COALESCE("contactName", "name"), NULL, "phone", "email",
       (SELECT c."id" FROM "Contact" c WHERE c."companyId" = "Lead"."companyId" ORDER BY c."isPrimary" DESC, c."createdAt" LIMIT 1),
       "createdAt"
FROM "Lead";

-- Lead pierde los campos sueltos sin recrearse (recrearla borraría LeadEvent).
DROP INDEX "Lead_phone_idx";
DROP INDEX "Lead_placeId_idx";
ALTER TABLE "Lead" DROP COLUMN "contactName";
ALTER TABLE "Lead" DROP COLUMN "phone";
ALTER TABLE "Lead" DROP COLUMN "email";
ALTER TABLE "Lead" DROP COLUMN "city";
ALTER TABLE "Lead" DROP COLUMN "address";
ALTER TABLE "Lead" DROP COLUMN "format";
ALTER TABLE "Lead" DROP COLUMN "lat";
ALTER TABLE "Lead" DROP COLUMN "lng";
ALTER TABLE "Lead" DROP COLUMN "placeId";
ALTER TABLE "Lead" DROP COLUMN "mapsUrl";

-- CreateIndex
CREATE INDEX "StoreContact_contactId_idx" ON "StoreContact"("contactId");

-- CreateIndex
CREATE INDEX "LeadStore_leadId_idx" ON "LeadStore"("leadId");

-- CreateIndex
CREATE INDEX "LeadStore_placeId_idx" ON "LeadStore"("placeId");

-- CreateIndex
CREATE INDEX "LeadContact_leadId_idx" ON "LeadContact"("leadId");

-- CreateIndex
CREATE INDEX "LeadContact_phone_idx" ON "LeadContact"("phone");

-- CreateIndex
CREATE INDEX "LeadContact_email_idx" ON "LeadContact"("email");
