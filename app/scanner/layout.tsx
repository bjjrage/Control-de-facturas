import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Control Scanner · niupack',
  description: 'Escaneo documental inteligente conectado al ERP',
  manifest: '/scanner/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Control Scanner',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export default function ScannerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-[100dvh] h-[100dvh] bg-slate-950 text-slate-100 antialiased flex flex-col select-none overflow-hidden"
      style={{ minHeight: '100dvh', height: '100dvh' }}
    >
      {children}
    </div>
  );
}
