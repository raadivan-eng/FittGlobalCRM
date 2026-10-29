-- Presupuesto general por cuenta y mes, participación de cada cliente en él,
-- y sus rubros y criterios configurables. Sólo crea tablas nuevas: no redefine
-- ninguna existente, así que no dispara cascadas en D1.

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "period" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BudgetLine_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BudgetRubro" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "prefixes" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BudgetSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "allocation" TEXT NOT NULL DEFAULT 'VENTAS',
    "creditNotes" BOOLEAN NOT NULL DEFAULT true,
    "referenceMonths" INTEGER NOT NULL DEFAULT 12,
    "spread" TEXT NOT NULL DEFAULT 'ESTACIONAL',
    "warnPct" REAL NOT NULL DEFAULT 90,
    "expenseTolerancePct" REAL NOT NULL DEFAULT 110,
    "defaultPeriod" TEXT NOT NULL DEFAULT 'ACUMULADO',
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BudgetSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClientShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "line" TEXT NOT NULL DEFAULT '',
    "pct" REAL NOT NULL,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClientShare_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClientShare_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BudgetLine_period_idx" ON "BudgetLine"("period");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_period_accountCode_key" ON "BudgetLine"("period", "accountCode");

-- CreateIndex
CREATE INDEX "ClientShare_year_idx" ON "ClientShare"("year");

-- CreateIndex
CREATE UNIQUE INDEX "ClientShare_year_companyId_line_key" ON "ClientShare"("year", "companyId", "line");

