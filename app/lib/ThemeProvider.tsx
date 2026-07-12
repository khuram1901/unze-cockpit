"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { COLOURS } from "./SharedUI";

type Theme = "light" | "dark";

type ThemeContextType = {
  theme: Theme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const LIGHT_VARS: Record<string, string> = {
  "--bg-page": "#f4f6f9",
  "--bg-sidebar": "#ffffff",
  "--bg-card": "#ffffff",
  "--bg-card-hover": "#f8fafc",
  "--bg-input": "#ffffff",
  "--bg-header": "#ffffff",
  "--border-color": COLOURS.HAIRLINE,
  "--border-light": "#f1f5f9",
  "--text-primary": "#0f172a",
  "--text-secondary": COLOURS.SLATE,
  "--text-muted": "#94a3b8",
  "--text-sidebar": COLOURS.SLATE,
  "--text-sidebar-active": "#0f172a",
  "--shadow-sm": "0 1px 3px rgba(15,23,42,0.06)",
  "--shadow-md": "0 4px 14px rgba(15,23,42,0.08)",
  "--sidebar-active-bg": "#f1f5f9",
  "--sidebar-hover-bg": "#f8fafc",
  "--sidebar-border": COLOURS.HAIRLINE,
};

// Dark-mode backgrounds (#0c0f1a, #111827, #151926, #1c2135) are dark-theme-only
// tones with no equivalent in the light-mode COLOURS palette, so they're left as-is.
// For the structural accents that used to reuse the old NAVY/HAIRLINE hex values,
// swapping in the *new* NAVY (#0F1720, now near-black) would be invisible against
// these backgrounds, so INK_700 is used instead to keep the same mid-tone contrast
// purpose. Text colours use HAIRLINE/SLATE, which still work as light-on-dark text.
const DARK_VARS: Record<string, string> = {
  "--bg-page": "#0c0f1a",
  "--bg-sidebar": "#111827",
  "--bg-card": "#151926",
  "--bg-card-hover": "#1c2135",
  "--bg-input": "#1c2135",
  "--bg-header": "#151926",
  "--border-color": COLOURS.INK_700,
  "--border-light": "#1c2135",
  "--text-primary": COLOURS.HAIRLINE,
  "--text-secondary": "#94a3b8",
  "--text-muted": COLOURS.SLATE,
  "--text-sidebar": "#94a3b8",
  "--text-sidebar-active": COLOURS.HAIRLINE,
  "--shadow-sm": "0 1px 3px rgba(0,0,0,0.3)",
  "--shadow-md": "0 4px 14px rgba(0,0,0,0.4)",
  "--sidebar-active-bg": COLOURS.INK_700,
  "--sidebar-hover-bg": "#1c2135",
  "--sidebar-border": COLOURS.INK_700,
};

function applyVars(vars: Record<string, string>) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("unze-theme") as Theme | null;
    const initial = stored || "light";
    setTheme(initial);
    applyVars(initial === "dark" ? DARK_VARS : LIGHT_VARS);
    document.documentElement.setAttribute("data-theme", initial);
    setMounted(true);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem("unze-theme", next);
      applyVars(next === "dark" ? DARK_VARS : LIGHT_VARS);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  if (!mounted) return null;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
