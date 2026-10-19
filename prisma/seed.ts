/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CARRIERS, PROVIDER_KEYS } from "../src/lib/integrations";

const prisma = new PrismaClient();

// PRNG determinista: la demo se regenera idéntica en cualquier máquina.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260827);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const chance = (p: number) => rnd() < p;
const round2 = (n: number) => Math.round(n * 100) / 100;

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const dayOffset = (days: number) => new Date(TODAY.getTime() + days * 86_400_000);
const periodKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// ─────────────────────────────────────────────────────────────────────────────

const PRODUCTS = [
  { sku: "BEB-0101", name: "Agua Mineral Andina 600 ml", brand: "Andina", category: "Bebidas", subcategory: "Aguas", price: 0.62, cost: 0.34, perCase: 24, shelf: 540, emoji: "💧" },
  { sku: "BEB-0102", name: "Agua con Gas Andina 600 ml", brand: "Andina", category: "Bebidas", subcategory: "Aguas", price: 0.71, cost: 0.39, perCase: 24, shelf: 540, emoji: "🫧" },
  { sku: "BEB-0201", name: "Jugo Naranja Frutal 1 L", brand: "Frutal", category: "Bebidas", subcategory: "Jugos", price: 1.42, cost: 0.86, perCase: 12, shelf: 180, emoji: "🍊" },
  { sku: "BEB-0202", name: "Jugo Mango Frutal 1 L", brand: "Frutal", category: "Bebidas", subcategory: "Jugos", price: 1.42, cost: 0.86, perCase: 12, shelf: 180, emoji: "🥭" },
  { sku: "BEB-0203", name: "Néctar Durazno Frutal 250 ml", brand: "Frutal", category: "Bebidas", subcategory: "Jugos", price: 0.58, cost: 0.31, perCase: 24, shelf: 210, emoji: "🍑" },
  { sku: "BEB-0301", name: "Té Verde Zenda 500 ml", brand: "Zenda", category: "Bebidas", subcategory: "Tés", price: 1.05, cost: 0.58, perCase: 12, shelf: 300, emoji: "🍵" },
  { sku: "BEB-0302", name: "Té Limón Zenda 500 ml", brand: "Zenda", category: "Bebidas", subcategory: "Tés", price: 1.05, cost: 0.58, perCase: 12, shelf: 300, emoji: "🍋" },
  { sku: "BEB-0401", name: "Energizante Volt 250 ml", brand: "Volt", category: "Bebidas", subcategory: "Energizantes", price: 1.68, cost: 0.92, perCase: 24, shelf: 365, emoji: "⚡" },
  { sku: "SNK-0101", name: "Papas Naturales Crock 145 g", brand: "Crock", category: "Snacks", subcategory: "Papas", price: 1.35, cost: 0.74, perCase: 20, shelf: 120, emoji: "🥔" },
  { sku: "SNK-0102", name: "Papas Limón Crock 145 g", brand: "Crock", category: "Snacks", subcategory: "Papas", price: 1.35, cost: 0.74, perCase: 20, shelf: 120, emoji: "🥔" },
  { sku: "SNK-0201", name: "Maní Salado Nutty 200 g", brand: "Nutty", category: "Snacks", subcategory: "Frutos secos", price: 1.92, cost: 1.08, perCase: 16, shelf: 240, emoji: "🥜" },
  { sku: "SNK-0202", name: "Mix Frutos Secos Nutty 300 g", brand: "Nutty", category: "Snacks", subcategory: "Frutos secos", price: 3.45, cost: 2.05, perCase: 12, shelf: 210, emoji: "🌰" },
  { sku: "SNK-0301", name: "Galleta Wafer Chocolate Dulzia", brand: "Dulzia", category: "Snacks", subcategory: "Galletas", price: 0.88, cost: 0.46, perCase: 36, shelf: 270, emoji: "🍫" },
  { sku: "SNK-0302", name: "Galleta Avena Dulzia 6 u", brand: "Dulzia", category: "Snacks", subcategory: "Galletas", price: 1.14, cost: 0.61, perCase: 24, shelf: 240, emoji: "🍪" },
  { sku: "LAC-0101", name: "Leche Entera Pradera 1 L", brand: "Pradera", category: "Lácteos", subcategory: "Leches", price: 1.18, cost: 0.79, perCase: 12, shelf: 120, emoji: "🥛" },
  { sku: "LAC-0102", name: "Leche Deslactosada Pradera 1 L", brand: "Pradera", category: "Lácteos", subcategory: "Leches", price: 1.39, cost: 0.92, perCase: 12, shelf: 120, emoji: "🥛" },
  { sku: "LAC-0201", name: "Yogurt Fresa Pradera 1 kg", brand: "Pradera", category: "Lácteos", subcategory: "Yogures", price: 2.65, cost: 1.72, perCase: 6, shelf: 45, emoji: "🍓" },
  { sku: "LAC-0202", name: "Yogurt Griego Pradera 150 g", brand: "Pradera", category: "Lácteos", subcategory: "Yogures", price: 1.24, cost: 0.78, perCase: 12, shelf: 40, emoji: "🥣" },
  { sku: "LAC-0301", name: "Queso Campesino Pradera 500 g", brand: "Pradera", category: "Lácteos", subcategory: "Quesos", price: 3.98, cost: 2.71, perCase: 8, shelf: 35, emoji: "🧀" },
  { sku: "ABA-0101", name: "Arroz Premium Sembrado 1 kg", brand: "Sembrado", category: "Abarrotes", subcategory: "Granos", price: 1.32, cost: 0.88, perCase: 24, shelf: 720, emoji: "🍚" },
  { sku: "ABA-0102", name: "Fríjol Cargamanto Sembrado 500 g", brand: "Sembrado", category: "Abarrotes", subcategory: "Granos", price: 1.87, cost: 1.24, perCase: 20, shelf: 540, emoji: "🫘" },
  { sku: "ABA-0201", name: "Aceite Girasol Oliva Dorada 1 L", brand: "Oliva Dorada", category: "Abarrotes", subcategory: "Aceites", price: 2.94, cost: 2.05, perCase: 12, shelf: 450, emoji: "🫒" },
  { sku: "ABA-0301", name: "Pasta Espagueti Sembrado 500 g", brand: "Sembrado", category: "Abarrotes", subcategory: "Pastas", price: 0.94, cost: 0.55, perCase: 24, shelf: 600, emoji: "🍝" },
  { sku: "ABA-0401", name: "Atún Lomitos MarAzul 170 g", brand: "MarAzul", category: "Abarrotes", subcategory: "Enlatados", price: 1.76, cost: 1.11, perCase: 24, shelf: 900, emoji: "🐟" },
  { sku: "CPE-0101", name: "Shampoo Herbal Vitalé 400 ml", brand: "Vitalé", category: "Cuidado Personal", subcategory: "Capilar", price: 3.42, cost: 1.94, perCase: 12, shelf: 730, emoji: "🧴" },
  { sku: "CPE-0102", name: "Acondicionador Herbal Vitalé 400 ml", brand: "Vitalé", category: "Cuidado Personal", subcategory: "Capilar", price: 3.42, cost: 1.94, perCase: 12, shelf: 730, emoji: "🧴" },
  { sku: "CPE-0201", name: "Jabón Avena Vitalé 3 u", brand: "Vitalé", category: "Cuidado Personal", subcategory: "Corporal", price: 2.15, cost: 1.18, perCase: 24, shelf: 900, emoji: "🧼" },
  { sku: "CPE-0301", name: "Crema Dental Blanca Total 90 g", brand: "Blanca", category: "Cuidado Personal", subcategory: "Oral", price: 1.68, cost: 0.89, perCase: 24, shelf: 730, emoji: "🪥" },
  { sku: "ASE-0101", name: "Detergente Líquido Brisa 2 L", brand: "Brisa", category: "Aseo Hogar", subcategory: "Ropa", price: 4.62, cost: 2.85, perCase: 6, shelf: 730, emoji: "🧺" },
  { sku: "ASE-0201", name: "Limpiador Multiusos Brisa 1 L", brand: "Brisa", category: "Aseo Hogar", subcategory: "Superficies", price: 2.08, cost: 1.16, perCase: 12, shelf: 730, emoji: "🧽" },
] as const;

