import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Fitt Global CRM", template: "%s · Fitt Global CRM" },
  description: "Portal administrativo para distribución mayorista: clientes, trade marketing en punto de venta, inventario y resultados comerciales.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

// Evita el parpadeo de tema: aplica la preferencia antes del primer pintado.
const themeScript = `try{var t=localStorage.getItem("fitt-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
