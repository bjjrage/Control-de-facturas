"use client";

import React, { useState } from "react";
import {
  AuctionPolicy,
  FrozenAuctionPolicy,
  PositionStrategyId,
  NormalPhaseBehavior,
  SafeWindowBehavior,
  ExecutionMode,
} from "@/lib/auction-bot/types";
import {
  calculateAutoLimitPyg,
  freezePolicy,
  validateAuctionPolicy,
  tolerancePctToBps,
  bpsToTolerancePct,
} from "@/lib/auction-bot/policy";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Lock, Info, AlertCircle, UserCheck } from "lucide-react";

interface PolicyConfigFormProps {
  initialPolicy?: AuctionPolicy;
  activeFrozenPolicy?: FrozenAuctionPolicy | null;
  onPolicyFrozen: (frozenPolicy: FrozenAuctionPolicy) => void;
}

export function PolicyConfigForm({
  initialPolicy,
  activeFrozenPolicy,
  onPolicyFrozen,
}: PolicyConfigFormProps) {
  const [auctionId, setAuctionId] = useState(initialPolicy?.auctionId || "lic-dncp-2026-001");
  const [groupId, setGroupId] = useState(initialPolicy?.groupId || "item-1");
  const [targetRank, setTargetRank] = useState<number>(initialPolicy?.targetRank || 1);
  const [positionStrategy, setPositionStrategy] = useState<PositionStrategyId>(
    initialPolicy?.positionStrategy || "TARGET_RANK_1"
  );
  // Free numeric defense step > 0
  const [defenseStepPyg, setDefenseStepPyg] = useState<number>(initialPolicy?.defenseStepPyg || 10);
  const [normalPhaseBehavior, setNormalPhaseBehavior] = useState<NormalPhaseBehavior>(
    initialPolicy?.normalPhaseBehavior || "WAIT"
  );
  const [safeWindowBehavior, setSafeWindowBehavior] = useState<SafeWindowBehavior>(
    initialPolicy?.safeWindowBehavior || "WAIT"
  );
  const [enterInEntryWindow, setEnterInEntryWindow] = useState<boolean>(
    initialPolicy?.enterTargetPositionInEntryWindow ?? true
  );
  const [defendInCloseRisk, setDefendInCloseRisk] = useState<boolean>(
    initialPolicy?.defendImmediatelyInCloseRisk ?? true
  );

  const [targetPricePyg, setTargetPricePyg] = useState<number>(
    initialPolicy?.targetPricePyg || 1_000_000
  );
  // Tolerance in Basis Points
  const [toleranceBps, setToleranceBps] = useState<number>(
    initialPolicy?.autoDefenseToleranceBps ?? 200
  );
  const [tolerancePctInput, setTolerancePctInput] = useState<number>(
    initialPolicy ? bpsToTolerancePct(initialPolicy.autoDefenseToleranceBps) : 2.0
  );
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(
    initialPolicy?.executionMode || "BOUNDED_AUTO"
  );
  const [authorizedBy, setAuthorizedBy] = useState<string>(
    initialPolicy?.authorizedBy || "analista.licitaciones@empresa.com.py"
  );
  // MIPYME Policy Configuration
  const [mipymeEnabled, setMipymeEnabled] = useState<boolean>(
    initialPolicy?.mipymePolicy?.enabled ?? true
  );
  const [mipymeExecutionMode, setMipymeExecutionMode] = useState<ExecutionMode>(
    initialPolicy?.mipymePolicy?.executionMode ?? "BOUNDED_AUTO"
  );
  const [mipymeDefenseStepPyg, setMipymeDefenseStepPyg] = useState<number>(
    initialPolicy?.mipymePolicy?.defenseStepPyg ?? 10
  );

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  // Real-time calculated Auto Limit using integer BigInt arithmetic
  const calculatedAutoLimit = calculateAutoLimitPyg(targetPricePyg, toleranceBps);

  const handleTolerancePctChange = (pct: number) => {
    setTolerancePctInput(pct);
    setToleranceBps(tolerancePctToBps(pct));
  };

  const handleStrategyChange = (strat: PositionStrategyId) => {
    setPositionStrategy(strat);
    if (strat === "TARGET_RANK_1" || strat === "MAINTAIN_RANK_1") setTargetRank(1);
    else if (strat === "TARGET_TOP_2" || strat === "MAINTAIN_TOP_2") setTargetRank(2);
    else if (strat === "TARGET_TOP_3" || strat === "MAINTAIN_TOP_3") setTargetRank(3);
  };

  const handlePrepareFreeze = () => {
    const draftPolicy: AuctionPolicy = {
      policyId: activeFrozenPolicy ? activeFrozenPolicy.policyId : `pol-${Date.now().toString(36)}`,
      auctionId,
      groupId,
      scope: "ITEM",
      positionStrategy,
      targetRank,
      defenseStepPyg,
      normalPhaseBehavior,
      safeWindowBehavior,
      enterTargetPositionInEntryWindow: enterInEntryWindow,
      defendImmediatelyInCloseRisk: defendInCloseRisk,
      targetPricePyg,
      autoDefenseToleranceBps: toleranceBps,
      autoLimitPyg: calculatedAutoLimit,
      mipymePolicy: {
        enabled: mipymeEnabled,
        executionMode: mipymeExecutionMode,
        defenseStepPyg: mipymeDefenseStepPyg,
        economicLimitMode: "USE_CURRENT_AUTO_LIMIT",
      },
      executionMode,
      maxStalenessMs: 5000,
      authorizedBy,
    };

    const errors = validateAuctionPolicy(draftPolicy);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    setShowConfirmModal(true);
  };

  const handleConfirmFreeze = () => {
    const nextVersion = activeFrozenPolicy ? activeFrozenPolicy.version + 1 : 1;

    const draftPolicy: AuctionPolicy = {
      policyId: activeFrozenPolicy ? activeFrozenPolicy.policyId : `pol-${Date.now().toString(36)}`,
      auctionId,
      groupId,
      scope: "ITEM",
      positionStrategy,
      targetRank,
      defenseStepPyg,
      normalPhaseBehavior,
      safeWindowBehavior,
      enterTargetPositionInEntryWindow: enterInEntryWindow,
      defendImmediatelyInCloseRisk: defendInCloseRisk,
      targetPricePyg,
      autoDefenseToleranceBps: toleranceBps,
      autoLimitPyg: calculatedAutoLimit,
      mipymePolicy: {
        enabled: mipymeEnabled,
        executionMode: mipymeExecutionMode,
        defenseStepPyg: mipymeDefenseStepPyg,
        economicLimitMode: "USE_CURRENT_AUTO_LIMIT",
      },
      executionMode,
      maxStalenessMs: 5000,
      authorizedBy,
    };

    const frozen = freezePolicy(draftPolicy, nextVersion);
    setShowConfirmModal(false);
    onPolicyFrozen(frozen);
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">Configuración de Política (AuctionPolicy)</h2>
          <p className="text-[12px] text-[var(--muted)]">
            Definición desacoplada de Objetivo de Posición, Timing y Límites de Autorización Económica.
          </p>
        </div>
        {activeFrozenPolicy && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded">
            <Lock className="h-3.5 w-3.5" /> Modificar generará la versión v{activeFrozenPolicy.version + 1}
          </div>
        )}
      </div>

      {validationErrors.length > 0 && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-red-600 dark:text-red-400 text-[12px] space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertCircle className="h-4 w-4" /> Errores de validación:
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Grid: Auction Identifiers & Authorization */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-[12px] font-medium text-[var(--foreground)] mb-1">ID Subasta (DNCP)</label>
          <input
            type="text"
            value={auctionId}
            onChange={(e) => setAuctionId(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-[var(--foreground)] mb-1">ID Ítem / Lote</label>
          <input
            type="text"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-[var(--foreground)] mb-1">Operador / Autorizado por</label>
          <input
            type="text"
            value={authorizedBy}
            onChange={(e) => setAuthorizedBy(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* SECCIÓN 1: OBJETIVO DE POSICIÓN & PASO DE DEFENSA */}
      <div className="space-y-3">
        <h3 className="text-[13px] font-semibold text-[var(--foreground)] flex items-center gap-1.5">
          1. Objetivo de Posición & Paso de Defensa Libre
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-[var(--muted)] mb-1">Objetivo de Posición</label>
            <select
              value={positionStrategy}
              onChange={(e) => handleStrategyChange(e.target.value as PositionStrategyId)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="TARGET_RANK_1">Posición #1 (Líder)</option>
              <option value="TARGET_TOP_2">Top 2 (Menor movimiento necesario)</option>
              <option value="TARGET_TOP_3">Top 3 (Menor movimiento necesario)</option>
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[var(--muted)] mb-1">Puesto Objetivo (Rank)</label>
            <input
              type="number"
              min={1}
              value={targetRank}
              onChange={(e) => setTargetRank(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[var(--muted)] mb-1">
              Paso de Defensa (defenseStepPyg) - Valor Libre
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={defenseStepPyg}
                onChange={(e) => setDefenseStepPyg(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Cualquier entero > 0"
              />
              <div className="flex gap-1">
                {[1, 10, 100, 1000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    title={`Preset rápido ₲${preset}`}
                    onClick={() => setDefenseStepPyg(preset)}
                    className={`px-1.5 py-1 rounded text-[10px] border cursor-pointer ${
                      defenseStepPyg === preset
                        ? "bg-blue-600 text-white border-blue-600 font-bold"
                        : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    ₲{preset}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-1">Cualquier valor entero en Guaraníes (ej. ₲7, ₲23, ₲5.000).</p>
          </div>
        </div>
      </div>

      {/* SECCIÓN 2: POLÍTICA DE TIMING */}
      <div className="space-y-3">
        <h3 className="text-[13px] font-semibold text-[var(--foreground)] flex items-center gap-1.5">
          2. Política Temporal (Timing)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-[var(--muted)] mb-1">
              Fase Normal de Lances
            </label>
            <select
              value={normalPhaseBehavior}
              onChange={(e) => setNormalPhaseBehavior(e.target.value as NormalPhaseBehavior)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="WAIT">WAIT (Espera táctica - no revelar estrategia)</option>
              <option value="ACTIVE">ACTIVE (Ofertar activamente)</option>
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[var(--muted)] mb-1">
              Fase Aleatoria: Safe Window (Sin riesgo de cierre)
            </label>
            <select
              value={safeWindowBehavior}
              onChange={(e) => setSafeWindowBehavior(e.target.value as SafeWindowBehavior)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="WAIT">WAIT (Continuar en espera táctica)</option>
              <option value="ACTIVE">ACTIVE (Ofertar activamente)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <label className="flex items-center gap-2 text-[12px] text-[var(--foreground)] cursor-pointer">
            <input
              type="checkbox"
              checked={enterInEntryWindow}
              onChange={(e) => setEnterInEntryWindow(e.target.checked)}
              className="rounded border-[var(--border)] text-blue-600 focus:ring-blue-500"
            />
            <span>Adquirir posición objetivo en <strong>Entry Window</strong></span>
          </label>

          <label className="flex items-center gap-2 text-[12px] text-[var(--foreground)] cursor-pointer">
            <input
              type="checkbox"
              checked={defendInCloseRisk}
              onChange={(e) => setDefendInCloseRisk(e.target.checked)}
              className="rounded border-[var(--border)] text-blue-600 focus:ring-blue-500"
            />
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              Defensa inmediata ante desplazamiento en <strong>Close-Risk Window</strong>
            </span>
          </label>
        </div>
      </div>

      {/* SECCIÓN 3: AUTORIZACIÓN ECONÓMICA & AUTO LIMIT */}
      <div className="space-y-3">
        <h3 className="text-[13px] font-semibold text-[var(--foreground)] flex items-center gap-1.5">
          3. Límites Económicos y Autorización Automática
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-[var(--muted)] mb-1">
              Target Price (₲ PYG)
            </label>
            <input
              type="number"
              value={targetPricePyg}
              onChange={(e) => setTargetPricePyg(Math.max(1, parseInt(e.target.value) || 0))}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[14px] font-bold text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">Precio donde idealmente se busca estabilizar la oferta.</p>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[var(--muted)] mb-1">
              Auto Defense Tolerance (%) / {toleranceBps} bps
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={tolerancePctInput}
                onChange={(e) => handleTolerancePctChange(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[14px] font-bold text-amber-600 dark:text-amber-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-sm font-bold text-[var(--muted)]">%</span>
              <div className="flex gap-1">
                {[1, 1.5, 2, 3].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleTolerancePctChange(pct)}
                    className={`px-2 py-1 rounded text-[11px] border cursor-pointer ${
                      tolerancePctInput === pct
                        ? "bg-amber-600 text-white border-amber-600 font-bold"
                        : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Rango adicional autorizado. Internamente calculado en enteros: {toleranceBps} puntos básicos (bps).
            </p>
          </div>
        </div>

        {/* PROMINENT AUTO DEFENSE LIMIT DISPLAY */}
        <div className="rounded-xl border-2 border-rose-500/40 bg-rose-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <Info className="h-4 w-4" /> LÍMITE DE DEFENSA AUTOMÁTICA (AUTO LIMIT)
            </div>
            <div className="text-2xl sm:text-3xl font-black text-rose-600 dark:text-rose-400 tracking-tight mt-0.5">
              ₲ {calculatedAutoLimit.toLocaleString("es-PY")}
            </div>
            <p className="text-[11px] text-rose-700 dark:text-rose-300 font-medium">
              El bot puede cruzar ₲{targetPricePyg.toLocaleString("es-PY")} si candidate &ge; ₲{calculatedAutoLimit.toLocaleString("es-PY")}.
              Al alcanzarse este valor el bot se detiene (STOP / REQUIRE OVERRIDE) y solicita una nueva Policy Version para continuar.
            </p>
          </div>
        </div>
      </div>

      {/* SECCIÓN 4: BENEFICIO MIPYME (LAST CHANCE) */}
      <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[var(--foreground)] flex items-center gap-1.5">
            4. Beneficio MIPYME (Oportunidad Especial Post-Aleatoria)
          </h3>
          <span className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium px-2 py-0.5 rounded">
            Post-Random Stage
          </span>
        </div>

        <p className="text-[11px] text-[var(--muted)]">
          Esta opción sólo actúa si el SBE habilita oficialmente el beneficio para esta subasta. No se asume elegibilidad previa.
        </p>

        <div className="pt-1">
          <label className="flex items-center gap-2 text-[12px] text-[var(--foreground)] cursor-pointer">
            <input
              type="checkbox"
              checked={mipymeEnabled}
              onChange={(e) => setMipymeEnabled(e.target.checked)}
              className="rounded border-[var(--border)] text-blue-600 focus:ring-blue-500"
            />
            <span className="font-medium">Utilizar si SBE lo habilita</span>
          </label>
        </div>

        {mipymeEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Modo</label>
              <select
                value={mipymeExecutionMode}
                onChange={(e) => setMipymeExecutionMode(e.target.value as ExecutionMode)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[12px] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="BOUNDED_AUTO">Bounded Auto</option>
                <option value="ASSISTED">Assisted</option>
                <option value="OBSERVE">Observe</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Movimiento de defensa (₲ PYG)
              </label>
              <input
                type="number"
                min={1}
                value={mipymeDefenseStepPyg}
                onChange={(e) => setMipymeDefenseStepPyg(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[12px] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-[10px] text-[var(--muted)] mt-0.5">Margen para superar el mejor precio final.</p>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Límite económico</label>
              <div className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[12px] font-semibold text-[var(--foreground)] flex items-center justify-between">
                <span>Usar Auto Limit vigente</span>
                <span className="text-[10px] text-rose-600 font-mono">₲ {calculatedAutoLimit.toLocaleString()}</span>
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-0.5">Respeta el límite económico de la política.</p>
            </div>
          </div>
        )}
      </div>

      {/* SECCIÓN 5: MODO DE EJECUCIÓN GENERAL */}
      <div className="space-y-3">
        <h3 className="text-[13px] font-semibold text-[var(--foreground)] flex items-center gap-1.5">
          5. Modo de Operación General
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(["OBSERVE", "ASSISTED", "BOUNDED_AUTO"] as ExecutionMode[]).map((mode) => (
            <label
              key={mode}
              className={`flex flex-col p-3 rounded-lg border cursor-pointer transition-all ${
                executionMode === mode
                  ? "border-blue-600 bg-blue-500/10 ring-1 ring-blue-600"
                  : "border-[var(--border)] bg-[var(--panel-2)] hover:bg-[var(--hover)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[var(--foreground)]">{mode}</span>
                <input
                  type="radio"
                  name="executionMode"
                  checked={executionMode === mode}
                  onChange={() => setExecutionMode(mode)}
                  className="text-blue-600"
                />
              </div>
              <span className="text-[11px] text-[var(--muted)] mt-1">
                {mode === "OBSERVE" && "Solo audita y registra qué lance realizaría, sin generar órdenes."}
                {mode === "ASSISTED" && "Genera el candidate y solicita confirmación del operador."}
                {mode === "BOUNDED_AUTO" && "Ejecución automática estricta dentro de los límites autorizados."}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* ACTION BUTTON */}
      <div className="pt-2 flex justify-end">
        <Button onClick={handlePrepareFreeze} variant="primary" className="gap-2 px-5 h-9 text-sm font-semibold">
          <Lock className="h-4 w-4" /> Congelar y Autorizar Versión {activeFrozenPolicy ? activeFrozenPolicy.version + 1 : 1}
        </Button>
      </div>

      {/* CONFIRMATION / FREEZE SUMMARY MODAL */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3 text-[var(--foreground)] font-semibold text-base">
              <ShieldCheck className="h-5 w-5 text-emerald-500" /> Confirmar y Congelar Autorización (v{activeFrozenPolicy ? activeFrozenPolicy.version + 1 : 1})
            </div>

            <p className="text-[13px] text-[var(--muted)]">
              Esta versión quedará formalmente congelada. Cualquier cambio posterior requerirá generar una nueva versión autorizada.
            </p>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4 text-[12px] space-y-2">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Subasta / Ítem:</span>
                <span className="font-semibold">{auctionId} / {groupId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Autorizado por:</span>
                <span className="font-semibold text-blue-600">{authorizedBy}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Objetivo de Posición:</span>
                <span className="font-semibold">Puesto #{targetRank}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Paso de Defensa:</span>
                <span className="font-semibold">₲ {defenseStepPyg.toLocaleString("es-PY")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Beneficio MIPYME:</span>
                <span className="font-semibold">{mipymeEnabled ? `Habilitado (Paso: ₲${mipymeDefenseStepPyg.toLocaleString()} - ${mipymeExecutionMode})` : 'Deshabilitado'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Target Price:</span>
                <span className="font-semibold">₲ {targetPricePyg.toLocaleString("es-PY")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Tolerancia:</span>
                <span className="font-semibold text-amber-600">-{tolerancePctInput}% ({toleranceBps} bps)</span>
              </div>
              <div className="flex justify-between border-t border-[var(--border)] pt-2 text-rose-600 dark:text-rose-400 font-bold">
                <span>LÍMITE DE DEFENSA AUTOMÁTICA:</span>
                <span>₲ {calculatedAutoLimit.toLocaleString("es-PY")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Modo General:</span>
                <span className="font-semibold">{executionMode}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowConfirmModal(false)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={handleConfirmFreeze} className="gap-1.5">
                <Lock className="h-4 w-4" /> Confirmar y Autorizar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
