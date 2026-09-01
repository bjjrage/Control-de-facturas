// Always the same object key: a new logo upload overwrites it, so callers
// never need to look anything up — they just point an <img> at the fixed
// public URL and append a cache-busting query param.
export const LOGO_STORAGE_PATH = "current-logo";
