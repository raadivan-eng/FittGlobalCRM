# Notas para trabajar en este repositorio

Portal administrativo para una comercializadora mayorista. Lee el
[README](README.md) para el contexto de negocio; aquí sólo van las convenciones
del código.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Prisma + SQLite.

## Reglas del proyecto

**Idioma.** Toda la interfaz, los comentarios y los mensajes de commit van en
español. Los identificadores del código en inglés (`storeId`, `buildRoute`), los
valores de estado en español mayúsculas (`COMPLETADA`, `QUIEBRE`).

**Datos.** Todo el fetching vive en componentes de servidor. Las mutaciones son
server actions en `src/lib/actions-*.ts`, y cada una revalida las rutas que toca.
No hay rutas de API salvo que algo externo las necesite.

**Enums.** SQLite no los tiene. Cada campo de estado es `String` en el esquema y
su catálogo vive en [src/lib/enums.ts](src/lib/enums.ts) con etiqueta y tono.
Para pintar un estado usa `<EnumBadge option={CATALOGO.get(valor)} />`, nunca un
`switch` de colores en la página.

**Permisos.** El mapa `ACCESS` en [src/lib/auth.ts](src/lib/auth.ts) es la única
fuente de verdad: gobierna el menú lateral y los guards. Al añadir una sección,
regístrala ahí y en `GROUPS` de [src/components/sidebar.tsx](src/components/sidebar.tsx).
Las páginas restringidas llaman a `requireRole([...])`; las abiertas a
`requireUser()`. Un mercaderista sólo ve su propia cartera: filtra por
`userId`/`reportedById` cuando `user.role === "MERCADERISTA"`.

**Estilos.** No hay hex sueltos en los componentes: todo se pinta contra los
tokens de [src/app/globals.css](src/app/globals.css) (`--surface-1`,
`--text-secondary`, `--series-2`…). El modo oscuro es un juego de pasos elegido,
declarado tanto bajo `@media (prefers-color-scheme: dark)` como bajo
`:root[data-theme="dark"]`. Las clases utilitarias `.card`, `.field`, `.btn`,
`.tbl` y `.badge-*` cubren casi todo.

**Gráficos.** Los componentes de servidor no pueden pasar funciones a los de
cliente: `format` viaja como clave (`"compact"`, `"money"`, `"percent"`…) y se
resuelve dentro de [src/components/charts.tsx](src/components/charts.tsx).
Los colores de serie se asignan **en orden fijo** desde `--series-1`; nunca se
ciclan ni se generan tonos nuevos —pasado el octavo slot se agrupa en «Otros»—
porque ese orden es lo que garantiza la separación para daltonismo. Nunca uses
dos ejes Y: si las escalas difieren, van dos gráficos.

**Filtros.** El estado de filtrado vive en la query string, no en React, para que
las vistas sean compartibles. Usa `<Filters>` y los helpers de
[src/lib/params.ts](src/lib/params.ts).

**Tipos.** `params` y `searchParams` son promesas en Next 15; hay que esperarlas.

## Al tocar el modelo de datos

```bash
npm run db:reset   # aplica el esquema y resiembra la demostración
npm run db:init    # aplica el esquema y deja la base de operación (admin + conexiones)
```

Hay dos seeds y los dos deben seguir el cambio: `prisma/seed.ts` (demostración)
y `prisma/seed-inicial.ts` (base limpia). Si añades una entidad, súmala al
`deleteMany` de ambos.

**Detén el dev server antes de resembrar.** `db:reset` borra el archivo SQLite;
un `next dev` vivo conserva el descriptor del archivo eliminado y a partir de ahí
lee datos fantasma: las sesiones dejan de validar y las páginas fallan con
errores que no están en el código.

El seed es determinista (PRNG con semilla fija) y genera 14 meses de historia
relativa a la fecha de ejecución. Si añades una entidad, súmala al `deleteMany`
del bloque de limpieza para que el reseed siga siendo idempotente.

## Producción: Cloudflare Workers + D1

Se despliega con OpenNext (`npm run deploy`) en `crm.fittglobal.com`. Requiere
Node 22 (`nvm use`, ver `.nvmrc`). En local nada cambia: `next dev` y las seeds
usan `prisma/dev.db`; desplegado, [src/lib/prisma.ts](src/lib/prisma.ts) usa el
binding `DB` de D1.

- **D1 no tiene transacciones.** `$transaction` corre como consultas sueltas:
  lo que se escriba ahí debe poder repetirse sin daño.
- **Cambios de esquema:** además de `db:push` en local, genera una migración
  nueva en `migrations/` y aplícala con `npm run d1:migrate`:
  `npx prisma migrate diff --from-local-d1 --to-schema-datamodel prisma/schema.prisma --script > migrations/000N_descripcion.sql`
- **Secretos** (`SESSION_SECRET`) con `npx wrangler secret put`, nunca en
  `wrangler.jsonc`. En local, `npm run preview` los lee de `.dev.vars`.
- `npm run preview` prueba el build real en el runtime de Workers contra una D1
  local (`wrangler d1 migrations apply fitt-crm --local` y
  `D1_DESTINO=--local npm run d1:datos` para cargarla).

## Antes de dar algo por terminado

```bash
npx tsc --noEmit
npm run build
```

Y abre la página en el navegador: varios módulos sólo revelan sus problemas de
layout con datos reales. Si `next build` corre mientras `next dev` está activo,
el dev server rompe con `__webpack_modules__ is not a function`; reinícialo.
