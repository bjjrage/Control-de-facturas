"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { DEFAULT_UI_THEME, normalizeUiTheme, readUiTheme, UI_THEME_STORAGE_KEY, type UiTheme } from "@/lib/ui-theme";

const THEME_EVENT = "niupack:theme";
const OPTIONS = [
  { value: "original", label: "Original", icon: Moon },
  { value: "claro", label: "Claro", icon: Sun },
] as const;

function snapshot() {
  return normalizeUiTheme(document.documentElement.dataset.theme);
}
function serverSnapshot() { return DEFAULT_UI_THEME; }
function subscribe(listener: () => void) {
  const sync = (event: StorageEvent) => {
    if (event.key !== UI_THEME_STORAGE_KEY && event.key !== null) return;
    document.documentElement.dataset.theme = normalizeUiTheme(event.newValue);
    listener();
  };
  window.addEventListener(THEME_EVENT, listener);
  window.addEventListener("storage", sync);
  return () => {
    window.removeEventListener(THEME_EVENT, listener);
    window.removeEventListener("storage", sync);
  };
}
function chooseTheme(theme: UiTheme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(UI_THEME_STORAGE_KEY, theme); } catch { /* Session still works when storage is blocked. */ }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useLayoutEffect(() => {
    // React Strict Mode may reset html attributes in development.
    try { document.documentElement.dataset.theme = readUiTheme(localStorage); } catch { /* Keep the bootstrap default. */ }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return (
    <div role="group" aria-label="Apariencia" className="theme-switcher">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button key={value} type="button" aria-label={`Tema ${label}`} aria-pressed={theme === value}
          title={value === "original" ? "Aspecto original" : "Tema claro"} onClick={() => chooseTheme(value)} className="theme-switcher-option">
          <Icon size={14} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
