-- Compras: proveedores (traídos de Siigo o convertidos desde una cotización),
-- sus condiciones de compra por SKU, y la cotización de proveedores nuevos con
-- sus SKU cotizados y su bitácora. Sólo crea tablas: no toca las existentes.

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'CRM',
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "address" TEXT,
    "paymentTerms" TEXT,
    "paymentTermDays" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "siigoId" TEXT,
    "fiscalData" TEXT,
    "chamberData" TEXT,
    "siigoError" TEXT,
    "ownerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Supplier_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "productId" TEXT,
    "minOrderQty" INTEGER NOT NULL,
    "unitCost" REAL NOT NULL,
    "productionLeadDays" INTEGER NOT NULL,
    "transitDays" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SOLICITADA',
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "paymentTerms" TEXT,
    "paymentTermDays" INTEGER,
    "discardReason" TEXT,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT,
    "supplierId" TEXT,
    "convertedAt" DATETIME,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierQuote_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SupplierQuote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SupplierQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierQuoteLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "productId" TEXT,
    "minOrderQty" INTEGER,
    "unitCost" REAL,
    "productionLeadDays" INTEGER,
    "transitDays" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierQuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SupplierQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierQuoteLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierQuoteEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "userId" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierQuoteEvent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SupplierQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierQuoteEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_taxId_idx" ON "Supplier"("taxId");

-- CreateIndex
CREATE INDEX "Supplier_active_origin_idx" ON "Supplier"("active", "origin");

-- CreateIndex
CREATE INDEX "SupplierProduct_productId_idx" ON "SupplierProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_supplierId_sku_key" ON "SupplierProduct"("supplierId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuote_code_key" ON "SupplierQuote"("code");

-- CreateIndex
CREATE INDEX "SupplierQuote_status_idx" ON "SupplierQuote"("status");

-- CreateIndex
CREATE INDEX "SupplierQuoteLine_productId_idx" ON "SupplierQuoteLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuoteLine_quoteId_sku_key" ON "SupplierQuoteLine"("quoteId", "sku");

-- CreateIndex
CREATE INDEX "SupplierQuoteEvent_quoteId_occurredAt_idx" ON "SupplierQuoteEvent"("quoteId", "occurredAt");

