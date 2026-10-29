-- Criterio configurable del forecast. Sólo crea una tabla nueva: no redefine
-- ninguna existente, así que no dispara cascadas en D1. Sin fila rige el
-- criterio por defecto (promedio del año vigente).

-- CreateTable
CREATE TABLE "ForecastCriteria" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "method" TEXT NOT NULL DEFAULT 'ANIO_VIGENTE',
    "windowMonths" INTEGER NOT NULL DEFAULT 6,
    "fromFirstPurchase" BOOLEAN NOT NULL DEFAULT true,
    "growthPct" REAL NOT NULL DEFAULT 0,
    "capOutliers" BOOLEAN NOT NULL DEFAULT false,
    "outlierFactor" REAL NOT NULL DEFAULT 1.5,
    "dormantMonths" INTEGER NOT NULL DEFAULT 0,
    "hotLeadPct" REAL NOT NULL DEFAULT 100,
    "warmLeadPct" REAL NOT NULL DEFAULT 0,
    "leadMonths" INTEGER NOT NULL DEFAULT 1,
    "newBusiness" REAL NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ForecastCriteria_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

