-- CreateTable
CREATE TABLE "ApiConnectionModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "partnerId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'SIN_CONFIGURAR',
    "lastCheckAt" DATETIME,
    "lastDetail" TEXT,
    "lastError" TEXT,
    "lastSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApiConnectionModule_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ApiConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiConnectionModule_connectionId_module_key" ON "ApiConnectionModule"("connectionId", "module");

