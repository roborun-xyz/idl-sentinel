"use client";
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "idl-sentinel-theme";
const EVENT = "idl-sentinel-theme-change";
const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | undefined>(
  undefined
);
function readTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, (): Theme => "light");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  const toggleTheme = () => {
    localStorage.setItem(STORAGE_KEY, theme === "light" ? "dark" : "light");
    window.dispatchEvent(new Event(EVENT));
  };
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within a ThemeProvider");
  return value;
}
