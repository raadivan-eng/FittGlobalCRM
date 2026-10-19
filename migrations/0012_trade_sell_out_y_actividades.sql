-- Trade: sell-out por tienda y mes, equivalencias de código por cadena, bitácora
-- de cargas, y actividades de trade con su ejecución tienda por tienda.

-- CreateTable
CREATE TABLE "SellOut" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "period" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "amount" REAL,
    "source" TEXT NOT NULL DEFAULT 'ARCHIVO',
    "importId" TEXT,
    CONSTRAINT "SellOut_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SellOut_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SellOut_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SellOut_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SellOutImport" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SellOutImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ARCHIVO',
    "fileName" TEXT,
    "sheet" TEXT,
    "periods" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedUnits" INTEGER NOT NULL DEFAULT 0,
    "unmatched" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SellOutImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SellOutImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANEADA',
    "title" TEXT NOT NULL,
    "mechanic" TEXT,
    "description" TEXT,
    "companyId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "budget" REAL NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "createdById" TEXT,
    "closingNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeActivity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeActivityProduct" (
    "activityId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

-- CreateTable
CREATE TABLE "TradeExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "notes" TEXT,
    "evidenceUrl" TEXT,
    "checkedAt" DATETIME,
    "checkedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeExecution_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "TradeActivity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeExecution_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeExecution_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SellOut_companyId_period_idx" ON "SellOut"("companyId", "period");

-- CreateIndex
CREATE INDEX "SellOut_period_idx" ON "SellOut"("period");

-- CreateIndex
CREATE UNIQUE INDEX "SellOut_storeId_productId_period_key" ON "SellOut"("storeId", "productId", "period");

-- CreateIndex
CREATE INDEX "ProductAlias_productId_idx" ON "ProductAlias"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_companyId_code_key" ON "ProductAlias"("companyId", "code");

-- CreateIndex
CREATE INDEX "SellOutImport_companyId_createdAt_idx" ON "SellOutImport"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeActivity_code_key" ON "TradeActivity"("code");

-- CreateIndex
CREATE INDEX "TradeActivity_status_startDate_idx" ON "TradeActivity"("status", "startDate");

-- CreateIndex
CREATE INDEX "TradeActivity_companyId_idx" ON "TradeActivity"("companyId");

-- CreateIndex
CREATE INDEX "TradeActivityProduct_productId_idx" ON "TradeActivityProduct"("productId");

-- CreateIndex
CREATE INDEX "TradeExecution_storeId_status_idx" ON "TradeExecution"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeExecution_activityId_storeId_key" ON "TradeExecution"("activityId", "storeId");
