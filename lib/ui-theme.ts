export const UI_THEMES = ["original", "claro"] as const;
export type UiTheme = (typeof UI_THEMES)[number];
export const DEFAULT_UI_THEME: UiTheme = "original";
export const UI_THEME_STORAGE_KEY = "niupack:ui-theme";

export function normalizeUiTheme(value: unknown): UiTheme {
  return UI_THEMES.includes(value as UiTheme) ? (value as UiTheme) : DEFAULT_UI_THEME;
}

export function readUiTheme(storage: Pick<Storage, "getItem">): UiTheme {
  try {
    return normalizeUiTheme(storage.getItem(UI_THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_UI_THEME;
  }
}

// Only a fixed allowlist reaches the DOM. Runs during HTML parsing, before paint.
export const UI_THEME_BOOTSTRAP = `(()=>{let t=${JSON.stringify(DEFAULT_UI_THEME)};try{const v=localStorage.getItem(${JSON.stringify(UI_THEME_STORAGE_KEY)});if(${JSON.stringify(UI_THEMES)}.includes(v))t=v}catch{}document.documentElement.dataset.theme=t})()`;
