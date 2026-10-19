# Fitt Global CRM — Portal administrativo

Portal interno para una comercializadora mayorista. Cubre tres frentes que en la
mayoría de las empresas viven en hojas de cálculo separadas:

1. **CRM de clientes y puntos de venta.** Empresas (cadenas, mayoristas,
   independientes, HORECA) que agrupan tiendas y contactos. Un contacto
   pertenece a un solo cliente y puede atender varias de sus tiendas; sin
   tiendas es un contacto corporativo.
2. **Trade marketing en calle.** Mercaderistas con cartera asignada, rutas
   priorizadas, visitas con check-in/check-out, medición de góndola y novedades.
3. **Decisión comercial.** Forecast contra facturación, rankings de producto,
   cliente y tienda, cartera, y control de vencimientos por lote.

A eso se suma la conexión con los servicios donde ya vive parte de esa
información: el ERP contable, la plataforma de anuncios y la ofimática.

## Arranque

```bash
npm install
cp .env.example .env
npm run db:init    # crea el esquema y deja la base lista para operar (sin datos)
npm run dev        # http://localhost:3000
```

`db:init` borra cualquier dato existente y deja sólo dos cosas: el usuario
administrador que definas en el `.env` y las tres conexiones API en estado
«sin configurar». Es el comando de puesta en producción.

Para volver al entorno de demostración con 14 meses de historia inventada:
`npm run db:reset`.

> `.env` no está versionado. Antes de desplegar, genera un `SESSION_SECRET`
> propio: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
> De ese secreto también se deriva la clave que cifra las credenciales de las
> conexiones API: rotarlo obliga a volver a cargarlas.

### Acceso

`db:init` crea un único usuario, el administrador, a partir de tres variables
del `.env`:

```
ADMIN_EMAIL="ivan@fittglobal.com"
ADMIN_NAME="Deivan Rodríguez"
ADMIN_PASSWORD="cambia-esta-clave"
```

Cambiar la clave es editar `ADMIN_PASSWORD` y volver a correr `npm run db:init`.
El resto del equipo —comerciales, supervisores, mercaderistas— se da de alta
desde la base; el portal todavía no tiene pantalla de creación de usuarios.

`npm run db:reset` (demostración) crea en cambio diez cuentas de ejemplo, todas
con la contraseña `fitt2026`: `comercial@`, `supervisor@`, `mercaderista@` y
demás sobre el dominio `fittglobal.com`.

### Cargar datos reales

Las pantallas son de lectura: se editan forecast, novedades y visitas, pero
todavía no hay formularios de alta de clientes, tiendas, productos ni pedidos, y
las conexiones API sólo guardan y prueban credenciales —aún no sincronizan
catálogos ni facturas—. Mientras esas dos piezas se construyen, la carga inicial
se hace contra la base: `npm run db:studio`.

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

## El localizador de tiendas

Mantiene el maestro al día contra Google Maps, que es donde las grandes
superficies publican sus sedes. [src/lib/store-locator.ts](src/lib/store-locator.ts)
busca la marca de cada cadena (tipo `CADENA` con marca conocida en `BRANDS` de
`geocoding.ts`) en cada ciudad donde ya tiene tiendas, con Places API. Si una
ciudad llena los 60 resultados que Google entrega por búsqueda, se parte en
cuadrantes.

Cada lugar encontrado se casa con el maestro, en este orden: a menos de 150 m
de una tienda ubicada, por la placa de la dirección, o porque todo lo que
distingue a la sede («MENGA», «CALLE 100») aparece en el nombre o la dirección
de Google. Lo que casa sin ambigüedad se vincula y, si no tenía coordenadas,
las toma: el localizador también geocodifica. Lo demás queda en
`/tiendas/descubiertas` para crearlo, vincularlo a mano o descartarlo, y llega
un aviso a administradores y supervisores. Lo descartado no vuelve a avisarse.

Corre solo con el cron del Worker ([worker.ts](worker.ts), 06:00 de Bogotá):
cada día repasa las búsquedas de más de una semana, en tandas cortas por
`/api/cron/localizador` para quedar dentro de los límites de cada invocación.

## Leads

Negocios que todavía no son clientes y se quieren convertir (`/leads`, para
ADMIN y COMERCIAL). Entran por dos caminos:

1. **Por un medio.** Llegan solos por API y avisan al equipo comercial:
   - *Facebook e Instagram*: formularios de Lead Ads. Meta los avisa al webhook
     `/api/webhooks/meta` (campo `leadgen`) y el botón «Sincronizar formularios»
     trae los de los últimos 30 días por si alguno no llegó.
   - *WhatsApp Business*: el mismo webhook, campo `messages`. Si la persona
     escribe desde un anuncio «clic a WhatsApp», Meta manda el `referral` y el
     lead queda con Facebook o Instagram de origen; si escribe directo, queda
     como WhatsApp. Sus mensajes siguientes se suman a la bitácora del lead.
   - *Sitio web*: el formulario de contacto publica en `/api/leads/web`.
   - *Directo* (llamada, correo, visita): se registra a mano.
2. **Sales hunt.** Lo busca el comercial y siempre arranca por la ubicación de
   la tienda: se elige en Google Maps (Places API) o se pegan sus coordenadas.
   Si el lugar ya es tienda de un cliente o ya es lead, el portal lo dice.

**Tiendas y contactos.** Un lead nace con al menos una tienda y un contacto, y
en su ficha se agregan más. Los que llegan solos por un medio arrancan con una
tienda provisional (el nombre del negocio, sin ubicar) y con quien escribió como
contacto. No se puede quitar la última tienda ni el último contacto.

