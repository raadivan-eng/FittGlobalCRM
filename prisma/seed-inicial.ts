/* eslint-disable no-console */
/**
 * Base de arranque para operar de verdad: deja la base vacía de datos de prueba
 * y crea sólo lo imprescindible para entrar al portal.
 *
 *   - Un usuario administrador (correo, nombre y clave salen del .env).
 *   - Las conexiones externas en estado SIN_CONFIGURAR, listas para que
 *     el administrador cargue credenciales desde /conexiones.
 *
 * Nada más: ni clientes, ni tiendas, ni productos, ni historia. Ese contenido
 * entra por las integraciones o por carga manual.
 *
 * El seed de demostración vive en prisma/seed.ts y no se toca; este archivo es
 * el que se ejecuta con `npm run db:init`.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PROVIDER_KEYS } from "../src/lib/integrations";

const prisma = new PrismaClient();

/** El .env lo carga Prisma al importar el cliente, así que se lee dentro de main(). */
const envOr = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

async function main() {
  const ADMIN_EMAIL = envOr("ADMIN_EMAIL", "ivan@fittglobal.com");
  const ADMIN_NAME = envOr("ADMIN_NAME", "Deivan Rodríguez");
  const ADMIN_PASSWORD = envOr("ADMIN_PASSWORD", "fitt2026");

  console.log("🧹 Borrando datos de prueba…");
  // El orden respeta las llaves foráneas: primero lo que depende, luego la raíz.
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.sellOut.deleteMany(),
    prisma.sellOutImport.deleteMany(),
    prisma.productAlias.deleteMany(),
    prisma.tradeExecution.deleteMany(),
    prisma.tradeActivityProduct.deleteMany(),
    prisma.tradeActivity.deleteMany(),
    prisma.leadEvent.deleteMany(),
    prisma.leadStore.deleteMany(),
    prisma.leadContact.deleteMany(),
    prisma.lead.deleteMany(),
    prisma.storeCandidate.deleteMany(),
    prisma.locatorSearch.deleteMany(),
    prisma.shipmentEvent.deleteMany(),
    prisma.shipment.deleteMany(),
    prisma.apiConnectionEvent.deleteMany(),
    prisma.apiConnectionModule.deleteMany(),
    prisma.apiConnection.deleteMany(),
    prisma.shelfReport.deleteMany(),
    prisma.incident.deleteMany(),
    prisma.visit.deleteMany(),
    prisma.storeAssignment.deleteMany(),
    prisma.salesOrderLine.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.salesOrder.deleteMany(),
    prisma.forecastExclusion.deleteMany(),
    prisma.forecast.deleteMany(),
    prisma.inventoryLot.deleteMany(),
    prisma.warehouse.deleteMany(),
    prisma.product.deleteMany(),
    prisma.storeContact.deleteMany(),
    prisma.contact.deleteMany(),
    prisma.store.deleteMany(),
    prisma.company.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  // ── Administrador ──────────────────────────────────────────────────────────
  // upsert y no create: reejecutar el script no debe dejar la base sin acceso.
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      name: ADMIN_NAME,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      role: "ADMIN",
      active: true,
    },
    create: {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      role: "ADMIN",
      avatarColor: "#7c3aed",
    },
  });
  console.log(`👤 Administrador: ${admin.email}`);

  // ── Conexiones externas, vacías ────────────────────────────────────────────
  await prisma.apiConnection.createMany({
    data: PROVIDER_KEYS.map((provider) => ({ provider, status: "SIN_CONFIGURAR" })),
  });
  console.log(`🔌 ${PROVIDER_KEYS.length} conexiones listas para configurar`);

  const counts = {
    clientes: await prisma.company.count(),
    tiendas: await prisma.store.count(),
    productos: await prisma.product.count(),
    pedidos: await prisma.salesOrder.count(),
    visitas: await prisma.visit.count(),
  };
  console.log(
    `\n✅ Base limpia. ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · ")}`,
  );
  console.log(`   Entra en /login con ${admin.email} y la clave de ADMIN_PASSWORD.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