const COMPANIES = [
  { code: "CL-001", name: "Supermercados Vitalia S.A.S.", type: "CADENA", channel: "MODERNO", tier: "A", city: "Bogotá", credit: 180000, terms: 45 },
  { code: "CL-002", name: "Almacenes El Roble S.A.", type: "CADENA", channel: "MODERNO", tier: "A", city: "Bogotá", credit: 150000, terms: 45 },
  { code: "CL-003", name: "Distribuidora Norte Ltda.", type: "MAYORISTA", channel: "TRADICIONAL", tier: "A", city: "Medellín", credit: 120000, terms: 30 },
  { code: "CL-004", name: "MercaSur Cadena de Tiendas", type: "CADENA", channel: "MODERNO", tier: "B", city: "Cali", credit: 90000, terms: 30 },
  { code: "CL-005", name: "Comercializadora Andes S.A.S.", type: "MAYORISTA", channel: "TRADICIONAL", tier: "B", city: "Bogotá", credit: 75000, terms: 30 },
  { code: "CL-006", name: "Grupo Alimenta HORECA", type: "HORECA", channel: "HORECA", tier: "B", city: "Bogotá", credit: 60000, terms: 21 },
  { code: "CL-007", name: "Minimercados La Esquina", type: "CADENA", channel: "TRADICIONAL", tier: "B", city: "Medellín", credit: 48000, terms: 21 },
  { code: "CL-008", name: "Farmacias SaludPlus", type: "CADENA", channel: "MODERNO", tier: "B", city: "Bogotá", credit: 55000, terms: 30 },
  { code: "CL-009", name: "Autoservicios del Valle", type: "CADENA", channel: "MODERNO", tier: "C", city: "Cali", credit: 32000, terms: 21 },
  { code: "CL-010", name: "Tiendas Don Pepe", type: "INDEPENDIENTE", channel: "TRADICIONAL", tier: "C", city: "Bogotá", credit: 18000, terms: 15 },
  { code: "CL-011", name: "Provisiones Aburrá", type: "MAYORISTA", channel: "TRADICIONAL", tier: "B", city: "Medellín", credit: 65000, terms: 30 },
  { code: "CL-012", name: "Hoteles Cordillera", type: "HORECA", channel: "HORECA", tier: "C", city: "Bogotá", credit: 25000, terms: 30 },
  { code: "CL-013", name: "Mercados Express Online", type: "CADENA", channel: "ECOMMERCE", tier: "B", city: "Bogotá", credit: 70000, terms: 30 },
  { code: "CL-014", name: "Surtitienda del Sur", type: "INDEPENDIENTE", channel: "TRADICIONAL", tier: "C", city: "Cali", credit: 15000, terms: 15 },
] as const;

const GEO: Record<string, { lat: number; lng: number; zones: string[] }> = {
  "Bogotá": { lat: 4.6533, lng: -74.0836, zones: ["Chapinero", "Usaquén", "Suba", "Kennedy", "Engativá", "Centro", "Fontibón", "Teusaquillo"] },
  "Medellín": { lat: 6.2442, lng: -75.5812, zones: ["El Poblado", "Laureles", "Belén", "Envigado", "Robledo"] },
  "Cali": { lat: 3.4516, lng: -76.532, zones: ["Norte", "Sur", "Centro", "Oeste"] },
};

/** Centroide estable por zona, repartido en un anillo alrededor del centro de la ciudad. */
function zoneCenter(city: string, zone: string) {
  const geo = GEO[city];
  const idx = geo.zones.indexOf(zone);
  const angle = (idx / geo.zones.length) * Math.PI * 2;
  const radius = 0.042;
  return { lat: geo.lat + Math.sin(angle) * radius, lng: geo.lng + Math.cos(angle) * radius };
}

const STORE_NAMES = ["Central", "Plaza", "Norte", "Sur", "Palmas", "Colina", "Portal", "Andina", "Real", "Mirador", "Alameda", "Prado", "Bulevar", "Nogal", "Cedro", "Aurora", "Galería", "Terrazas"];
const FORMAT_BY_TYPE: Record<string, string[]> = {
  CADENA: ["HIPERMERCADO", "SUPERMERCADO", "SUPERMERCADO", "MINIMARKET"],
  MAYORISTA: ["MAYORISTA", "MAYORISTA", "SUPERMERCADO"],
  INDEPENDIENTE: ["BODEGA", "MINIMARKET"],
  HORECA: ["MINIMARKET", "BODEGA"],
};

const FIRST = ["Andrés", "Carolina", "Javier", "Paula", "Ricardo", "Diana", "Mauricio", "Laura", "Felipe", "Natalia", "Óscar", "Sandra", "Camilo", "Marcela", "Jorge", "Adriana", "Sebastián", "Claudia", "Julián", "Ximena", "Hernán", "Beatriz", "Iván", "Lucía"];
const LAST = ["Ramírez", "Gómez", "Torres", "Castaño", "Villamil", "Rueda", "Salazar", "Betancur", "Pineda", "Ospina", "Cárdenas", "Moreno", "Quintero", "Arboleda", "Mejía", "Zapata", "Cortés", "Rivas", "Buitrago", "Peñaloza"];
const POSITIONS = ["Comprador de categoría", "Jefe de tienda", "Gerente de compras", "Administrador de punto", "Coordinador de abastecimiento", "Gerente comercial", "Encargado de góndola", "Director de operaciones"];

