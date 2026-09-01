import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Control de Facturas · niupack",
  description: "Gestion interna de cotizaciones, autorizaciones y conciliacion de facturas",
  icons: {
    icon: "/logo/niupack-mark.svg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
