-- Localizador de tiendas: búsquedas por cadena y ciudad en Google Maps, tiendas
-- descubiertas por revisar y avisos dentro del portal. Store.placeId casa cada
-- tienda con su lugar en Google.

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "placeId" TEXT;

-- CreateTable
CREATE TABLE "LocatorSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "lastRunAt" DATETIME,
    "lastResults" INTEGER NOT NULL DEFAULT 0,
    "lastNew" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LocatorSearch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoreCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "placeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "mapsUrl" TEXT,
    "types" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NUEVA',
    "suggestedStoreId" TEXT,
    "storeId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "foundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoreCandidate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoreCandidate_suggestedStoreId_fkey" FOREIGN KEY ("suggestedStoreId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoreCandidate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoreCandidate_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LocatorSearch_lastRunAt_idx" ON "LocatorSearch"("lastRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocatorSearch_companyId_city_key" ON "LocatorSearch"("companyId", "city");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCandidate_placeId_key" ON "StoreCandidate"("placeId");

-- CreateIndex
CREATE INDEX "StoreCandidate_status_companyId_idx" ON "StoreCandidate"("status", "companyId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Store_placeId_idx" ON "Store"("placeId");

