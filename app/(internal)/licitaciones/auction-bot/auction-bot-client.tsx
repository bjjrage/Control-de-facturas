"use client";

import React, { useState } from "react";
import { FrozenAuctionPolicy } from "@/lib/auction-bot/types";
import { PolicySummaryCard } from "@/components/auction-bot/policy-summary-card";
import { PolicyConfigForm } from "@/components/auction-bot/policy-config-form";
import { SimulatorRunnerView } from "@/components/auction-bot/simulator-runner-view";
import { Bot, Sliders, PlaySquare } from "lucide-react";

export function AuctionBotClient() {
  // No fake active policy: the UI starts with NO policy. Nothing is shown as
  // frozen/authorized until the operator configures and freezes version 1.
  const [activePolicy, setActivePolicy] = useState<FrozenAuctionPolicy | null>(null);
  const [activeTab, setActiveTab] = useState<"config" | "simulator">("config");

  const handlePolicyFrozen = (newFrozenPolicy: FrozenAuctionPolicy) => {
    setActivePolicy(newFrozenPolicy);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
                SBE Auction Bot V0
              </h1>
              <p className="text-[12px] text-[var(--muted)]">
                Motor determinístico de subasta electrónica inversa (DNCP / SBE) • Bounded Context Autónomo
              </p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1">
          <button
            onClick={() => setActiveTab("config")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === "config"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            <Sliders className="h-3.5 w-3.5" /> Política & Autorización
          </button>
          <button
            onClick={() => activePolicy && setActiveTab("simulator")}
            disabled={!activePolicy}
            title={activePolicy ? undefined : "Congelá una política (versión 1) para habilitar el simulador"}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              !activePolicy
                ? "text-[var(--muted)] opacity-50 cursor-not-allowed"
                : activeTab === "simulator"
                ? "bg-blue-600 text-white shadow-xs cursor-pointer"
                : "text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer"
            }`}
          >
            <PlaySquare className="h-3.5 w-3.5" /> Simulador de Subasta
          </button>
        </div>
      </div>

      {/* Persistent Frozen Policy Banner */}
      <PolicySummaryCard
        policy={activePolicy}
        onUnfreezeRequest={() => setActiveTab("config")}
      />

      {/* Active Tab Content */}
      {activeTab === "config" && (
        <PolicyConfigForm
          initialPolicy={activePolicy ?? undefined}
          activeFrozenPolicy={activePolicy}
          onPolicyFrozen={handlePolicyFrozen}
        />
      )}

      {activeTab === "simulator" && activePolicy && (
        <SimulatorRunnerView frozenPolicy={activePolicy} />
      )}
    </div>
  );
}
