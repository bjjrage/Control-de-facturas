"use client";

import React from "react";
import { FrozenAuctionPolicy } from "@/lib/auction-bot/types";
import { ShieldCheck, ShieldAlert, Lock, Hash, Clock, Crosshair, UserCheck } from "lucide-react";

interface PolicySummaryCardProps {
  policy: FrozenAuctionPolicy;
  onUnfreezeRequest?: () => void;
}

export function PolicySummaryCard({ policy, onUnfreezeRequest }: PolicySummaryCardProps) {
  const formattedTarget = policy.targetPricePyg.toLocaleString("es-PY");
  const formattedAutoLimit = policy.autoLimitPyg.toLocaleString("es-PY");
  const formattedDefenseStep = policy.defenseStepPyg.toLocaleString("es-PY");
  const tolerancePct = (policy.autoDefenseToleranceBps / 100).toFixed(2).replace(/\.00$/, "");

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-5 shadow-sm space-y-5">
      {/* Header with Version & Authorization */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
            <Lock className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[14px] text-[var(--foreground)]">
                Política Activa (Versión {policy.version})
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-3 w-3" /> CONGELADA / AUTORIZADA
              </span>
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              ID: {policy.policyId} • Subasta: {policy.auctionId} • Grupo: {policy.groupId} ({policy.scope})
            </p>
          </div>
        </div>

        <div className="text-right text-[11px] text-[var(--muted)]">
          <div className="flex items-center gap-1 sm:justify-end">
            <UserCheck className="h-3.5 w-3.5 text-blue-500" />
            <span>Autorizado por: <strong className="text-[var(--foreground)]">{policy.authorizedBy}</strong></span>
          </div>
          <div className="flex items-center gap-1 sm:justify-end mt-0.5">
            <Clock className="h-3 w-3" />
            <span>{new Date(policy.authorizedAt).toLocaleString("es-PY")}</span>
            <span className="mx-1">•</span>
            <Hash className="h-3 w-3" />
            <code className="rounded bg-black/5 dark:bg-white/5 px-1 py-0.2 font-mono text-[10px]">
              {policy.policyFingerprint}
            </code>
          </div>
        </div>
      </div>

      {/* ECONOMIC POLICY BANNER - Sanitized semantics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border-2 border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            TARGET PRICE (OBJETIVO)
          </div>
          <div className="text-xl font-bold tracking-tight text-[var(--foreground)]">
            ₲ {formattedTarget}
          </div>
          <p className="text-[10px] text-[var(--muted)]">Precio donde idealmente se busca estabilizar la oferta</p>
        </div>

        <div className="space-y-1 border-t md:border-t-0 md:border-l border-[var(--border)] pt-2 md:pt-0 md:pl-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            AUTO DEFENSE TOLERANCE
          </div>
          <div className="text-xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            -{tolerancePct}% <span className="text-xs font-normal text-[var(--muted)]">({policy.autoDefenseToleranceBps} bps)</span>
          </div>
          <p className="text-[10px] text-[var(--muted)]">Rango adicional que autoriza defender automáticamente</p>
        </div>

        <div className="space-y-1 border-t md:border-t-0 md:border-l border-[var(--border)] pt-2 md:pt-0 md:pl-4">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            <ShieldAlert className="h-3.5 w-3.5" /> LÍMITE DE DEFENSA AUTOMÁTICA
          </div>
          <div className="text-2xl font-black tracking-tight text-rose-600 dark:text-rose-400">
            ₲ {formattedAutoLimit}
          </div>
          <p className="text-[10px] font-medium text-rose-600/80 dark:text-rose-400/80">
            Límite hasta donde esta versión autoriza ofertar. Al alcanzarse: STOP / REQUIRE OVERRIDE.
          </p>
        </div>
      </div>

      {/* STRATEGY & TACTICS SUMMARY */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-[12px]">
        <div className="rounded-lg border border-[var(--border)] p-3 bg-background/50">
          <div className="flex items-center gap-1.5 font-medium text-[var(--foreground)] mb-1">
            <Crosshair className="h-3.5 w-3.5 text-blue-500" /> Objetivo de Posición
          </div>
          <p className="font-semibold text-blue-600 dark:text-blue-400">
            Puesto #{policy.targetRank} ({policy.positionStrategy})
          </p>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            Paso de defensa libre: <strong className="text-[var(--foreground)]">₲ {formattedDefenseStep}</strong>
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] p-3 bg-background/50">
          <div className="flex items-center gap-1.5 font-medium text-[var(--foreground)] mb-1">
            <Clock className="h-3.5 w-3.5 text-purple-500" /> Política de Timing
          </div>
          <p className="text-[11px]">
            Lances normales: <span className="font-semibold">{policy.normalPhaseBehavior}</span>
          </p>
          <p className="text-[11px]">
            Safe Window: <span className="font-semibold">{policy.safeWindowBehavior}</span>
          </p>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-0.5">
            Defensa inmediata en Close-Risk: {policy.defendImmediatelyInCloseRisk ? "SÍ" : "NO"}
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] p-3 bg-background/50">
          <div className="flex items-center gap-1.5 font-medium text-[var(--foreground)] mb-1">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-500" /> Etapa MIPYME
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-bold ${
                policy.mipymePolicy?.enabled
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "bg-black/5 dark:bg-white/5 text-[var(--muted)]"
              }`}
            >
              {policy.mipymePolicy?.enabled ? "HABILITADO" : "DESHABILITADO"}
            </span>
            {policy.mipymePolicy?.enabled && (
              <span className="text-[11px] font-mono text-[var(--muted)]">
                ({policy.mipymePolicy.executionMode})
              </span>
            )}
          </div>
          {policy.mipymePolicy?.enabled ? (
            <div className="mt-1.5 space-y-0.5 text-[11px] text-[var(--muted)]">
              <p>
                Paso MIPYME: <strong className="text-[var(--foreground)]">₲ {policy.mipymePolicy.defenseStepPyg.toLocaleString("es-PY")}</strong>
              </p>
              <p className="text-[10px] text-amber-600/80 dark:text-amber-400/80">
                Freno económico: Auto Limit ({formattedAutoLimit})
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-[var(--muted)] mt-1">Ignorar etapa MIPYME post-aleatoria</p>
          )}
        </div>

        <div className="rounded-lg border border-[var(--border)] p-3 bg-background/50">
          <div className="flex items-center gap-1.5 font-medium text-[var(--foreground)] mb-1">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Modo de Operación
          </div>
          <p className="text-[11px]">
            Modo: <strong className="text-[var(--foreground)]">{policy.executionMode}</strong>
          </p>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            Max Staleness: {policy.maxStalenessMs} ms (Fail-closed)
          </p>
          {onUnfreezeRequest && (
            <button
              onClick={onUnfreezeRequest}
              className="mt-2 text-[11px] font-medium text-blue-600 hover:underline cursor-pointer"
            >
              Crear nueva versión / Actualizar autorización
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
