"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";
interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// STORAGE_KEY and the anti-flash script moved to theme-constants.ts, which
// is NOT a "use client" file — the root layout (a Server Component) needs
// the script's actual text, not a client-boundary stub for it. See that
// file's header for what broke and why.
import { THEME_STORAGE_KEY as STORAGE_KEY } from "./theme-constants";

/* ---------------------------------------------------------------------
 * A tiny external store, read with `useSyncExternalStore`.
 *
 * BUG FIX: switching language used to reset dark mode to light (§23).
 *
 * Cause: `<html>` is rendered by `app/[locale]/layout.tsx`. Changing
 * locale changes that segment's params, so React re-renders the root
 * layout and re-applies the element's attributes — wiping the `.dark`
 * class, which had been added imperatively by the no-flash script and was
 * never part of any React tree. The old provider kept the theme in
 * `useState`, initialised *once* from the DOM, so it never noticed the
 * class had gone and never put it back.
 *
 * Fix: the theme lives outside React (module state + localStorage), not
 * in component state that a remount can reset, and it is re-applied to
 * <html> after every render of the provider. Locale and theme are now
 * fully independent — /en → /fr cannot change dark → light — and the
 * choice survives navigation, refresh and reopening the site.
 *
 * There is exactly ONE theme system: this one. Do not add another.
 * ------------------------------------------------------------------- */

let currentTheme: Theme | null = null;
const listeners = new Set<() => void>();

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // private browsing / storage disabled
  }
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function getSnapshot(): Theme {
  if (currentTheme === null) currentTheme = readStoredTheme();
  return currentTheme;
}

/** Matches the no-flash script's default so the server HTML and the first
 * client render agree. */
function getServerSnapshot(): Theme {
  return "dark";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    currentTheme = event.newValue === "light" ? "light" : "dark";
    listeners.forEach((l) => l());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function applyTheme(theme: Theme) {
  const el = document.documentElement;
  el.setAttribute("data-theme", theme);
  el.classList.toggle("dark", theme === "dark");
}

function writeTheme(theme: Theme) {
  currentTheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
  applyTheme(theme);
  listeners.forEach((l) => l());
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Re-assert the theme on <html> after every render. Two idempotent DOM
  // writes, and the thing that makes the locale-switch regression
  // impossible to reintroduce: whatever React does to <html>, this puts
  // the theme back.
  useEffect(() => {
    applyTheme(theme);
  });

  const setTheme = useCallback((next: Theme) => writeTheme(next), []);
  const toggleTheme = useCallback(() => writeTheme(getSnapshot() === "dark" ? "light" : "dark"), []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
