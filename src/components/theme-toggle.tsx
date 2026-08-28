"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./icons";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("fitt-theme");
    if (stored === "dark" || stored === "light") setDark(stored === "dark");
    else setDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("fitt-theme", next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost h-8 w-8 !px-0"
      title={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
    >
      {dark === null ? <span className="h-4 w-4" /> : dark ? <IconSun size={16} /> : <IconMoon size={16} />}
    </button>
  );
}
