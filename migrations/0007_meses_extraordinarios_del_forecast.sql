-- Meses extraordinarios: no entran al promedio con que se proyecta el forecast
-- de cada cliente. Sin companyId el mes se excluye para todos los clientes.

-- CreateTable
CREATE TABLE "ForecastExclusion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "period" TEXT NOT NULL,
    "companyId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForecastExclusion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForecastExclusion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ForecastExclusion_period_idx" ON "ForecastExclusion"("period");
