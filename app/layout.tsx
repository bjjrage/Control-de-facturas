import type { Metadata } from "next";
import "./globals.css";
import { DEFAULT_UI_THEME, UI_THEME_BOOTSTRAP } from "@/lib/ui-theme";

export const metadata: Metadata = {
  title: "Control de Facturas · niupack",
  description: "Gestion interna de cotizaciones, autorizaciones y conciliacion de facturas",
  icons: {
    icon: "/logo/niupack-mark.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="h-full antialiased" data-theme={DEFAULT_UI_THEME} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: UI_THEME_BOOTSTRAP }} /></head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