Quien ya es lead —mismo id en Meta, o el teléfono o el correo de uno de sus
contactos— no se duplica. La URL y
el token del webhook y la clave del formulario web están al pie de `/leads`
(sólo ADMIN); el webhook exige la clave secreta de la app en la conexión Meta.

**Forecast.** Un lead `CALIENTE` abierto con mes tentativo de cierre y valor
suma ese valor al forecast de su mes: en Forecast, en el gráfico contra
facturación y en el avance del panel. Al convertirlo en cliente se crea la
empresa con las tiendas y los contactos del lead que se elijan (al menos uno de
cada), cada contacto vinculado a cada tienda, y el valor pasa a forecast manual
del cliente nuevo para ese mes, así el total no cae al ganarse.

## Trade: sell-out y actividades

Dos pantallas para saber si lo que vendemos sale de la góndola y si lo que se
pacta con las cadenas de verdad se ve en la tienda (ADMIN y COMERCIAL editan;
SUPERVISOR consulta y verifica en tienda).

**Sell out** (`/sell-out`) es la venta al consumidor por tienda, producto y mes
(`SellOut`). Llega en el Excel que se descarga de los portales —puede ser la hoja
«SELL OUT» completa, una pestaña por cadena— desde `/sell-out/importar`.
[src/lib/sell-out-import.ts](src/lib/sell-out-import.ts) reconoce las columnas
de cada portal por su encabezado, asigna la pestaña al cliente por la marca de
su nombre, casa la tienda por el código de la cadena y el producto por EAN o,
si el EAN viene dañado, por el código propio de la cadena (`ProductAlias`, que se
aprende solo o se fija una vez). Cargar un mes de un cliente reemplaza ese mes.
Cuando los portales abran API, su adaptador entregará las mismas filas.

La medida común es la unidad: el valor de cada portal no se puede sumar entre
cadenas, así que el dinero se muestra a precio de lista. La pantalla compara
sell-in (unidades facturadas) contra sell-out, calcula el sell-through de 3
meses y lista las tiendas que vendían y dejaron de rotar: casi siempre es quiebre.

**Actividades de trade** (`/trade`): promociones, activaciones, exhibiciones,
material POP… con su mecánica, fechas, inversión y productos. Cada tienda donde
debe verse queda «por verificar» (`TradeExecution`) hasta que alguien la marca
implementada, parcial o no implementada. El detalle mide el efecto con el
sell-out: unidades por tienda de los productos de la actividad, tres meses antes
contra los meses de vigencia, en las tiendas que la implementaron frente al
resto del cliente. La diferencia entre las dos variaciones descuenta la
temporada. La ficha de cada tienda muestra lo vigente y sus últimos seis meses
de sell-out.

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

## Conexiones vía API

`/conexiones` —sólo para el administrador— guarda las credenciales de los tres
servicios externos con los que trabaja la comercializadora:

| Proveedor | Qué entra por ahí | Prueba de conexión |
|---|---|---|
| **Siigo** | Facturas, cartera y catálogo del ERP | `POST https://api.siigo.com/auth` |
| **Meta** | Leads de campañas y WhatsApp Business | `GET https://graph.facebook.com/v21.0/me` |
| **Google** | Sheets, Drive y Analytics | `POST https://oauth2.googleapis.com/token` |

Dos decisiones sostienen el módulo:

**Las credenciales no vuelven al navegador.** Se guardan cifradas con AES-256-GCM
—clave derivada de `SESSION_SECRET` con scrypt, en
[src/lib/secrets.ts](src/lib/secrets.ts)— y la interfaz sólo muestra los últimos
cuatro caracteres de la principal. Editar un campo secreto y dejarlo vacío
conserva el valor guardado en vez de borrarlo.

**«Probar conexión» habla de verdad con el proveedor.** Pide un token a Siigo o a
Google y consulta la cuenta del token en Meta; el estado que se ve en la tarjeta
es el resultado de esa llamada, con el mensaje de error tal cual lo devolvió el
servicio. Cada guardado, prueba y desconexión queda en la bitácora con su autor y
la duración de la llamada, así que un fallo intermitente se puede reconstruir.

El catálogo de proveedores vive en
[src/lib/integrations.ts](src/lib/integrations.ts): añadir uno es sumar su
descriptor y su saludo en `actions-integrations.ts`.

## Estructura

```
prisma/
  schema.prisma        Modelo de datos (SQLite; los enums viven en src/lib/enums.ts)
  seed-inicial.ts      Base de arranque para operar: administrador y nada más
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
      conexiones/      Credenciales de Siigo, Meta y Google
  components/          UI, gráficos, mapa de ruta, filtros
  lib/
    routing.ts         Priorización y ruteo
    analytics.ts       Consultas agregadas del negocio
    field.ts           Señales de campo por tienda
    auth.ts            Sesión y permisos por rol
    enums.ts           Catálogos de estados con etiqueta y tono
    integrations.ts    Catálogo de proveedores externos
    secrets.ts         Cifrado de las credenciales de esas conexiones
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
| `npm run db:init` | Base de operación: borra todo y deja el administrador y las conexiones |
| `npm run db:reset` | Recrea el esquema y resiembra los datos de demostración |
| `npm run db:seed` | Sólo resiembra la demostración |
| `npm run db:studio` | Prisma Studio para inspeccionar la base |

> Los importes se muestran en dólares con formato local `es-CO`. Para cambiar de
> moneda, edita los formateadores en [src/lib/format.ts](src/lib/format.ts).
