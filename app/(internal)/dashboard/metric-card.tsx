"use client";

import Link from "next/link";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
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

export function MetricCard({ card }: { card: MetricCardData }) {
  const Icon = DASHBOARD_ICONS[card.iconKey] ?? DASHBOARD_ICONS["receipt"];
  const hasSparkline = card.sparkline && card.sparkline.length > 1;

  return (
    <Link
      href={card.href}
      className={`group relative flex flex-col justify-between rounded-2xl border bg-[var(--panel)] p-4 sm:p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-[var(--muted)]/50 ${TONE_RING[card.tone]} min-h-[145px] sm:min-h-[155px] overflow-hidden`}
    >
      {/* Top row: Titulo + Info tooltip discreto + Icono */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] line-clamp-1">
            {card.title}
          </span>
          {card.infoTooltip ? (
            <div
              className="relative group/tooltip inline-flex items-center"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              title={card.infoTooltip}
            >
              <Info className="h-3.5 w-3.5 text-[var(--muted)]/60 hover:text-[var(--foreground)] transition-colors cursor-help shrink-0" />
              <div className="pointer-events-none absolute left-0 top-full mt-1.5 hidden w-60 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2.5 text-[11px] font-normal normal-case leading-snug text-[var(--foreground)] shadow-xl z-50 group-hover/tooltip:block backdrop-blur-md">
                {card.infoTooltip}
              </div>
            </div>
          ) : null}
        </div>
        <div
          className={`h-8 w-8 sm:h-9 sm:w-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${TONE_CLASSES[card.tone]}`}
        >
          <Icon size={18} />
        </div>
      </div>

      {/* Main value & Multi-currency */}
      <div className="my-1.5 min-w-0">
        <div className="text-[20px] sm:text-[23px] font-bold tracking-tight text-[var(--foreground)] leading-tight truncate">
          {card.value}
        </div>
        {card.multiCurrencyExtra ? (
          <div className="text-[11px] sm:text-[12px] font-semibold text-[var(--action)] mt-0.5 truncate">
            {card.multiCurrencyExtra}
          </div>
        ) : null}
      </div>

      {/* Bottom info & Mini Sparkline */}
      <div className="flex items-end justify-between gap-2 mt-auto pt-1">
        <div className="min-w-0 flex-1">
          {card.secondaryText ? (
            <div className="text-[11px] sm:text-[12px] text-[var(--muted)] font-medium truncate">
              {card.secondaryText}
            </div>
          ) : null}

          {card.trendText ? (
            <div className="mt-1 flex items-center gap-1.5">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none ${
                  card.trendTone ? TREND_TONE_CLASSES[card.trendTone] : TREND_TONE_CLASSES.neutral
                }`}
              >
                {card.trendText}
              </span>
            </div>
          ) : null}
        </div>

        {/* Mini sparkline integrado */}
        {hasSparkline ? (
          <div className="h-8 w-20 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={card.sparkline}>
                <defs>
                  <linearGradient id={`grad-${card.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.0} />
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
    <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <MetricCard key={card.key} card={card} />
      ))}
    </div>
  );
}
