-- Al convertir un lead con su RUT o certificado de Cámara de Comercio, el
-- cliente guarda lo que se leyó del documento y el id del tercero en Siigo.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "siigoId" TEXT;
ALTER TABLE "Company" ADD COLUMN "fiscalData" TEXT;
ALTER TABLE "Company" ADD COLUMN "siigoError" TEXT;
