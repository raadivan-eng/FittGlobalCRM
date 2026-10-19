-- Unifica las fechas en texto ISO 8601, el formato que escribe el adaptador de D1.
--
-- La carga inicial (scripts/d1-datos.sh) copió las fechas tal como las guarda
-- SQLite local: enteros en milisegundos. El adaptador de D1 no lee una columna
-- que mezcla los dos formatos («Inconsistent column data») y la página falla
-- en cuanto producción escribe la primera fecha en esa tabla.
--
-- Sólo toca los valores enteros: repetirla no cambia nada.
UPDATE "User" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "Company" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "Store" SET "geocodedAt" = strftime('%Y-%m-%dT%H:%M:%S', "geocodedAt" / 1000, 'unixepoch') || '.' || printf('%03d', "geocodedAt" % 1000) || '+00:00' WHERE typeof("geocodedAt") = 'integer';
UPDATE "Store" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "Contact" SET "lastContactAt" = strftime('%Y-%m-%dT%H:%M:%S', "lastContactAt" / 1000, 'unixepoch') || '.' || printf('%03d', "lastContactAt" % 1000) || '+00:00' WHERE typeof("lastContactAt") = 'integer';
UPDATE "Contact" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "StoreAssignment" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "Visit" SET "plannedDate" = strftime('%Y-%m-%dT%H:%M:%S', "plannedDate" / 1000, 'unixepoch') || '.' || printf('%03d', "plannedDate" % 1000) || '+00:00' WHERE typeof("plannedDate") = 'integer';
UPDATE "Visit" SET "checkInAt" = strftime('%Y-%m-%dT%H:%M:%S', "checkInAt" / 1000, 'unixepoch') || '.' || printf('%03d', "checkInAt" % 1000) || '+00:00' WHERE typeof("checkInAt") = 'integer';
UPDATE "Visit" SET "checkOutAt" = strftime('%Y-%m-%dT%H:%M:%S', "checkOutAt" / 1000, 'unixepoch') || '.' || printf('%03d', "checkOutAt" % 1000) || '+00:00' WHERE typeof("checkOutAt") = 'integer';
UPDATE "Visit" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "Incident" SET "dueAt" = strftime('%Y-%m-%dT%H:%M:%S', "dueAt" / 1000, 'unixepoch') || '.' || printf('%03d', "dueAt" % 1000) || '+00:00' WHERE typeof("dueAt") = 'integer';
UPDATE "Incident" SET "resolvedAt" = strftime('%Y-%m-%dT%H:%M:%S', "resolvedAt" / 1000, 'unixepoch') || '.' || printf('%03d', "resolvedAt" % 1000) || '+00:00' WHERE typeof("resolvedAt") = 'integer';
UPDATE "Incident" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "Product" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "InventoryLot" SET "expiryDate" = strftime('%Y-%m-%dT%H:%M:%S', "expiryDate" / 1000, 'unixepoch') || '.' || printf('%03d', "expiryDate" % 1000) || '+00:00' WHERE typeof("expiryDate") = 'integer';
UPDATE "InventoryLot" SET "receivedAt" = strftime('%Y-%m-%dT%H:%M:%S', "receivedAt" / 1000, 'unixepoch') || '.' || printf('%03d', "receivedAt" % 1000) || '+00:00' WHERE typeof("receivedAt") = 'integer';
UPDATE "SalesOrder" SET "date" = strftime('%Y-%m-%dT%H:%M:%S', "date" / 1000, 'unixepoch') || '.' || printf('%03d', "date" % 1000) || '+00:00' WHERE typeof("date") = 'integer';
UPDATE "SalesOrder" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "Invoice" SET "issueDate" = strftime('%Y-%m-%dT%H:%M:%S', "issueDate" / 1000, 'unixepoch') || '.' || printf('%03d', "issueDate" % 1000) || '+00:00' WHERE typeof("issueDate") = 'integer';
UPDATE "Invoice" SET "dueDate" = strftime('%Y-%m-%dT%H:%M:%S', "dueDate" / 1000, 'unixepoch') || '.' || printf('%03d', "dueDate" % 1000) || '+00:00' WHERE typeof("dueDate") = 'integer';
UPDATE "Forecast" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "Shipment" SET "estimatedDelivery" = strftime('%Y-%m-%dT%H:%M:%S', "estimatedDelivery" / 1000, 'unixepoch') || '.' || printf('%03d', "estimatedDelivery" % 1000) || '+00:00' WHERE typeof("estimatedDelivery") = 'integer';
UPDATE "Shipment" SET "shippedAt" = strftime('%Y-%m-%dT%H:%M:%S', "shippedAt" / 1000, 'unixepoch') || '.' || printf('%03d', "shippedAt" % 1000) || '+00:00' WHERE typeof("shippedAt") = 'integer';
UPDATE "Shipment" SET "deliveredAt" = strftime('%Y-%m-%dT%H:%M:%S', "deliveredAt" / 1000, 'unixepoch') || '.' || printf('%03d', "deliveredAt" % 1000) || '+00:00' WHERE typeof("deliveredAt") = 'integer';
UPDATE "Shipment" SET "lastSyncAt" = strftime('%Y-%m-%dT%H:%M:%S', "lastSyncAt" / 1000, 'unixepoch') || '.' || printf('%03d', "lastSyncAt" % 1000) || '+00:00' WHERE typeof("lastSyncAt") = 'integer';
UPDATE "Shipment" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "Shipment" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%S', "updatedAt" / 1000, 'unixepoch') || '.' || printf('%03d', "updatedAt" % 1000) || '+00:00' WHERE typeof("updatedAt") = 'integer';
UPDATE "ShipmentEvent" SET "occurredAt" = strftime('%Y-%m-%dT%H:%M:%S', "occurredAt" / 1000, 'unixepoch') || '.' || printf('%03d', "occurredAt" % 1000) || '+00:00' WHERE typeof("occurredAt") = 'integer';
UPDATE "ShipmentEvent" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "ApiConnection" SET "lastCheckAt" = strftime('%Y-%m-%dT%H:%M:%S', "lastCheckAt" / 1000, 'unixepoch') || '.' || printf('%03d', "lastCheckAt" % 1000) || '+00:00' WHERE typeof("lastCheckAt") = 'integer';
UPDATE "ApiConnection" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "ApiConnection" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%S', "updatedAt" / 1000, 'unixepoch') || '.' || printf('%03d', "updatedAt" % 1000) || '+00:00' WHERE typeof("updatedAt") = 'integer';
UPDATE "ApiConnectionModule" SET "lastCheckAt" = strftime('%Y-%m-%dT%H:%M:%S', "lastCheckAt" / 1000, 'unixepoch') || '.' || printf('%03d', "lastCheckAt" % 1000) || '+00:00' WHERE typeof("lastCheckAt") = 'integer';
UPDATE "ApiConnectionModule" SET "lastSyncAt" = strftime('%Y-%m-%dT%H:%M:%S', "lastSyncAt" / 1000, 'unixepoch') || '.' || printf('%03d', "lastSyncAt" % 1000) || '+00:00' WHERE typeof("lastSyncAt") = 'integer';
UPDATE "ApiConnectionModule" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
UPDATE "ApiConnectionModule" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%S', "updatedAt" / 1000, 'unixepoch') || '.' || printf('%03d', "updatedAt" % 1000) || '+00:00' WHERE typeof("updatedAt") = 'integer';
UPDATE "ApiConnectionEvent" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%S', "createdAt" / 1000, 'unixepoch') || '.' || printf('%03d', "createdAt" % 1000) || '+00:00' WHERE typeof("createdAt") = 'integer';
