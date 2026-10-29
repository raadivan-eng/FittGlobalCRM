-- Estado de resultados por cuenta y mes. Sólo crea una tabla nueva: no
-- redefine ninguna existente, así que no dispara cascadas en D1.

-- CreateTable
CREATE TABLE "IncomeStatementLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "period" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ARCHIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "IncomeStatementLine_period_idx" ON "IncomeStatementLine"("period");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeStatementLine_period_accountCode_key" ON "IncomeStatementLine"("period", "accountCode");
