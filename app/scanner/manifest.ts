import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Control Scanner',
    short_name: 'Scanner',
    description: 'Companion app móvil de escaneo documental para Control de Facturas',
    start_url: '/scanner',
    display: 'standalone',
    background_color: '#090d16',
    theme_color: '#0f172a',
    icons: [
      {
        src: '/logo/niupack-mark.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
