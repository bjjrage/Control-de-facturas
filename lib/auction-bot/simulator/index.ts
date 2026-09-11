/**
 * SBE AUCTION BOT - Local Simulator Runner
 * Replays event sequences, logs deterministic state transitions, and verifies policy adherence.
 */

import {
  ActionDecision,
  AuctionState,
  FrozenAuctionPolicy,
  SbeConstraints,
} from '../types';
import { evaluateAuctionStep } from '../engine';
import { AuctionBotStateMachine } from '../state-machine';
import { SimulationEvent } from './fixtures';

export interface SimulationStepResult {
  step: number;
  eventDescription: string;
  state: AuctionState;
  decision: ActionDecision;
  stateMachineState: string;
  passedExpected: boolean;
  notes?: string;
}

export interface SimulationReport {
  policy: FrozenAuctionPolicy;
  totalSteps: number;
  passedSteps: number;
  results: SimulationStepResult[];
  allPassed: boolean;
}

/**
 * Runs a sequence of simulation events against a policy and optional SBE constraints.
 */
export function runAuctionSimulation(
  events: SimulationEvent[],
  policy: FrozenAuctionPolicy,
  constraints?: SbeConstraints
): SimulationReport {
  const machine = new AuctionBotStateMachine(policy);
  machine.startMonitoring();

  const results: SimulationStepResult[] = [];
  let passedCount = 0;

  for (const ev of events) {
    machine.beginEvaluation();

    const decision = evaluateAuctionStep(
      ev.state,
      policy,
      constraints,
      { currentTimestampIso: ev.state.observedAt }
    );

    machine.handleDecision(decision);

    let passedExpected = decision.action === ev.expectedAction;
    if (ev.expectedCandidatePricePyg !== undefined) {
      if (decision.candidatePricePyg !== ev.expectedCandidatePricePyg) {
        passedExpected = false;
      }
    }

    if (passedExpected) {
      passedCount++;
    }

    results.push({
      step: ev.step,
      eventDescription: ev.eventDescription,
      state: ev.state,
      decision,
      stateMachineState: machine.getState(),
      passedExpected,
      notes: passedExpected
        ? 'Decision satisfies simulation assertion.'
        : `Assertion mismatch: expected ${ev.expectedAction} ${ev.expectedCandidatePricePyg ? `(₲${ev.expectedCandidatePricePyg.toLocaleString()})` : ''}, got ${decision.action} ${decision.candidatePricePyg ? `(₲${decision.candidatePricePyg.toLocaleString()})` : ''}`,
    });
  }

  return {
    policy,
    totalSteps: events.length,
    passedSteps: passedCount,
    results,
    allPassed: passedCount === events.length,
  };
}

export * from './fixtures';
