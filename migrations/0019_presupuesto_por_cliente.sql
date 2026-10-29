-- Presupuesto de resultados por cliente y mes. Sólo crea una tabla nueva: no
-- redefine ninguna existente, así que no dispara cascadas en D1.

-- CreateTable
CREATE TABLE "ClientBudget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "period" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sales" REAL NOT NULL,
    "marginPct" REAL NOT NULL,
    "freight" REAL NOT NULL DEFAULT 0,
    "trade" REAL NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClientBudget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClientBudget_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ClientBudget_period_idx" ON "ClientBudget"("period");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBudget_companyId_period_key" ON "ClientBudget"("companyId", "period");

