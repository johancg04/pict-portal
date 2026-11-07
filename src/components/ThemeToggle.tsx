"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export default function ThemeToggle() {
  // Starts "dark" on every render (server and client's first pass) to avoid
  // a hydration mismatch — the real value (already applied to <html> by the
  // inline script in layout.tsx) is read once mounted, one frame later.
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private browsing / storage disabled — theme just won't persist */
    }
    // Lets anything outside React's tree (the canvas paints imperatively,
    // not via props) react to a live toggle — see Canvas.tsx.
    window.dispatchEvent(new CustomEvent("pictportal-theme", { detail: next }));
  }

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      aria-label="Cambiar tema"
      className="pp-icon-btn pp-theme-toggle flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-edge text-fg/70 hover:bg-fg/5 hover:text-fg/90"
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
