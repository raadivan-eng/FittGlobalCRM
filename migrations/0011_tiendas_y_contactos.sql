-- Tiendas y contactos. Un contacto pertenece a un solo cliente y puede atender
-- varias de sus tiendas (StoreContact reemplaza a Contact.storeId). Un lead
-- nace con al menos una tienda (LeadStore) y un contacto (LeadContact), que
-- reemplazan los campos sueltos del lead y pasan al cliente al convertirlo.

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

-- Datos: se copian antes de redefinir las tablas, mientras existen las columnas viejas.

-- Cada contacto que estaba en una tienda queda vinculado a ella.
INSERT INTO "StoreContact" ("storeId", "contactId", "createdAt")
SELECT "storeId", "id", "createdAt" FROM "Contact" WHERE "storeId" IS NOT NULL;

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
CREATE TABLE "new_Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "entry" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceDetail" TEXT,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NUEVO',
    "temperature" TEXT NOT NULL DEFAULT 'FRIO',
    "name" TEXT NOT NULL,
    "closePeriod" TEXT,
    "expectedValue" REAL,
    "lostReason" TEXT,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT,
    "companyId" TEXT,
    "convertedAt" DATETIME,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Lead" ("closePeriod", "code", "companyId", "convertedAt", "createdAt", "createdById", "entry", "expectedValue", "externalId", "id", "lastActivityAt", "lostReason", "name", "notes", "ownerId", "source", "sourceDetail", "status", "temperature", "updatedAt") SELECT "closePeriod", "code", "companyId", "convertedAt", "createdAt", "createdById", "entry", "expectedValue", "externalId", "id", "lastActivityAt", "lostReason", "name", "notes", "ownerId", "source", "sourceDetail", "status", "temperature", "updatedAt" FROM "Lead";
DROP TABLE "Lead";
ALTER TABLE "new_Lead" RENAME TO "Lead";
CREATE UNIQUE INDEX "Lead_code_key" ON "Lead"("code");
CREATE INDEX "Lead_status_temperature_idx" ON "Lead"("status", "temperature");
CREATE INDEX "Lead_closePeriod_idx" ON "Lead"("closePeriod");
CREATE INDEX "Lead_externalId_idx" ON "Lead"("externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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

