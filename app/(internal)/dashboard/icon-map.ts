import { CalendarClock, AlertOctagon, FileX2, Wallet2, Radar, HardHat, Gavel, TrendingUp } from "lucide-react";

// Los datos del dashboard viajan como texto plano (server component o server
// action, según la ruta de navegación) — el ícono se resuelve acá, del lado
// de la presentación, para no serializar componentes de React.
export const DASHBOARD_ICONS = {
  "calendar-clock": CalendarClock,
  "alert-octagon": AlertOctagon,
  "file-x": FileX2,
  wallet: Wallet2,
  radar: Radar,
  hardhat: HardHat,
  gavel: Gavel,
  "trending-up": TrendingUp,
} as const;

export type DashboardIconKey = keyof typeof DASHBOARD_ICONS;
