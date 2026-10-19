import { revalidatePath } from "next/cache";
import { channelToken, registerIncoming, sameToken } from "@/lib/leads";

/**
 * Formulario de contacto del sitio web. Lo publica el servidor del sitio (o el
 * constructor de formularios) con la clave que muestra la página de Leads, en
 * la cabecera `x-lead-key` o como `?key=`. Acepta JSON o formulario con los
 * campos en español o en inglés.
 */

const MAX_BODY = 20_000;

const ALIAS = {
  nombre: ["nombre", "name", "full_name"],
  empresa: ["empresa", "company", "negocio"],
  telefono: ["telefono", "teléfono", "phone", "celular", "whatsapp"],
  correo: ["correo", "email"],
  ciudad: ["ciudad", "city"],
  mensaje: ["mensaje", "message", "comentarios"],
  pagina: ["pagina", "página", "page", "formulario", "form"],
};

export async function POST(req: Request) {
  const url = new URL(req.url);
  const key = req.headers.get("x-lead-key") ?? url.searchParams.get("key") ?? "";
  if (!sameToken(key, channelToken("web"))) return Response.json({ ok: false, error: "Clave inválida" }, { status: 401 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ ok: false, error: "Cuerpo demasiado grande" }, { status: 413 });

  let data: Record<string, unknown> = {};
  try {
    data = (req.headers.get("content-type") ?? "").includes("json")
      ? JSON.parse(raw)
      : Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return Response.json({ ok: false, error: "Cuerpo inválido" }, { status: 400 });
  }
  const read = (names: string[]) => {
    for (const n of names) {
      const v = data[n];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 500);
    }
    return null;
  };

  const nombre = read(ALIAS.nombre);
  const empresa = read(ALIAS.empresa);
  const telefono = read(ALIAS.telefono);
  const correo = read(ALIAS.correo);
  if (!(nombre || empresa) || !(telefono || correo)) {
    return Response.json({ ok: false, error: "Hace falta nombre o empresa, y teléfono o correo" }, { status: 422 });
  }

  await registerIncoming({
    source: "WEB",
    sourceDetail: read(ALIAS.pagina) ?? "Formulario de contacto",
    name: empresa ?? nombre ?? "",
    contactName: nombre,
    phone: telefono,
    email: correo,
    city: read(ALIAS.ciudad),
    message: read(ALIAS.mensaje) ?? "Dejó sus datos en el formulario de contacto",
  });
  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
