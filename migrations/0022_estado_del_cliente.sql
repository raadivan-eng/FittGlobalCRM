-- Estado del cliente y leads de cualquier temperatura en el forecast. Sólo
-- agrega columnas: no redefine tablas, así que no dispara cascadas en D1.

-- Inactivación manual: desde ese mes el forecast no proyecta al cliente.
ALTER TABLE "Company" ADD COLUMN "inactiveSince" DATETIME;
ALTER TABLE "Company" ADD COLUMN "inactiveReason" TEXT;

-- Porcentaje del valor esperado que suma un lead frío con mes de cierre.
ALTER TABLE "ForecastCriteria" ADD COLUMN "coldLeadPct" REAL NOT NULL DEFAULT 100;

-- El criterio guardado pasa a los nuevos valores de fábrica donde seguía en
-- los anteriores: inactivo tras seis meses sin compra y tibios al 100%.
UPDATE "ForecastCriteria" SET "dormantMonths" = 6 WHERE "dormantMonths" = 0;
UPDATE "ForecastCriteria" SET "warmLeadPct" = 100 WHERE "warmLeadPct" = 0;
