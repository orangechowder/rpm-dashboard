"use client";

import type { ReactNode } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      themes={["dark", "light"]}
      enableSystem={false}
      storageKey="rpm-diesel-theme"
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}

export function ThemeToggle({ language }: { language: "en" | "fr" }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const label = language === "en" ? "Light mode" : "Mode clair";
  const action = language === "en"
    ? `Switch to ${isLight ? "dark" : "light"} mode`
    : `Passer en mode ${isLight ? "sombre" : "clair"}`;

  return (
    <button
      type="button"
      className="theme-toggle"
      role="switch"
      aria-checked={isLight}
      aria-label={label}
      title={action}
      disabled={!resolvedTheme}
      onClick={() => setTheme(isLight ? "dark" : "light")}
    >
      <span className="theme-toggle-thumb" aria-hidden="true" />
      <Sun className="theme-toggle-sun" size={15} aria-hidden="true" />
      <Moon className="theme-toggle-moon" size={15} aria-hidden="true" />
    </button>
  );
}