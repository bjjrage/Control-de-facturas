import { describe, it, expect } from 'vitest';
import { runAuctionSimulation } from '../simulator';
import { BASE_POLICY, createCanonicalUserScenario, DEFAULT_SBE_CONSTRAINTS } from '../simulator/fixtures';
import { AuctionBotStateMachine } from '../state-machine';
import { evaluateAuctionStep } from '../engine';
import { freezePolicy } from '../policy';
import { AuctionState } from '../types';

describe('End-to-End Simulation & Policy Version Upgrade Specification', () => {
  it('successfully executes the canonical user business scenario step-by-step', () => {
    const events = createCanonicalUserScenario();
    const report = runAuctionSimulation(events, BASE_POLICY, DEFAULT_SBE_CONSTRAINTS);

    expect(report.allPassed).toBe(true);
    expect(report.passedSteps).toBe(events.length);
    expect(report.totalSteps).toBe(9);

    // Key assertions:
    expect(report.results[0].decision.action).toBe('WAIT');
    expect(report.results[1].decision.action).toBe('WAIT'); // Normal bidding tactical wait
    expect(report.results[2].decision.action).toBe('WAIT'); // Safe window tactical wait
    expect(report.results[3].decision.action).toBe('BID_CANDIDATE'); // Entry window seek #1
    expect(report.results[3].decision.candidatePricePyg).toBe(1_009_990);
    expect(report.results[4].decision.action).toBe('WAIT'); // Already in #1
    expect(report.results[5].decision.action).toBe('BID_CANDIDATE'); // Defend in close-risk (999.989)
    expect(report.results[5].decision.candidatePricePyg).toBe(999_989);
    expect(report.results[6].decision.action).toBe('STOP'); // Breaches 980.000 Auto Limit -> STOP
    expect(report.results[6].decision.reasonCode).toBe('ECONOMIC_LIMIT_BREACHED');
    expect(report.results[7].decision.action).toBe('BID_CANDIDATE'); // POST_RANDOM MIPYME AVAILABLE
    expect(report.results[7].decision.candidatePricePyg).toBe(989_990);
    expect(report.results[7].decision.policyVersion).toBe(2); // operator override after the STOP
    expect(report.results[8].decision.action).toBe('STOP'); // Auction closed
  });

  it('allows authorizing a new Policy Version after reaching Auto Limit and resuming operations', () => {
    const machine = new AuctionBotStateMachine(BASE_POLICY);
    machine.startMonitoring();

    // State where competitor is at 980.005 -> required bid is 979.995 (< 980.000 Auto Limit of v1)
    const criticalState: AuctionState = {
      auctionId: BASE_POLICY.auctionId,
      groupId: BASE_POLICY.groupId,
      scope: 'ITEM',
      phase: 'RANDOM_CLOSE',
      timingWindow: 'CLOSE_RISK_WINDOW',
      closeRisk: true,
      status: 'ACTIVE',
      rankedOffers: [
        { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 980_005, timestamp: '2026-09-10T20:01:00.000Z' },
        { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 999_989, timestamp: '2026-09-10T20:00:50.000Z' },
      ],
      ourRank: 2,
      ourCurrentPricePyg: 999_989,
      observedAt: '2026-09-10T20:01:00.000Z',
    };

    machine.beginEvaluation();
    const decisionV1 = evaluateAuctionStep(criticalState, BASE_POLICY, undefined, {
      currentTimestampIso: criticalState.observedAt,
    });

    expect(decisionV1.action).toBe('STOP');
    expect(decisionV1.reasonCode).toBe('ECONOMIC_LIMIT_BREACHED');
    machine.handleDecision(decisionV1);
    expect(machine.getState()).toBe('STOPPED');

    // OPERATOR OVERRIDE: Authorize Policy Version 2 with 500 bps (5% tolerance -> Auto Limit = 950.000)
    const policyV2 = freezePolicy(
      {
        ...BASE_POLICY,
        autoDefenseToleranceBps: 500, // 5%
        autoLimitPyg: 950_000,
        authorizedBy: 'director.comercial@empresa.com.py',
      },
      2, // version 2
      '2026-09-10T20:01:10.000Z'
    );

    // Apply new version to state machine
    machine.applyNewPolicyVersion(policyV2);
    expect(machine.getState()).toBe('MONITORING');
    expect(machine.getContext().policy.version).toBe(2);
    expect(machine.getContext().policy.autoLimitPyg).toBe(950_000);

    // Re-evaluate the same critical state with Policy V2
    machine.beginEvaluation();
    const decisionV2 = evaluateAuctionStep(criticalState, policyV2, undefined, {
      currentTimestampIso: criticalState.observedAt,
    });

    // Now it generates BID_CANDIDATE because 979.995 >= 950.000!
    expect(decisionV2.action).toBe('BID_CANDIDATE');
    expect(decisionV2.candidatePricePyg).toBe(979_995);
    expect(decisionV2.policyVersion).toBe(2);

    machine.handleDecision(decisionV2);
    expect(machine.getState()).toBe('BID_READY');
  });
});
