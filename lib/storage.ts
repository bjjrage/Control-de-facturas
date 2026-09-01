export function sanitizeFileName(name: string) {
  const normalized = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const safe = normalized.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe.slice(-150) || "archivo.pdf";
}
