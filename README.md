# Fitt Global CRM — Portal administrativo

Portal interno para una comercializadora mayorista. Cubre tres frentes que en la
mayoría de las empresas viven en hojas de cálculo separadas:

1. **CRM de clientes y puntos de venta.** Empresas (cadenas, mayoristas,
   independientes, HORECA) que agrupan tiendas y contactos. Un contacto siempre
   pertenece a una empresa y puede estar además vinculado a una tienda concreta.
2. **Trade marketing en calle.** Mercaderistas con cartera asignada, rutas
   priorizadas, visitas con check-in/check-out, medición de góndola y novedades.
3. **Decisión comercial.** Forecast contra facturación, rankings de producto,
   cliente y tienda, cartera, y control de vencimientos por lote.

## Arranque

```bash
npm install
cp .env.example .env
npm run db:reset   # crea el esquema y carga datos de demostración
npm run dev        # http://localhost:3000
```

> `.env` no está versionado. Antes de desplegar, genera un `SESSION_SECRET`
> propio: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### Cuentas de demostración

Todas usan la contraseña `fitt2026`.

| Correo | Rol | Qué ve |
|---|---|---|
| `comercial@fittglobal.com` | Comercial | Panel gerencial, forecast, resultados, clientes |
| `ivan@fittglobal.com` | Administrador | Todo el portal |
| `supervisor@fittglobal.com` | Supervisor de campo | Rutas, visitas, novedades, equipo |
| `mercaderista@fittglobal.com` | Mercaderista | Su ruta del día, sus tiendas y sus novedades |

## El planificador de rutas

Es la pieza que responde a «optimizar el tiempo y el criterio de visita». Separa
dos preguntas que suelen mezclarse:

**¿A qué tienda vale la pena ir?** — `scoreStores()` en
[src/lib/routing.ts](src/lib/routing.ts) produce un score 0–100 por tienda a
partir de cinco señales ponderadas:

| Señal | Peso | Por qué |
|---|---:|---|
| Frecuencia comprometida vencida | 35 | Es el acuerdo con el cliente |
| Peso en facturación (90 días) | 25 | Protege el ingreso real |
| Novedades abiertas por severidad | 20 | Problemas ya detectados sin cerrar |
| SKU en quiebre en la última medición | 12 | Venta que se está perdiendo hoy |
| Producto por vencer en góndola | 8 | Merma evitable |

El score es **explicable**: cada tienda devuelve las razones que lo componen, y
esas razones se muestran en la interfaz. El mercaderista ve por qué su primera
parada es la primera.

**¿En qué orden y cuántas caben?** — `buildRoute()` selecciona por *eficiencia*
(puntos ganados por minuto invertido, no por score puro: una tienda excelente al
otro lado de la ciudad puede costar tres paradas cercanas), respeta el
presupuesto de la jornada y afina la secuencia con 2-opt, que sólo reduce
desplazamiento sin cambiar qué tiendas se visitan. Los traslados se estiman con
distancia haversine × 1,3 a 22 km/h más 4 minutos fijos por parada.

El plan resultante se convierte en visitas reales con un botón, de forma
idempotente: reagendar el mismo día no duplica visitas.

## Control de vencimientos

El inventario se maneja por **lote**, no por SKU agregado, porque la decisión
depende de la fecha de caducidad concreta. Cada lote cae en una banda que
determina la acción:

| Banda | Acción |
|---|---|
| Vencido | Dar de baja y registrar merma |
| ≤ 30 días | Liquidar o canjear esta semana |
| 31–60 días | Empujar por canal mayorista con descuento |
| 61–90 días | Priorizar en despachos (FEFO) |
| > 90 días | Rotación normal |

La vista por defecto muestra sólo lo accionable (≤ 90 días) y reporta el valor al
costo en riesgo, desglosado por categoría y por bodega.

## Estructura

```
prisma/
  schema.prisma        Modelo de datos (SQLite; los enums viven en src/lib/enums.ts)
  seed.ts              Datos de demostración deterministas (14 meses de historia)
src/
  app/
    login/             Autenticación
    (portal)/          Portal autenticado con sidebar
      page.tsx         Panel: gerencial o de campo según el rol
      clientes/  contactos/  tiendas/
      rutas/  visitas/  novedades/  equipo/
      productos/  inventario/
      ventas/  forecast/  reportes/
  components/          UI, gráficos, mapa de ruta, filtros
  lib/
    routing.ts         Priorización y ruteo
    analytics.ts       Consultas agregadas del negocio
    field.ts           Señales de campo por tienda
    auth.ts            Sesión y permisos por rol
    enums.ts           Catálogos de estados con etiqueta y tono
```

## Decisiones técnicas

- **Next.js 15 (App Router) + React 19 + TypeScript.** Todo el fetching ocurre en
  componentes de servidor; las mutaciones son server actions. El JS que llega al
  navegador ronda los 110 kB.
- **Prisma + SQLite.** Cero configuración para arrancar. Cambiar a PostgreSQL es
  editar el `provider` del datasource y `DATABASE_URL`.
- **Sesión propia con cookie firmada (HMAC-SHA256, `httpOnly`).** Sin
  dependencias de autenticación externas. Cambia `SESSION_SECRET` antes de
  desplegar.
- **Permisos por rol** declarados en `ACCESS` (`src/lib/auth.ts`): gobiernan a la
  vez el menú y los guards de página. Un mercaderista sólo ve su propia cartera.
- **Sin mapas de terceros.** El mapa de ruta proyecta las coordenadas sobre un
  SVG propio, corrigiendo la longitud por el coseno de la latitud. No depende de
  red ni de claves de API.
- **Paleta de datos validada.** Los colores de serie pasan las pruebas de
  separación para daltonismo (protanopía, deuteranopía, tritanopía) en modo claro
  y oscuro; el orden de los slots es el mecanismo de seguridad y no se cicla.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run db:reset` | Recrea el esquema y resiembra los datos de demostración |
| `npm run db:seed` | Sólo resiembra |
| `npm run db:studio` | Prisma Studio para inspeccionar la base |

> Los importes se muestran en dólares con formato local `es-CO`. Para cambiar de
> moneda, edita los formateadores en [src/lib/format.ts](src/lib/format.ts).
