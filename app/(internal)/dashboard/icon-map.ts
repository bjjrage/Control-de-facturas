import {
  FileX2,
  Wallet2,
  HardHat,
  Gavel,
  CalendarClock,
  AlertOctagon,
  Radar,
  Trophy,
  Boxes,
  Receipt,
  TrendingUp,
  Landmark,
  ShoppingCart,
  ShieldAlert,
  FileCheck,
  Clock,
  AlertTriangle,
  DollarSign,
  Scale,
  CalendarRange,
  FileQuestion,
  Building2,
} from "lucide-react";

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
  boxes: Boxes,
  receipt: Receipt,
  "trending-up": TrendingUp,
  landmark: Landmark,
  "shopping-cart": ShoppingCart,
  "shield-alert": ShieldAlert,
  "file-check": FileCheck,
  clock: Clock,
  "alert-triangle": AlertTriangle,
  "dollar-sign": DollarSign,
  scale: Scale,
  "calendar-range": CalendarRange,
  "file-question": FileQuestion,
  "building-2": Building2,
} as const;

export type DashboardIconKey = keyof typeof DASHBOARD_ICONS;
