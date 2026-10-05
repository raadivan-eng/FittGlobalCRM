import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Todas las páginas son dinámicas (dependen de la sesión): no hace falta caché incremental.
export default defineCloudflareConfig({});
