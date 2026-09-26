"use client";

import Link from "next/link";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Info } from "lucide-react";
import { DASHBOARD_ICONS } from "./icon-map";
import type { MetricCardData, DomainTone } from "@/lib/dashboard/types";

const TONE_CLASSES: Record<DomainTone, string> = {
  ok: "bg-[var(--ok-bg)] text-[var(--ok)]",
  warn: "bg-[var(--warn-bg)] text-[var(--warn)]",
  error: "bg-[var(--error-bg)] text-[var(--error)]",
  neutral: "bg-[var(--panel-2)] text-[var(--muted)]",
};

const TONE_RING: Record<DomainTone, string> = {
  ok: "border-[var(--border)]",
  warn: "border-[var(--warn)]/40 shadow-[0_0_12px_rgba(245,158,11,0.08)]",
  error: "border-[var(--error)]/40 shadow-[0_0_12px_rgba(239,68,68,0.12)]",
  neutral: "border-[var(--border)]",
};

const TREND_TONE_CLASSES: Record<"up" | "down" | "neutral", string> = {
  up: "text-[var(--ok)] bg-[var(--ok-bg)]",
  down: "text-[var(--error)] bg-[var(--error-bg)]",
  neutral: "text-[var(--muted)] bg-[var(--hover)]",
};

// Señalador superior semántico (Administración): verde = cobros/entradas,
// rojo = pagos/salidas. El ciclo por índice queda como fallback (Licitaciones).
const ACCENT_CLASSES = [
  "kpi-accent-budget",
  "kpi-accent-purchases",
  "kpi-accent-progress",
  "kpi-accent-labor",
] as const;

const ACCENT_BY_KEY: Record<string, string> = {
  "facturacion-mes": "kpi-accent-inflow",
  "facturacion-ytd": "kpi-accent-inflow",
  "cobrado-mes": "kpi-accent-inflow",
  "cuentas-por-cobrar": "kpi-accent-inflow",
  "cobros-esperados": "kpi-accent-inflow",
  "cxc-vencidas": "kpi-accent-inflow",
  "cuentas-por-pagar": "kpi-accent-outflow",
  "pagos-proximos": "kpi-accent-outflow",
  "cxp-vencidas": "kpi-accent-outflow",
  "compras-comprometidas": "kpi-accent-outflow",
  "liquidez-disponible": "kpi-accent-budget",
  "flujo-neto-30d": "kpi-accent-progress",
};

export function MetricCard({ card, compact = false, accentClass }: { card: MetricCardData; compact?: boolean; accentClass?: string }) {
  const Icon = DASHBOARD_ICONS[card.iconKey] ?? DASHBOARD_ICONS.receipt;
  const hasSparkline = card.sparkline && card.sparkline.length > 1;

  return (
    <Link
      href={card.href}
      className={`group kpi-hover relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-[var(--panel)] ${accentClass ?? ""} ${
        compact
          ? "h-[100px] max-h-[110px] p-3.5"
          : "min-h-[117px] p-3 sm:min-h-[126px] sm:p-3.5"
      } ${TONE_RING[card.tone]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="line-clamp-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {card.title}
          </span>
          {card.infoTooltip ? (
            <div
              className="group/tooltip relative inline-flex items-center"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              title={card.infoTooltip}
            >
              <Info className="h-3.5 w-3.5 shrink-0 cursor-help text-[var(--muted)]/60 transition-colors hover:text-[var(--foreground)]" />
              <div className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 hidden w-60 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2.5 text-[11px] font-normal leading-snug text-[var(--foreground)] shadow-xl backdrop-blur-md group-hover/tooltip:block">
                {card.infoTooltip}
              </div>
            </div>
          ) : null}
        </div>
        <div className={`flex shrink-0 items-center justify-center rounded-xl ${compact ? "h-7 w-7" : "h-8 w-8 sm:h-9 sm:w-9"} ${TONE_CLASSES[card.tone]}`}>
          <Icon size={compact ? 15 : 18} />
        </div>
      </div>

      <div className="my-1.5 min-w-0">
        <div className={`truncate font-bold leading-tight tracking-tight text-[var(--foreground)] ${compact ? "text-[24px]" : "text-[20px] sm:text-[23px]"}`}>
          {card.value}
        </div>
        {card.multiCurrencyExtra ? (
          <div className="mt-0.5 truncate text-[11px] font-semibold text-[var(--action)] sm:text-[12px]">
            {card.multiCurrencyExtra}
          </div>
        ) : null}
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
        <div className="min-w-0 flex-1">
          {card.secondaryText ? (
            <div className="truncate text-[11px] font-medium text-[var(--muted)] sm:text-[12px]">
              {card.secondaryText}
            </div>
          ) : null}
          {card.trendText ? (
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${card.trendTone ? TREND_TONE_CLASSES[card.trendTone] : TREND_TONE_CLASSES.neutral}`}>
                {card.trendText}
              </span>
            </div>
          ) : null}
        </div>

        {hasSparkline ? (
          <div className={`${compact ? "h-7 w-16" : "h-8 w-20"} shrink-0 opacity-70 transition-opacity group-hover:opacity-90`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={card.sparkline}>
                <defs>
                  <linearGradient id={`grad-${card.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--primary)"
                  strokeWidth={1.5}
                  fill={`url(#grad-${card.key})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
    </Link>
  );
}

export function MetricGrid({ cards }: { cards: MetricCardData[] }) {
  if (cards.length === 0) return null;

  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, index) => (
        <MetricCard
          key={card.key}
          card={card}
          accentClass={ACCENT_BY_KEY[card.key] ?? ACCENT_CLASSES[index % ACCENT_CLASSES.length]}
        />
      ))}
    </div>
  );
}
