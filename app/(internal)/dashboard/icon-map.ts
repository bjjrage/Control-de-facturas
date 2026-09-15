import { FileX2, Wallet2, HardHat, Gavel, CalendarClock, AlertOctagon, Radar, Trophy } from "lucide-react";

// Los datos del dashboard viajan como texto plano (server component o server
// action, según la ruta de navegación) — el ícono se resuelve acá, del lado
// de la presentación, para no serializar componentes de React.
export const DASHBOARD_ICONS = {
  "file-x": FileX2,
  wallet: Wallet2,
  hardhat: HardHat,
  gavel: Gavel,
  "calendar-clock": CalendarClock,
  "alert-octagon": AlertOctagon,
  radar: Radar,
  trophy: Trophy,
} as const;

export type DashboardIconKey = keyof typeof DASHBOARD_ICONS;
