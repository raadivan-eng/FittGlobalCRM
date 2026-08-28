import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Ingresar" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return <LoginForm />;
}
