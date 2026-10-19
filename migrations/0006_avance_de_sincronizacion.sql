-- La sincronización con Siigo corre por lotes en invocaciones separadas: el
-- avance queda en el módulo para que el siguiente lote siga donde iba.
ALTER TABLE "ApiConnectionModule" ADD COLUMN "syncCursor" TEXT;
