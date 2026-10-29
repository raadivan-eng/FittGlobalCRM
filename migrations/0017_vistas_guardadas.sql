-- Vistas guardadas de los filtros. Sólo crea una tabla nueva: no redefine
-- ninguna existente, así que no dispara cascadas en D1.

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SavedView_userId_path_idx" ON "SavedView"("userId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_userId_path_name_key" ON "SavedView"("userId", "path", "name");
