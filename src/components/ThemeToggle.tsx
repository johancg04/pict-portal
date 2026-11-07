"use client";

import { useEffect, useState } from "react";
import { ThemeMode, applyThemeMode, currentThemeMode } from "@/lib/skins";

export default function ThemeToggle() {
  // Starts "dark" on every render (server and client's first pass) to avoid
  // a hydration mismatch — the real value (already applied to <html> by the
  // inline script in layout.tsx) is read once mounted, one frame later.
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    setTheme(currentThemeMode());
    // The design picker can also switch the mode; stay in sync with it.
    const sync = (e: Event) => setTheme((e as CustomEvent<string>).detail === "light" ? "light" : "dark");
    window.addEventListener("pictportal-theme", sync);
    return () => window.removeEventListener("pictportal-theme", sync);
  }, []);

  function toggle() {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyThemeMode(next);
  }

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className="pp-icon-btn pp-theme-toggle flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-edge text-fg/70 hover:bg-fg/5 hover:text-fg/90"
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