const INCIDENT_TEMPLATES = [
  { type: "QUIEBRE", title: "Quiebre de stock en góndola", desc: "El SKU lleva más de 48 horas sin reposición en el lineal principal." },
  { type: "PRECIO", title: "Precio de góndola desactualizado", desc: "El precio exhibido no corresponde a la lista vigente del mes." },
  { type: "EXHIBICION", title: "Planograma incumplido", desc: "La marca perdió caras frente al espacio negociado con el cliente." },
  { type: "VENCIMIENTO", title: "Producto próximo a vencer en góndola", desc: "Unidades con vencimiento menor a 30 días expuestas al público." },
  { type: "DANIO", title: "Producto averiado en exhibición", desc: "Empaques golpeados detectados durante la revisión del lineal." },
  { type: "COMPETENCIA", title: "Actividad agresiva de la competencia", desc: "Competidor ejecutando exhibición adicional y descuento en el pasillo." },
  { type: "OTRO", title: "Punto de venta cerrado", desc: "El punto no abrió en el horario informado; visita no ejecutada." },
] as const;

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🧹 Limpiando base…");
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

  // ── Usuarios ───────────────────────────────────────────────────────────────
  const hash = bcrypt.hashSync("fitt2026", 10);
  const userSpecs = [
    { email: "ivan@fittglobal.com", name: "Deivan Rodríguez", role: "ADMIN", zone: null, color: "#7c3aed" },
    { email: "comercial@fittglobal.com", name: "Mariana Escobar", role: "COMERCIAL", zone: null, color: "#2563eb" },
    { email: "supervisor@fittglobal.com", name: "Hernán Duque", role: "SUPERVISOR", zone: "Bogotá", color: "#ea580c" },
    { email: "supervisor.med@fittglobal.com", name: "Alba Restrepo", role: "SUPERVISOR", zone: "Medellín", color: "#db2777" },
    { email: "mercaderista@fittglobal.com", name: "Kevin Ospina", role: "MERCADERISTA", zone: "Chapinero", color: "#059669" },
    { email: "l.pineda@fittglobal.com", name: "Lorena Pineda", role: "MERCADERISTA", zone: "Usaquén", color: "#0891b2" },
    { email: "j.varela@fittglobal.com", name: "Jhon Varela", role: "MERCADERISTA", zone: "Kennedy", color: "#65a30d" },
    { email: "s.tobon@fittglobal.com", name: "Sara Tobón", role: "MERCADERISTA", zone: "El Poblado", color: "#c026d3" },
    { email: "d.mesa@fittglobal.com", name: "Daniel Mesa", role: "MERCADERISTA", zone: "Laureles", color: "#0d9488" },
    { email: "y.caicedo@fittglobal.com", name: "Yuli Caicedo", role: "MERCADERISTA", zone: "Norte", color: "#d97706" },
  ];

  const users = [];
  for (const spec of userSpecs) {
    users.push(
      await prisma.user.create({
        data: {
          email: spec.email,
          name: spec.name,
          passwordHash: hash,
          role: spec.role,
          zone: spec.zone,
          avatarColor: spec.color,
          phone: `+57 3${int(10, 25)} ${int(100, 999)} ${int(1000, 9999)}`,
        },
      }),
    );
  }
  const comercial = users.find((u) => u.role === "COMERCIAL")!;
  const admin = users.find((u) => u.role === "ADMIN")!;
  const merchandisers = users.filter((u) => u.role === "MERCADERISTA");
  const supervisors = users.filter((u) => u.role === "SUPERVISOR");
  console.log(`👤 ${users.length} usuarios`);

  // ── Productos y bodegas ────────────────────────────────────────────────────
  const products = [];
  for (const p of PRODUCTS) {
    products.push(
      await prisma.product.create({
        data: {
          sku: p.sku,
          barcode: `77${int(10000000000, 99999999999)}`,
          name: p.name,
          brand: p.brand,
          category: p.category,
          subcategory: p.subcategory,
          unitPrice: p.price,
          unitCost: p.cost,
          unitsPerCase: p.perCase,
          shelfLifeDays: p.shelf,
          minStock: int(150, 900),
          imageEmoji: p.emoji,
        },
      }),
    );
  }
  const warehouses = [];
  for (const w of [
    { code: "BOG-01", name: "CEDI Bogotá Fontibón", city: "Bogotá" },
    { code: "MED-01", name: "CEDI Medellín Itagüí", city: "Medellín" },
    { code: "CAL-01", name: "Bodega Cali Yumbo", city: "Cali" },
  ]) {
    warehouses.push(await prisma.warehouse.create({ data: w }));
  }
  console.log(`📦 ${products.length} productos · ${warehouses.length} bodegas`);

  // ── Lotes con vencimiento ──────────────────────────────────────────────────
  let lotCount = 0;
  for (const product of products) {
    const lots = int(2, 5);
    for (let i = 0; i < lots; i++) {
      // Distribución sesgada para que el semáforo tenga casos en todas las bandas.
      const roll = rnd();
      let daysToExpiry: number;
      if (roll < 0.05) daysToExpiry = int(-40, -2);
      else if (roll < 0.18) daysToExpiry = int(1, 30);
      else if (roll < 0.34) daysToExpiry = int(31, 60);
      else if (roll < 0.5) daysToExpiry = int(61, 90);
      else daysToExpiry = int(91, Math.max(120, product.shelfLifeDays));

      const expiry = dayOffset(Math.min(daysToExpiry, product.shelfLifeDays));
      const received = dayOffset(Math.max(-product.shelfLifeDays + 5, daysToExpiry - product.shelfLifeDays));
      const expired = daysToExpiry < 0;

      await prisma.inventoryLot.create({
        data: {
          lotCode: `L${expiry.getFullYear()}${String(expiry.getMonth() + 1).padStart(2, "0")}-${product.sku.slice(-4)}-${i + 1}`,
          productId: product.id,
          warehouseId: pick(warehouses).id,
          quantity: int(40, 1400),
          unitCost: round2(product.unitCost * (0.92 + rnd() * 0.16)),
          expiryDate: expiry,
          receivedAt: received,
          status: expired ? "BLOQUEADO" : daysToExpiry <= 30 ? (chance(0.6) ? "LIQUIDACION" : "DISPONIBLE") : "DISPONIBLE",
        },
      });
      lotCount++;
    }
  }
  console.log(`🏷️  ${lotCount} lotes de inventario`);

  // ── Clientes, tiendas y contactos ──────────────────────────────────────────
  const companies = [];
  const stores: { id: string; companyId: string; tier: string; city: string; zone: string; lat: number; lng: number }[] = [];
  let storeSeq = 0;
  let contactSeq = 0;

  const usedStoreNames = new Set<string>();

  for (const c of COMPANIES) {
    const owner = chance(0.65) ? comercial : pick(users.filter((u) => ["COMERCIAL", "ADMIN"].includes(u.role)));
    const company = await prisma.company.create({
      data: {
        code: c.code,
        name: c.name,
        taxId: `9${int(10000000, 99999999)}-${int(1, 9)}`,
        type: c.type,
        channel: c.channel,
        tier: c.tier,
        creditLimit: c.credit,
        paymentTermDays: c.terms,
        city: c.city,
        address: `Cra ${int(7, 90)} # ${int(10, 180)}-${int(10, 99)}`,
        phone: `+57 ${int(1, 6)} ${int(200, 799)} ${int(1000, 9999)}`,
        email: `compras@${c.code.toLowerCase()}.com.co`,
        ownerId: owner.id,
      },
    });
    companies.push(company);

    const geo = GEO[c.city];
    const storeCount = c.type === "CADENA" ? int(4, 8) : c.type === "MAYORISTA" ? int(2, 4) : int(1, 3);

    for (let i = 0; i < storeCount; i++) {
      storeSeq++;
      const zone = pick(geo.zones);
      const zc = zoneCenter(c.city, zone);
      const tier = c.tier === "A" ? pick(["A", "A", "B"]) : c.tier === "B" ? pick(["B", "B", "C"]) : "C";
      const format = pick(FORMAT_BY_TYPE[c.type]);
      const visitsPerMonth = tier === "A" ? pick([4, 4, 2]) : tier === "B" ? 2 : 1;
      // Nombre único: dos puntos de venta con el mismo rótulo se confunden en la ruta.
      const prefix = c.name.split(" ")[0];
      let storeName = `${prefix} ${pick(STORE_NAMES)}`;
      if (usedStoreNames.has(storeName)) storeName = `${storeName} ${zone}`;
      let dedupe = 2;
      while (usedStoreNames.has(storeName)) storeName = `${prefix} ${pick(STORE_NAMES)} ${zone} ${dedupe++}`;
      usedStoreNames.add(storeName);

      const store = await prisma.store.create({
        data: {
          code: `PDV-${String(storeSeq).padStart(3, "0")}`,
          name: storeName,
          companyId: company.id,
          address: `Calle ${int(1, 190)} # ${int(1, 120)}-${int(1, 99)}`,
          city: c.city,
          zone,
          lat: zc.lat + (rnd() - 0.5) * 0.022,
          lng: zc.lng + (rnd() - 0.5) * 0.026,
          format,
          tier,
          visitsPerMonth,
          avgVisitMinutes: format === "HIPERMERCADO" ? int(45, 70) : format === "SUPERMERCADO" ? int(30, 45) : int(18, 30),
          openTime: pick(["07:00", "08:00", "08:30", "09:00"]),
          closeTime: pick(["18:00", "19:00", "20:00", "21:00"]),
        },
      });
      stores.push({ id: store.id, companyId: company.id, tier, city: c.city, zone, lat: store.lat!, lng: store.lng! });

      // Contacto de tienda
      if (chance(0.75)) {
        contactSeq++;
        await prisma.contact.create({
          data: {
            firstName: pick(FIRST),
            lastName: pick(LAST),
            email: `contacto${contactSeq}@${c.code.toLowerCase()}.com.co`,
            phone: `+57 3${int(10, 25)} ${int(100, 999)} ${int(1000, 9999)}`,
            position: pick(["Jefe de tienda", "Administrador de punto", "Encargado de góndola"]),
            companyId: company.id,
            stores: { create: { storeId: store.id } },
            lastContactAt: chance(0.7) ? dayOffset(-int(1, 90)) : null,
          },
        });
      }
    }

    // Contactos corporativos (sin tienda): compras, categoría, dirección
    const corporate = c.type === "CADENA" ? int(2, 4) : int(1, 2);
    for (let i = 0; i < corporate; i++) {
      contactSeq++;
      await prisma.contact.create({
        data: {
          firstName: pick(FIRST),
          lastName: pick(LAST),
          email: `contacto${contactSeq}@${c.code.toLowerCase()}.com.co`,
          phone: `+57 3${int(10, 25)} ${int(100, 999)} ${int(1000, 9999)}`,
          position: pick(POSITIONS),
          companyId: company.id,
          isPrimary: i === 0,
          isDecisionMaker: i === 0 || chance(0.3),
          lastContactAt: chance(0.8) ? dayOffset(-int(1, 60)) : null,
          notes: i === 0 ? "Contacto principal para negociación de acuerdos comerciales." : null,
        },
      });
    }

    // Supervisor de zona de la cadena: un mismo contacto atiende varias tiendas.
    const own = stores.filter((s) => s.companyId === company.id);
    if (c.type === "CADENA" && own.length > 1) {
      contactSeq++;
      const zone = own[0].zone;
      await prisma.contact.create({
        data: {
          firstName: pick(FIRST),
          lastName: pick(LAST),
          email: `contacto${contactSeq}@${c.code.toLowerCase()}.com.co`,
          phone: `+57 3${int(10, 25)} ${int(100, 999)} ${int(1000, 9999)}`,
          position: `Supervisor de zona ${zone}`,
          companyId: company.id,
          lastContactAt: dayOffset(-int(1, 30)),
          stores: { create: own.filter((s) => s.zone === zone).slice(0, 6).map((s) => ({ storeId: s.id })) },
        },
      });
    }
  }
  console.log(`🏢 ${companies.length} clientes · 🏪 ${stores.length} tiendas · 👥 ${contactSeq} contactos`);

  // ── Asignación de tiendas a mercaderistas (zona completa, carga equilibrada) ──
  const load = new Map(merchandisers.map((m) => [m.id, 0]));
  const zoneOwner = new Map<string, string>();

  for (const city of Object.keys(GEO)) {
    const cityMerch = merchandisers.filter((m) => GEO[city].zones.includes(m.zone ?? ""));
    const pool = cityMerch.length ? cityMerch : merchandisers;
    // Zonas de la ciudad ordenadas por número de tiendas: primero las más pesadas.
    const cityZones = [...new Set(stores.filter((s) => s.city === city).map((s) => s.zone))].sort(
      (a, b) =>
        stores.filter((s) => s.city === city && s.zone === b).length -
        stores.filter((s) => s.city === city && s.zone === a).length,
    );

    for (const zone of cityZones) {
      const native = pool.find((m) => m.zone === zone);
      const lightest = [...pool].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
      // El dueño natural de la zona se queda con ella salvo que ya esté sobrecargado.
      const owner = native && (load.get(native.id) ?? 0) <= (load.get(lightest.id) ?? 0) + 4 ? native : lightest;
      zoneOwner.set(`${city}|${zone}`, owner.id);
      load.set(owner.id, (load.get(owner.id) ?? 0) + stores.filter((s) => s.city === city && s.zone === zone).length);
    }
  }

  for (const store of stores) {
    const ownerId = zoneOwner.get(`${store.city}|${store.zone}`) ?? merchandisers[0].id;
    await prisma.storeAssignment.create({
      data: {
        storeId: store.id,
        userId: ownerId,
        priority: store.tier === "A" ? 1 : store.tier === "B" ? 2 : 3,
      },
    });
  }
  console.log(
    `🗺️  Asignaciones: ${merchandisers.map((m) => `${m.name.split(" ")[0]} ${load.get(m.id) ?? 0}`).join(" · ")}`,
  );

  // ── Historial de visitas + reportes de góndola + novedades ─────────────────
  const assignments = await prisma.storeAssignment.findMany({ include: { store: true } });
  let visitCount = 0;
  let shelfCount = 0;
  let incidentCount = 0;

  for (const a of assignments) {
    const intervalDays = Math.max(1, Math.round(30 / a.store.visitsPerMonth));
    // Historial hacia atrás, con adherencia imperfecta para que el score tenga textura.
    let cursor = -int(0, Math.round(intervalDays * 1.6));
    while (cursor > -95) {
      const plannedDate = dayOffset(cursor);
      const isFuture = cursor > 0;
      const status = isFuture ? "PLANIFICADA" : chance(0.88) ? "COMPLETADA" : "NO_REALIZADA";
      const checkIn = status === "COMPLETADA" ? new Date(plannedDate.getTime() + int(8, 16) * 3600000 + int(0, 59) * 60000) : null;
      const duration = status === "COMPLETADA" ? a.store.avgVisitMinutes + int(-8, 15) : null;

      const visit = await prisma.visit.create({
        data: {
          storeId: a.storeId,
          userId: a.userId,
          plannedDate,
          status,
          checkInAt: checkIn,
          checkOutAt: checkIn && duration ? new Date(checkIn.getTime() + duration * 60000) : null,
          checkInLat: checkIn ? a.store.lat! + (rnd() - 0.5) * 0.0008 : null,
          checkInLng: checkIn ? a.store.lng! + (rnd() - 0.5) * 0.0008 : null,
          durationMinutes: duration,
          objective: pick(["Revisión de góndola y reposición", "Auditoría de precios y planograma", "Chequeo de vencimientos", "Levantamiento de quiebres", "Montaje de exhibición adicional"]),
          summary: status === "COMPLETADA" ? pick(["Góndola repuesta, sin novedades mayores.", "Se detectaron quiebres y se escaló al comprador.", "Planograma corregido durante la visita.", "Rotación de lotes próximos a vencer ejecutada.", "Cliente solicita material POP adicional."]) : status === "NO_REALIZADA" ? pick(["Punto cerrado al momento de la visita.", "Encargado no disponible, se reprograma.", "Acceso restringido por inventario del cliente."]) : null,
        },
      });
      visitCount++;

      if (status === "COMPLETADA") {
        // Muestra de SKUs revisados en la góndola
        const sample = [...products].sort(() => rnd() - 0.5).slice(0, int(5, 11));
        for (const product of sample) {
          const oos = chance(0.14);
          const listPrice = product.unitPrice * 1.35; // precio sugerido al público
          await prisma.shelfReport.create({
            data: {
              visitId: visit.id,
              productId: product.id,
              facings: oos ? 0 : int(1, 6),
              unitsOnShelf: oos ? 0 : int(3, 60),
              shelfPrice: round2(listPrice * (0.94 + rnd() * 0.16)),
              competitorPrice: chance(0.6) ? round2(listPrice * (0.88 + rnd() * 0.22)) : null,
              outOfStock: oos,
              planogramOk: chance(0.8),
              priceTagOk: chance(0.86),
              nearExpiryUnits: chance(0.18) ? int(2, 45) : 0,
              notes: chance(0.15) ? pick(["Producto desplazado a nivel bajo.", "Competencia con exhibición adicional al lado.", "Se solicita reposición urgente al CEDI.", "Etiqueta de precio ilegible."]) : null,
            },
          });
          shelfCount++;
        }

        // Novedades derivadas de la visita
        if (chance(0.45)) {
          const howMany = chance(0.25) ? 2 : 1;
          for (let n = 0; n < howMany; n++) {
            const tpl = pick(INCIDENT_TEMPLATES);
            const ageDays = Math.abs(cursor);
            const severity = tpl.type === "QUIEBRE" || tpl.type === "VENCIMIENTO" ? pick(["CRITICA", "ALTA", "ALTA", "MEDIA"]) : pick(["ALTA", "MEDIA", "MEDIA", "BAJA"]);
            // Las viejas tienden a estar resueltas; las recientes siguen abiertas.
            const resolvedProb = ageDays > 45 ? 0.9 : ageDays > 20 ? 0.65 : 0.28;
            const resolved = chance(resolvedProb);
            incidentCount++;
            await prisma.incident.create({
              data: {
                code: `NOV-${String(incidentCount).padStart(5, "0")}`,
                storeId: a.storeId,
                visitId: visit.id,
                productId: ["QUIEBRE", "PRECIO", "VENCIMIENTO", "DANIO"].includes(tpl.type) ? pick(products).id : null,
                type: tpl.type,
                severity,
                status: resolved ? "RESUELTA" : chance(0.4) ? "EN_PROCESO" : "ABIERTA",
                title: tpl.title,
                description: tpl.desc,
                reportedById: a.userId,
                assignedToId: chance(0.75) ? pick([...supervisors, comercial]).id : null,
                dueAt: dayOffset(cursor + (severity === "CRITICA" ? 2 : severity === "ALTA" ? 5 : 10)),
                resolvedAt: resolved ? dayOffset(cursor + int(1, 8)) : null,
                resolution: resolved ? pick(["Reposición ejecutada desde CEDI.", "Precio corregido en sistema del cliente.", "Planograma restituido con el jefe de tienda.", "Lote retirado y canjeado.", "Se acordó plan de exhibición con el comprador."]) : null,
                createdAt: checkIn ?? plannedDate,
              },
            });
          }
        }
      }

      cursor -= intervalDays + int(-2, 4);
    }

    // Visitas planificadas de los próximos 14 días
    for (let d = 1; d <= 14; d++) {
      if (rnd() < a.store.visitsPerMonth / 30) {
        await prisma.visit.create({
          data: {
            storeId: a.storeId,
            userId: a.userId,
            plannedDate: dayOffset(d),
            status: "PLANIFICADA",
            objective: pick(["Revisión de góndola y reposición", "Auditoría de precios", "Chequeo de vencimientos"]),
          },
        });
        visitCount++;
      }
    }
  }
  console.log(`🚶 ${visitCount} visitas · 📋 ${shelfCount} reportes de góndola · ⚠️  ${incidentCount} novedades`);

  // ── Pedidos, facturación y forecast (14 meses hacia atrás) ─────────────────
  let orderSeq = 0;
  let invoiceSeq = 0;
  const monthlyReal = new Map<string, number>();
  const companyPeriodReal = new Map<string, number>();

  const tierVolume: Record<string, [number, number]> = { A: [6, 12], B: [3, 7], C: [1, 4] };

  for (let monthsAgo = 14; monthsAgo >= 0; monthsAgo--) {
    const base = new Date(TODAY.getFullYear(), TODAY.getMonth() - monthsAgo, 1);
    const period = periodKey(base);
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    // Estacionalidad suave + crecimiento anual
    const seasonal = 1 + 0.13 * Math.sin(((base.getMonth() + 1) / 12) * Math.PI * 2) + (14 - monthsAgo) * 0.011;

    for (const company of companies) {
      const [lo, hi] = tierVolume[company.tier] ?? [1, 3];
      const orders = Math.max(1, Math.round(int(lo, hi) * seasonal));
      const companyStores = stores.filter((s) => s.companyId === company.id);

      for (let o = 0; o < orders; o++) {
        const day = int(1, monthsAgo === 0 ? Math.max(1, TODAY.getDate()) : daysInMonth);
        const date = new Date(base.getFullYear(), base.getMonth(), day);
        if (date > TODAY) continue;
        orderSeq++;

        const lineCount = int(3, 9);
        const chosen = [...products].sort(() => rnd() - 0.5).slice(0, lineCount);
        const lines = chosen.map((p) => {
          const cases = int(4, company.tier === "A" ? 90 : company.tier === "B" ? 45 : 20);
          const quantity = cases * p.unitsPerCase;
          const discountPct = chance(0.4) ? pick([3, 5, 8, 10, 12]) : 0;
          const total = round2(quantity * p.unitPrice * (1 - discountPct / 100));
          return { productId: p.id, quantity, unitPrice: p.unitPrice, discountPct, total };
        });

        const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
        const total = round2(lines.reduce((s, l) => s + l.total, 0));
        const discount = round2(subtotal - total);
        const tax = round2(total * 0.19);
        const grand = round2(total + tax);

        const isRecent = monthsAgo === 0 && day > TODAY.getDate() - 6;
        const status = isRecent ? pick(["CONFIRMADO", "DESPACHADO", "FACTURADO"]) : chance(0.03) ? "ANULADO" : "FACTURADO";

        const order = await prisma.salesOrder.create({
          data: {
            number: `PED-${base.getFullYear()}${String(base.getMonth() + 1).padStart(2, "0")}-${String(orderSeq).padStart(5, "0")}`,
            companyId: company.id,
            storeId: companyStores.length && chance(0.55) ? pick(companyStores).id : null,
            date,
            status,
            subtotal,
            discount,
            net: total,
            tax,
            total: grand,
            createdById: company.ownerId ?? comercial.id,
            lines: { create: lines },
          },
        });

        if (status === "FACTURADO") {
          invoiceSeq++;
          const dueDate = new Date(date.getTime() + company.paymentTermDays * 86_400_000);
          const overdue = dueDate < TODAY;
          const daysPastDue = Math.floor((TODAY.getTime() - dueDate.getTime()) / 86_400_000);
          // Cuanto más antigua la factura, más probable que ya esté cobrada.
          const paid = overdue
            ? chance(daysPastDue > 90 ? 0.985 : daysPastDue > 45 ? 0.93 : 0.72)
            : chance(0.35);
          await prisma.invoice.create({
            data: {
              number: `FV-${String(invoiceSeq).padStart(6, "0")}`,
              orderId: order.id,
              companyId: company.id,
              issueDate: date,
              dueDate,
              net: total,
              total: grand,
              paidAmount: paid ? grand : chance(0.3) ? round2(grand * 0.5) : 0,
              status: paid ? "PAGADA" : overdue ? "VENCIDA" : chance(0.3) ? "PARCIAL" : "EMITIDA",
            },
          });
          // El forecast se mide sin IVA.
          monthlyReal.set(period, (monthlyReal.get(period) ?? 0) + total);
          const key = `${period}|${company.id}`;
          companyPeriodReal.set(key, (companyPeriodReal.get(key) ?? 0) + total);
        }
      }
    }
  }
  console.log(`🧾 ${orderSeq} pedidos · ${invoiceSeq} facturas`);

  // ── Forecast: 13 meses atrás (comparables) + 3 hacia adelante ─────────────
  let forecastCount = 0;
  for (let offset = -13; offset <= 3; offset++) {
    const base = new Date(TODAY.getFullYear(), TODAY.getMonth() + offset, 1);
    const period = periodKey(base);

    for (const company of companies) {
      const real = companyPeriodReal.get(`${period}|${company.id}`) ?? 0;
      // Para meses pasados el forecast orbita el real; para futuros, proyección con crecimiento.
      let amount: number;
      if (offset <= 0 && real > 0) {
        amount = round2(real * (0.84 + rnd() * 0.32));
      } else {
        const lastReal = companyPeriodReal.get(`${periodKey(new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1))}|${company.id}`) ?? 0;
        amount = round2(Math.max(4000, lastReal || 20000) * (1.02 + rnd() * 0.18));
      }
      if (amount <= 0) continue;
      await prisma.forecast.create({
        data: {
          period,
          companyId: company.id,
          amount,
          units: Math.round(amount / 1.6),
          createdById: comercial.id,
          notes: offset > 0 ? "Proyección basada en tendencia trimestral y acuerdos vigentes." : null,
        },
      });
      forecastCount++;
    }

    // Forecast por producto para el trimestre en curso (drill-down de portafolio)
    if (offset >= 0 && offset <= 2) {
      for (const product of products) {
        const amount = round2(int(3000, 42000) * (1 + offset * 0.04));
        await prisma.forecast.create({
          data: {
            period,
            productId: product.id,
            amount,
            units: Math.round(amount / product.unitPrice),
            createdById: comercial.id,
          },
        });
        forecastCount++;
      }
    }
  }
  console.log(`📈 ${forecastCount} registros de forecast`);

  // ── Clasificación ABC real según facturación de los últimos 12 meses ───────
  const since = new Date(TODAY.getFullYear(), TODAY.getMonth() - 11, 1);
  const billing = await prisma.invoice.groupBy({
    by: ["companyId"],
    where: { issueDate: { gte: since }, status: { not: "ANULADA" } },
    _sum: { net: true },
  });
  const ranked = billing.map((b) => ({ id: b.companyId, total: b._sum.net ?? 0 })).sort((a, b) => b.total - a.total);
  const grand = ranked.reduce((s, r) => s + r.total, 0);
  let acc = 0;
  for (const row of ranked) {
    acc += row.total;
    const share = grand ? acc / grand : 1;
    const tier = share <= 0.7 ? "A" : share <= 0.9 ? "B" : "C";
    await prisma.company.update({ where: { id: row.id }, data: { tier } });
  }
  // ── Guías de envío de los pedidos recientes ─────────────────────────────────
  // Todas MANUAL: sin credenciales de transportadora no hay guías por API.
  const MOVES = [
    { status: "RECOGIDA", desc: "Mercancía recogida en bodega del remitente" },
    { status: "EN_TRANSITO", desc: "En tránsito hacia la ciudad de destino" },
    { status: "EN_REPARTO", desc: "Salió a reparto con el mensajero" },
    { status: "ENTREGADA", desc: "Entregado y recibido a satisfacción" },
  ] as const;
  const NOVEDADES = [
    "Destinatario ausente en el horario de entrega",
    "Dirección incompleta: falta número de local",
    "Recibo de mercancía cerrado por inventario",
  ];
  const shippable = await prisma.salesOrder.findMany({
    where: { status: { in: ["DESPACHADO", "FACTURADO"] }, date: { gte: dayOffset(-21) } },
    orderBy: { date: "asc" },
    include: { company: true, store: true },
  });
  const now = new Date();
  let shipmentSeq = 0;
  for (const order of shippable) {
    if (order.status === "FACTURADO" && !chance(0.55)) continue;
    shipmentSeq++;
    const carrier = pick(CARRIERS.slice(0, 5)).key;
    const created = new Date(order.date.getTime() + int(2, 20) * 3_600_000);
    const age = (now.getTime() - created.getTime()) / 86_400_000;
    // Cuántos pasos del ciclo alcanzó según su antigüedad: un despacho nacional tarda 2 a 4 días.
    const reached = Math.max(0, Math.min(MOVES.length, Math.floor(age / (0.6 + rnd() * 0.5))));
    const annulled = reached === 0 && chance(0.15);
    const novelty = !annulled && reached >= 2 && reached < 4 && chance(0.25);
    const returned = reached === 4 && chance(0.03);
    const events: { status: string; description: string; location: string | null; occurredAt: Date; source: string }[] = [
      { status: "GENERADA", description: `Guía registrada a mano`, location: null, occurredAt: created, source: "SISTEMA" },
    ];
    let t = created.getTime();
    for (let k = 0; k < reached; k++) {
      t += int(5, 26) * 3_600_000;
      if (t > now.getTime()) break;
      const move = returned && k === 3 ? { status: "DEVUELTA", desc: "Devuelto al remitente: el cliente rechazó la entrega" } : MOVES[k];
      events.push({
        status: move.status,
        description: move.desc,
        location: k === 0 ? "Bogotá" : order.store?.city ?? order.company.city ?? "Bogotá",
        occurredAt: new Date(t),
        source: "MANUAL",
      });
    }
    if (novelty) {
      t = Math.min(now.getTime(), t + int(2, 10) * 3_600_000);
      events.push({ status: "NOVEDAD", description: pick(NOVEDADES), location: order.store?.city ?? order.company.city, occurredAt: new Date(t), source: "MANUAL" });
    }
    if (annulled) {
      events.push({ status: "ANULADA", description: "Guía anulada: pedido reprogramado por el cliente", location: null, occurredAt: new Date(created.getTime() + 3_600_000), source: "SISTEMA" });
    }
    const last = events[events.length - 1];
    const delivered = events.find((e) => e.status === "ENTREGADA");
    await prisma.shipment.create({
      data: {
        code: `GU-${String(shipmentSeq).padStart(5, "0")}`,
        carrier,
        trackingNumber: String(int(100000000, 999999999)) + String(int(10, 99)),
        source: "MANUAL",
        status: last.status,
        orderId: order.id,
        companyId: order.companyId,
        storeId: order.storeId,
        recipientName: order.store ? `${order.company.name} — ${order.store.name}` : order.company.name,
        recipientPhone: order.company.phone,
        destinationAddress: order.store?.address ?? order.company.address ?? "Calle 80 # 69-70",
        destinationCity: order.store?.city ?? order.company.city ?? "Bogotá",
        packages: int(2, 24),
        weightKg: int(15, 380),
        declaredValue: Math.round(order.total),
        shippingCost: int(18, 160),
        contents: "Producto terminado en cajas corrugadas",
        estimatedDelivery: new Date(created.getTime() + int(2, 4) * 86_400_000),
        shippedAt: events[1]?.occurredAt ?? null,
        deliveredAt: delivered?.occurredAt ?? null,
        createdById: order.createdById,
        createdAt: created,
        events: { create: events.map((e) => ({ ...e, userId: e.source === "SISTEMA" ? null : order.createdById })) },
      },
    });
  }
  console.log(`🚚 ${shipmentSeq} guías de envío`);

  // ── Leads: prospectos por medios y por sales hunt ──────────────────────────
  // Ninguno ganado: un lead ganado necesita su cliente, y la demo ya tiene los suyos.
  const LEAD_SPECS = [
    { source: "SALES_HUNT", name: "Minimercado La 70", city: "Medellín", format: "MINIMARKET", status: "NEGOCIACION", temp: "CALIENTE", close: 0 },
    { source: "SALES_HUNT", name: "Autoservicio El Trébol", city: "Bogotá", format: "SUPERMERCADO", status: "CALIFICADO", temp: "CALIENTE", close: 1 },
    { source: "SALES_HUNT", name: "Droguería Vida Sana", city: "Cali", format: "FARMACIA", status: "CONTACTADO", temp: "TIBIO", close: null },
    { source: "SALES_HUNT", name: "Supermercado Los Almendros", city: "Bogotá", format: "SUPERMERCADO", status: "NEGOCIACION", temp: "CALIENTE", close: 0 },
    { source: "SALES_HUNT", name: "Tienda Naturista Raíces", city: "Medellín", format: "ESPECIALIZADA", status: "NUEVO", temp: "FRIO", close: null },
    { source: "SALES_HUNT", name: "Granero La Esperanza", city: "Cali", format: "BODEGA", status: "PERDIDO", temp: "FRIO", close: null, lost: "Compra todo a un mayorista de la zona" },
    { source: "SALES_HUNT", name: "Mercados Doña Rosa", city: "Bogotá", format: "MINIMARKET", status: "CONTACTADO", temp: "TIBIO", close: 2 },
    { source: "SALES_HUNT", name: "Fitness Store Laureles", city: "Medellín", format: "ESPECIALIZADA", status: "CALIFICADO", temp: "CALIENTE", close: 1 },
    { source: "FACEBOOK", name: "Distribuidora San Judas", city: "Bogotá", format: "MAYORISTA", status: "NEGOCIACION", temp: "CALIENTE", close: 0, detail: "Campaña Mayoristas Q4 · Formulario distribuidores" },
    { source: "FACEBOOK", name: "Cafetería El Molino", city: "Cali", format: null, status: "NUEVO", temp: "FRIO", close: null, detail: "Campaña Mayoristas Q4 · Formulario distribuidores" },
    { source: "FACEBOOK", name: "Supermercado Mi Barrio", city: "Medellín", format: "SUPERMERCADO", status: "CONTACTADO", temp: "TIBIO", close: null, detail: "Campaña Tenderos · Formulario tiendas" },
    { source: "INSTAGRAM", name: "Box Funcional Norte", city: "Bogotá", format: "ESPECIALIZADA", status: "CALIFICADO", temp: "TIBIO", close: 2, detail: "Campaña Fitness · Formulario gimnasios" },
    { source: "INSTAGRAM", name: "Nutrición Activa", city: "Medellín", format: "ESPECIALIZADA", status: "NUEVO", temp: "FRIO", close: null, detail: "Anuncio que abre WhatsApp: Lleva la línea fit a tu tienda" },
    { source: "WHATSAPP", name: "Minimarket Express 24", city: "Bogotá", format: "MINIMARKET", status: "CONTACTADO", temp: "CALIENTE", close: 1, detail: "Escribió directo a WhatsApp Business" },
    { source: "WHATSAPP", name: "+573104558812", city: null, format: null, status: "NUEVO", temp: "FRIO", close: null, detail: "Escribió directo a WhatsApp Business" },
    { source: "WHATSAPP", name: "Hotel Casa Prado", city: "Cali", format: null, status: "PERDIDO", temp: "FRIO", close: null, detail: "Escribió directo a WhatsApp Business", lost: "Sólo buscaba precio al detal" },
    { source: "WEB", name: "Comercializadora Andina del Sur", city: "Cali", format: "MAYORISTA", status: "CALIFICADO", temp: "TIBIO", close: null, detail: "Formulario de contacto" },
    { source: "WEB", name: "Tiendas Saludables Express", city: "Bogotá", format: "ESPECIALIZADA", status: "NUEVO", temp: "FRIO", close: null, detail: "Formulario de contacto" },
    { source: "DIRECTO", name: "Superete La Floresta", city: "Medellín", format: "MINIMARKET", status: "NEGOCIACION", temp: "CALIENTE", close: 0, detail: "Referido de Minimercados La Esquina" },
    { source: "DIRECTO", name: "Restaurante Grano y Leña", city: "Bogotá", format: null, status: "PERDIDO", temp: "FRIO", close: null, detail: "Llamó al conmutador", lost: "Volumen muy bajo para despacho" },
  ] as const;
  const FIRST_MESSAGES: Record<string, string[]> = {
    FACEBOOK: ["nombre completo: {c}\nnombre de la empresa: {n}\nciudad: {city}\n¿cuántos puntos de venta tienes?: 1 a 3"],
    INSTAGRAM: ["Hola, vi el anuncio. ¿Venden al por mayor para tiendas fitness?", "nombre completo: {c}\nnombre de la empresa: {n}\n¿qué productos te interesan?: proteína y snacks"],
    WHATSAPP: ["Buenas tardes, ¿cuál es el pedido mínimo para distribuir sus productos?", "Hola, quiero la lista de precios mayoristas"],
    WEB: ["Somos una comercializadora y queremos incluir su portafolio. ¿Con quién hablamos?", "Me interesa ser distribuidor en mi ciudad"],
  };
  const FOLLOW_UPS = [
    "Se le envió portafolio y lista de precios por WhatsApp.",
    "Visita al punto: tiene espacio en góndola para dos referencias.",
    "Pide condiciones de pago a 30 días para el primer pedido.",
    "Quedó de confirmar el pedido de arranque la próxima semana.",
  ];
  const leadOwners = [comercial, admin];
  let leadSeq = 0;
  for (const spec of LEAD_SPECS) {
    leadSeq++;
    const owner = spec.status === "NUEVO" && chance(0.6) ? null : pick(leadOwners);
    const created = new Date(now.getTime() - int(2, 75) * 86_400_000 - int(0, 10) * 3_600_000);
    const hunt = spec.source === "SALES_HUNT";
    const contact = `${pick(FIRST)} ${pick(LAST)}`;
    const geo = spec.city ? GEO[spec.city] : null;
    const closeDate = spec.close != null ? new Date(TODAY.getFullYear(), TODAY.getMonth() + spec.close, 1) : null;
    const phone = spec.name.startsWith("+") ? spec.name : `+573${int(10, 25)}${int(1000000, 9999999)}`;
    const events: { type: string; body: string; source: string; userId: string | null; occurredAt: Date }[] = [];
    if (hunt) {
      events.push({ type: "CREADO", body: "Sales hunt: ubicación marcada a mano", source: "MANUAL", userId: owner?.id ?? comercial.id, occurredAt: created });
    } else if (spec.source === "DIRECTO") {
      events.push({ type: "CREADO", body: "Registrado a mano · llegó por Directo", source: "MANUAL", userId: owner?.id ?? comercial.id, occurredAt: created });
    } else {
      const body = pick(FIRST_MESSAGES[spec.source]).replace("{c}", contact).replace("{n}", spec.name).replace("{city}", spec.city ?? "");
      events.push({ type: "CREADO", body, source: "API", userId: null, occurredAt: created });
    }
    let t = created.getTime();
    const steps = ["NUEVO", "CONTACTADO", "CALIFICADO", "NEGOCIACION"].indexOf(spec.status === "PERDIDO" ? "CONTACTADO" : spec.status);
    for (let k = 0; k < steps; k++) {
      t = Math.min(now.getTime() - 3_600_000, t + int(1, 9) * 86_400_000);
      events.push({ type: "NOTA", body: FOLLOW_UPS[k % FOLLOW_UPS.length], source: "MANUAL", userId: owner?.id ?? comercial.id, occurredAt: new Date(t) });
      if (spec.source === "WHATSAPP" && k === 0) {
        events.push({ type: "MENSAJE", body: "Gracias, lo reviso con mi socio y les confirmo.", source: "API", userId: null, occurredAt: new Date(t + 2 * 3_600_000) });
      }
    }
    if (spec.status === "PERDIDO") {
      t = Math.min(now.getTime() - 3_600_000, t + int(2, 6) * 86_400_000);
      events.push({ type: "ESTADO", body: `Estado: Contactado → Perdido · Motivo: ${"lost" in spec ? spec.lost : ""}`, source: "MANUAL", userId: owner?.id ?? comercial.id, occurredAt: new Date(t) });
    } else if (spec.temp === "CALIENTE") {
      events.push({ type: "ESTADO", body: "Temperatura: Tibio → Caliente", source: "MANUAL", userId: owner?.id ?? comercial.id, occurredAt: new Date(t + 3_600_000) });
    }
    const last = events.reduce((m, e) => (e.occurredAt > m ? e.occurredAt : m), created);
    await prisma.lead.create({
      data: {
        code: `LD-${String(leadSeq).padStart(5, "0")}`,
        entry: hunt ? "SALES_HUNT" : "INBOUND",
        source: spec.source,
        sourceDetail: hunt ? "Ubicación marcada a mano" : "detail" in spec ? spec.detail : null,
        externalId: spec.source === "WHATSAPP" ? `wa:${phone.slice(1)}` : null,
        status: spec.status,
        temperature: spec.temp,
        name: spec.name,
        stores: {
          create: {
            name: spec.name,
            city: spec.city,
            address: hunt ? `Calle ${int(10, 120)} # ${int(5, 90)}-${int(10, 99)}` : null,
            format: spec.format,
            lat: hunt && geo ? round2((geo.lat + (rnd() - 0.5) * 0.08) * 1e4) / 1e4 : null,
            lng: hunt && geo ? round2((geo.lng + (rnd() - 0.5) * 0.08) * 1e4) / 1e4 : null,
            createdAt: created,
          },
        },
        contacts: {
          create: {
            name: spec.name.startsWith("+") ? phone : contact,
            phone,
            email: spec.source === "WEB" || spec.source === "FACEBOOK" ? `${contact.split(" ")[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")}@correo.com` : null,
            createdAt: created,
          },
        },
        closePeriod: closeDate ? periodKey(closeDate) : null,
        expectedValue: closeDate || spec.temp !== "FRIO" ? int(15, 90) * 100 : null,
        lostReason: "lost" in spec ? spec.lost : null,
        ownerId: owner?.id ?? null,
        createdById: hunt || spec.source === "DIRECTO" ? (owner?.id ?? comercial.id) : null,
        lastActivityAt: last,
        createdAt: created,
        events: { create: events },
      },
    });
  }
  console.log(`🎯 ${leadSeq} leads`);

  // ── Trade: actividades con las cadenas y su sell-out ───────────────────────
  // Sólo las cadenas reportan sell-out, y sólo de meses cerrados. Donde una
  // actividad quedó implementada se vende más en sus meses: así el detalle de
  // cada actividad tiene un efecto que medir contra el resto de tiendas.
  const chains = companies.filter((c) => c.type === "CADENA");
  const noonBogota = (monthsFromNow: number, day: number) => {
    const first = new Date(TODAY.getFullYear(), TODAY.getMonth() + monthsFromNow, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(Date.UTC(first.getFullYear(), first.getMonth(), Math.min(day, last), 17));
  };
  const bySku = (prefix: string) => products.filter((p) => p.sku.startsWith(prefix)).map((p) => p.id);

  const TRADE_SPECS = [
    { type: "PROMOCION", title: "Regreso a clases — jugos Frutal", mechanic: "Pague 2 lleve 3 en jugos Frutal 1 L", skus: "BEB-02", from: [-6, 1], to: [-5, 31], status: "CERRADA", boost: 0.38, impl: 0.72, budget: 4200 },
    { type: "EXHIBICION", title: "Punta de góndola snacks — temporada de fútbol", mechanic: "Punta de góndola con Crock y Nutty, precio especial 10 %", skus: "SNK-0", from: [-4, 1], to: [-3, 30], status: "CERRADA", boost: 0.27, impl: 0.6, budget: 6800 },
    { type: "DEGUSTACION", title: "Degustación yogurt griego Pradera", mechanic: "Impulsadora viernes y sábado, 10 a. m. a 6 p. m.", skus: "LAC-0202", from: [-2, 5], to: [-2, 28], status: "APROBADA", boost: 0.22, impl: 0.55, budget: 2600 },
    { type: "PROMOCION", title: "Cuidado capilar Vitalé — 20 % en la segunda unidad", mechanic: "20 % de descuento en la segunda unidad de shampoo o acondicionador", skus: "CPE-01", from: [-1, 1], to: [1, 15], status: "APROBADA", boost: 0.3, impl: 0.5, budget: 5400 },
    { type: "MATERIAL_POP", title: "Rompetráficos Energizante Volt", mechanic: "Rompetráfico y cenefa en nevera de bebidas frías", skus: "BEB-04", from: [0, 1], to: [1, 30], status: "APROBADA", boost: 0.15, impl: 0.35, budget: 1500 },
    { type: "CATALOGO", title: "Encarte de fin de año — abarrotes Sembrado", mechanic: "Página completa en el encarte de diciembre", skus: "ABA-01", from: [1, 1], to: [2, 10], status: "APROBADA", boost: 0, impl: 0, budget: 7200 },
    { type: "ACTIVACION", title: "Activación de marca Andina en centros comerciales", mechanic: "Stand con muestreo y premio por compra", skus: "BEB-01", from: [1, 10], to: [1, 25], status: "PLANEADA", boost: 0, impl: 0, budget: 9800 },
    { type: "PROMOCION", title: "Combo aseo Brisa", mechanic: "Detergente + limpiador con 15 % de descuento", skus: "ASE-0", from: [-3, 1], to: [-3, 30], status: "CANCELADA", boost: 0, impl: 0, budget: 0 },
  ] as const;

  const checkers = [...supervisors, comercial];
  // Qué tiendas implementaron qué productos en qué meses, para el sell-out.
  const boosted = new Map<string, number>();
  let tradeSeq = 0;
  for (const [i, spec] of TRADE_SPECS.entries()) {
    tradeSeq++;
    const company = chains[i % chains.length];
    const startDate = noonBogota(spec.from[0], spec.from[1]);
    const endDate = noonBogota(spec.to[0], spec.to[1]);
    const productIds = bySku(spec.skus);
    const companyStores = stores.filter((st) => st.companyId === company.id);
    const started = startDate <= TODAY && ["APROBADA", "CERRADA"].includes(spec.status);
    const finished = endDate < TODAY;

    const activity = await prisma.tradeActivity.create({
      data: {
        code: `TR-${String(tradeSeq).padStart(5, "0")}`,
        type: spec.type,
        status: spec.status,
        title: spec.title,
        mechanic: spec.mechanic,
        companyId: company.id,
        startDate,
        endDate,
        budget: spec.budget,
        ownerId: comercial.id,
        createdById: comercial.id,
        closingNote: spec.status === "CERRADA" ? "Funcionó donde hubo exhibición completa; las tiendas sin material casi no movieron. Repetir con material enviado una semana antes." : null,
        createdAt: new Date(startDate.getTime() - 20 * 86_400_000),
        products: { create: productIds.map((productId) => ({ productId })) },
      },
    });

    for (const st of companyStores) {
      // Las vigentes aún tienen tiendas sin visitar; las que no empezaron, todas.
      const checked = started && (finished || chance(0.65));
      const roll = rnd();
      const status = !checked ? "PENDIENTE" : roll < spec.impl ? "IMPLEMENTADA" : roll < spec.impl + 0.15 ? "PARCIAL" : "NO_IMPLEMENTADA";
      await prisma.tradeExecution.create({
        data: {
          activityId: activity.id,
          storeId: st.id,
          status,
          notes: status === "PARCIAL" ? pick(["Falta el precio especial en el sistema", "Sin material POP", "Exhibición más pequeña de lo pactado"]) : status === "NO_IMPLEMENTADA" ? pick(["El jefe de tienda no tenía la instrucción", "Sin espacio: la punta la tiene la competencia", "Producto agotado"]) : null,
          checkedAt: checked ? new Date(Math.min(TODAY.getTime(), startDate.getTime() + int(2, 9) * 86_400_000)) : null,
          checkedById: checked ? pick(checkers).id : null,
        },
      });
      if (status === "IMPLEMENTADA" || status === "PARCIAL") {
        const factor = status === "IMPLEMENTADA" ? spec.boost : spec.boost / 2;
        for (let m = spec.from[0]; m <= spec.to[0]; m++) {
          for (const productId of productIds) boosted.set(`${st.id}|${productId}|${periodKey(new Date(TODAY.getFullYear(), TODAY.getMonth() + m, 1))}`, factor);
        }
      }
    }
  }

  let sellOutRows = 0;
  for (const company of chains) {
    const record = await prisma.sellOutImport.create({
      data: {
        companyId: company.id,
        fileName: "SELL OUT demo.xlsx",
        sheet: company.name.split(" ")[0].toUpperCase(),
        periods: Array.from({ length: 13 }, (_, i) => periodKey(new Date(TODAY.getFullYear(), TODAY.getMonth() - 13 + i, 1))).join(","),
        rows: 0,
        units: 0,
        userId: comercial.id,
        createdAt: new Date(TODAY.getFullYear(), TODAY.getMonth(), 3, 9),
      },
    });
    const companyStores = stores.filter((st) => st.companyId === company.id);
    const rows: { period: string; companyId: string; storeId: string; productId: string; units: number; amount: number; importId: string }[] = [];
    for (const st of companyStores) {
      const [lo, hi] = st.tier === "A" ? [16, 42] : st.tier === "B" ? [7, 22] : [3, 11];
      const portfolio = products.filter(() => chance(0.6));
      const base = new Map(portfolio.map((p) => [p.id, int(lo, hi)]));
      // Una de cada doce tiendas dejó de rotar el último mes: quiebre que el portal delata.
      const stopped = chance(1 / 12);
      for (let monthsAgo = 13; monthsAgo >= 1; monthsAgo--) {
        if (stopped && monthsAgo === 1) continue;
        const ref = new Date(TODAY.getFullYear(), TODAY.getMonth() - monthsAgo, 1);
        const period = periodKey(ref);
        const seasonal = 1 + 0.12 * Math.sin(((ref.getMonth() + 1) / 12) * Math.PI * 2) + (13 - monthsAgo) * 0.01;
        for (const p of portfolio) {
          const lift = 1 + (boosted.get(`${st.id}|${p.id}|${period}`) ?? 0);
          const units = Math.max(0, Math.round(base.get(p.id)! * seasonal * lift * (0.78 + rnd() * 0.44)));
          if (!units) continue;
          rows.push({ period, companyId: company.id, storeId: st.id, productId: p.id, units, amount: round2(units * p.unitPrice * 1.32), importId: record.id });
        }
      }
    }
    await prisma.sellOut.createMany({ data: rows });
    await prisma.sellOutImport.update({ where: { id: record.id }, data: { rows: rows.length, units: rows.reduce((t, r) => t + r.units, 0) } });
    sellOutRows += rows.length;
  }
  console.log(`🛒 ${tradeSeq} actividades de trade · ${sellOutRows} filas de sell-out`);

  // ── Conexiones externas ────────────────────────────────────────────────────
  // Se crean vacías a propósito: las credenciales reales las carga el
  // administrador desde /conexiones. El seed no inventa tokens.
  await prisma.apiConnection.createMany({
    data: PROVIDER_KEYS.map((provider) => ({ provider, status: "SIN_CONFIGURAR" })),
  });
  console.log(`🔌 ${PROVIDER_KEYS.length} conexiones API listas para configurar`);

  console.log("🅰️  Clasificación ABC recalculada");

  console.log(`\n✅ Base lista. Acceso: ivan@fittglobal.com / fitt2026 (usuarios: ${users.map((u) => u.email).join(", ")})`);
  console.log(`   Admin: ${admin.email} · Comercial: ${comercial.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
