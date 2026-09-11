"use client";

import React, { useState } from "react";
import { FrozenAuctionPolicy, ActionType } from "@/lib/auction-bot/types";
import { runAuctionSimulation, SimulationReport, createCanonicalUserScenario, DEFAULT_SBE_CONSTRAINTS } from "@/lib/auction-bot/simulator";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw, CheckCircle2, AlertTriangle } from "lucide-react";

interface SimulatorRunnerViewProps {
  frozenPolicy: FrozenAuctionPolicy;
}

export function SimulatorRunnerView({ frozenPolicy }: SimulatorRunnerViewProps) {
  const [report, setReport] = useState<SimulationReport | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(-1);

  const events = createCanonicalUserScenario();

  const handleRunFullSimulation = () => {
    const fullReport = runAuctionSimulation(events, frozenPolicy, DEFAULT_SBE_CONSTRAINTS);
    setReport(fullReport);
    setCurrentStepIndex(events.length - 1);
  };

  const handleReset = () => {
    setReport(null);
    setCurrentStepIndex(-1);
  };

  const handleNextStep = () => {
    const nextIdx = currentStepIndex + 1;
    if (nextIdx >= events.length) return;

    const partialEvents = events.slice(0, nextIdx + 1);
    const partialReport = runAuctionSimulation(partialEvents, frozenPolicy, DEFAULT_SBE_CONSTRAINTS);
    setReport(partialReport);
    setCurrentStepIndex(nextIdx);
  };

  const getActionBadgeColor = (action: ActionType) => {
    switch (action) {
      case "BID_CANDIDATE":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
      case "WAIT":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30";
      case "STOP":
        return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30";
      case "HALT":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm space-y-6">
      {/* Simulation Controls Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-2">
            <Play className="h-4 w-4 text-blue-500" /> Simulador Local (Event &rarr; State &rarr; Decision)
          </h2>
          <p className="text-[12px] text-[var(--muted)]">
            Secuencia canónica verificando lances tácticos, defensa en Close-Risk y freno estricto en Auto Limit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleReset} className="h-8 text-xs gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Reiniciar
          </Button>
          <Button
            variant="secondary"
            onClick={handleNextStep}
            disabled={currentStepIndex >= events.length - 1}
            className="h-8 text-xs gap-1.5"
          >
            Paso Siguiente ({currentStepIndex + 1}/{events.length})
          </Button>
          <Button variant="primary" onClick={handleRunFullSimulation} className="h-8 text-xs gap-1.5 font-medium">
            <Play className="h-3.5 w-3.5" /> Ejecutar Completa
          </Button>
        </div>
      </div>

      {/* Progress & Summary Bar */}
      {report && (
        <div className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
          report.allPassed
            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
            : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
        }`}>
          <div className="flex items-center gap-2">
            {report.allPassed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            )}
            <span className="font-semibold">
              Pasos Ejecutados: {report.passedSteps} de {report.totalSteps} verificados con éxito
            </span>
          </div>
          <span className="font-mono text-[11px]">
            Target: ₲{frozenPolicy.targetPricePyg.toLocaleString()} | Auto Limit: ₲{frozenPolicy.autoLimitPyg.toLocaleString()}
          </span>
        </div>
      )}

      {/* Step Sequence Cards */}
      <div className="space-y-4">
        {events.map((event, idx) => {
          const isExecuted = idx <= currentStepIndex;
          const stepResult = report?.results[idx];

          return (
            <div
              key={event.step}
              className={`rounded-lg border transition-all ${
                isExecuted
                  ? "border-[var(--border)] bg-[var(--panel-2)] shadow-xs"
                  : "border-dashed border-[var(--border)] opacity-50 bg-background/30"
              } p-4 space-y-3`}
            >
              {/* Event Title & Metadata */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/10 text-[11px] font-bold text-blue-600">
                    {event.step}
                  </span>
                  <span className="text-[13px] font-semibold text-[var(--foreground)]">
                    {event.eventDescription}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded px-2 py-0.5 font-medium ${
                    event.state.phase === "POST_RANDOM"
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/30"
                      : "bg-black/5 dark:bg-white/5"
                  }`}>
                    Fase: {event.state.phase}
                  </span>
                  <span className="rounded bg-black/5 dark:bg-white/5 px-2 py-0.5 font-medium">
                    Ventana: {event.state.timingWindow}
                  </span>
                  {event.state.closeRisk && (
                    <span className="rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold px-2 py-0.5">
                      CLOSE RISK = TRUE
                    </span>
                  )}
                  {event.state.postRandom && (
                    <span className={`rounded px-2 py-0.5 font-bold ${
                      event.state.postRandom.mipymeBenefitStatus === "AVAILABLE"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : event.state.postRandom.mipymeBenefitStatus === "UNKNOWN"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-black/5 dark:bg-white/5 text-[var(--muted)]"
                    }`}>
                      MIPYME: {event.state.postRandom.mipymeBenefitStatus}
                    </span>
                  )}
                </div>
              </div>

              {/* Competitive State & Offers Snapshot */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
                <div>
                  <div className="text-[11px] font-semibold text-[var(--muted)] mb-1">Ofertas Registradas en SBE:</div>
                  <div className="space-y-1 rounded border border-[var(--border)] p-2 bg-background/50">
                    {event.state.rankedOffers.map((offer) => (
                      <div
                        key={offer.rank}
                        className={`flex items-center justify-between px-2 py-1 rounded text-[11px] ${
                          offer.isOurOffer
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold"
                            : "text-[var(--foreground)]"
                        }`}
                      >
                        <span>
                          #{offer.rank} {offer.isOurOffer ? "NUESTRA EMPRESA" : offer.participantId}
                        </span>
                        <span className="font-mono">₲ {offer.pricePyg.toLocaleString("es-PY")}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Engine Decision Output */}
                <div>
                  <div className="text-[11px] font-semibold text-[var(--muted)] mb-1">Dictamen del Motor Determinístico:</div>
                  {isExecuted && stepResult ? (
                    <div className="rounded border border-[var(--border)] p-3 bg-background/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-2.5 py-0.5 text-[12px] font-bold ${getActionBadgeColor(
                            stepResult.decision.action
                          )}`}
                        >
                          {stepResult.decision.action}
                        </span>
                        <span className="text-[11px] font-mono text-[var(--muted)]">
                          Bot State: {stepResult.stateMachineState}
                        </span>
                      </div>

                      <div className="text-[12px] text-[var(--foreground)] font-medium">
                        {stepResult.decision.reasonDescription}
                      </div>

                      {stepResult.decision.candidatePricePyg !== null && (
                        <div className="flex items-center gap-4 text-[12px] border-t border-[var(--border)] pt-2 font-mono">
                          <div>
                            <span className="text-[var(--muted)]">Lance Propuesto: </span>
                            <strong className="text-emerald-600 dark:text-emerald-400 text-sm">
                              ₲ {stepResult.decision.candidatePricePyg.toLocaleString("es-PY")}
                            </strong>
                          </div>
                          <div>
                            <span className="text-[var(--muted)]">Paso: </span>
                            <span>-₲{stepResult.decision.defenseStepAppliedPyg}</span>
                          </div>
                          <div>
                            <span className="text-[var(--muted)]">Target Rank: </span>
                            <span>#{stepResult.decision.targetRank}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center rounded border border-dashed border-[var(--border)] p-4 text-[11px] text-[var(--muted)]">
                      Esperando ejecución de este paso...
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
