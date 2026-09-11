import { describe, it, expect } from 'vitest';
import {
  calculateAutoLimitPyg,
  tolerancePctToBps,
  bpsToTolerancePct,
  validateAuctionPolicy,
  freezePolicy,
  verifyPolicyFingerprint,
  deepFreeze,
} from '../policy';
import { AuctionPolicy } from '../types';
import { PolicyValidationError } from '../errors';

describe('AuctionPolicy & Monetary Arithmetic Specification (Sanitized V0)', () => {
  it('calculates autoLimitPyg accurately using pure integer arithmetic via basis points', () => {
    // 1.000.000 with 200 bps (2%) -> 980.000 (exact, ceil == floor)
    expect(calculateAutoLimitPyg(1_000_000, 200)).toBe(980_000);
    // 500.000 with 500 bps (5%) -> 475.000 (exact)
    expect(calculateAutoLimitPyg(500_000, 500)).toBe(475_000);
    // 0 bps (0%) -> target price itself
    expect(calculateAutoLimitPyg(1_000_000, 0)).toBe(1_000_000);
    // 10000 bps (100%) -> 0
    expect(calculateAutoLimitPyg(1_000_000, 10000)).toBe(0);
  });

  it('uses CEIL (never floor): the effective deviation can never exceed the authorized tolerance', () => {
    // Tolerance is the MAXIMUM authorized deviation, autoLimit the MINIMUM
    // permitted integer price. Flooring would authorize a price strictly below
    // the true economic boundary.
    //
    // Inexact division: 1.234.567 PYG with 150 bps (1.5%)
    // (1.234.567 * 9850) / 10000 = 12.160.484.950 / 10.000 = 1.216.048,495 -> CEIL 1.216.049
    const inexactLimit = calculateAutoLimitPyg(1_234_567, 150);
    expect(inexactLimit).toBe(1_216_049);
    expect(Number.isInteger(inexactLimit)).toBe(true);
    // Effective deviation: (1.234.567 - 1.216.049) / 1.234.567 = 1,49996% <= 1.5% ✓
    expect(1_234_567 - inexactLimit).toBeLessThanOrEqual((1_234_567 * 150) / 10000);

    // Inexact division: 999.999 PYG with 333 bps (3.33%)
    // (999.999 * 9667) / 10000 = 9666990333 / 10000 = 966.699,0333 -> CEIL 966.700
    const inexactLimit2 = calculateAutoLimitPyg(999_999, 333);
    expect(inexactLimit2).toBe(966_700);
    expect(999_999 - inexactLimit2).toBeLessThanOrEqual((999_999 * 333) / 10000);
  });

  it('converts between percentages and integer basis points without float drift', () => {
    expect(tolerancePctToBps(1.5)).toBe(150);
    expect(bpsToTolerancePct(150)).toBe(1.5);
    expect(tolerancePctToBps(0.25)).toBe(25);
    expect(tolerancePctToBps(3.33)).toBe(333);
  });
  it('validates free defenseStep allowing any positive integer (7, 23, 5000, etc.)', () => {
    const validPolicy: AuctionPolicy = {
      policyId: 'pol-free-step',
      auctionId: 'auc-dncp-100',
      groupId: 'item-5',
      scope: 'ITEM',
      positionStrategy: 'TARGET_RANK_1',
      targetRank: 1,
      defenseStepPyg: 7, // Custom non-standard step
      normalPhaseBehavior: 'WAIT',
      safeWindowBehavior: 'WAIT',
      enterTargetPositionInEntryWindow: true,
      defendImmediatelyInCloseRisk: true,
      targetPricePyg: 1_000_000,
      autoDefenseToleranceBps: 200,
      autoLimitPyg: 980_000,
      mipymePolicy: {
        enabled: true,
        executionMode: 'BOUNDED_AUTO',
        defenseStepPyg: 7,
        economicLimitMode: 'USE_CURRENT_AUTO_LIMIT',
      },
      executionMode: 'BOUNDED_AUTO',
      maxStalenessMs: 5000,
      authorizedBy: 'operador@empresa.com.py',
    };

    const errors = validateAuctionPolicy(validPolicy);
    expect(errors).toHaveLength(0);

    const frozen = freezePolicy(validPolicy, 1);
    expect(frozen.defenseStepPyg).toBe(7);
  });

  it('enforces deep immutability using deepFreeze', () => {
    const testObj = {
      policyId: 'pol-deep',
      nested: {
        limits: {
          floor: 980_000,
        },
      },
    };

    const frozen = deepFreeze(testObj);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
    expect(Object.isFrozen(frozen.nested.limits)).toBe(true);

    expect(() => {
      (frozen.nested.limits as any).floor = 500_000;
    }).toThrow();
  });

  it('validates policy authorization metadata and technical fingerprint', () => {
    const policy: AuctionPolicy = {
      policyId: 'pol-auth-01',
      auctionId: 'auc-01',
      groupId: 'grp-01',
      scope: 'ITEM',
      positionStrategy: 'TARGET_RANK_1',
      targetRank: 1,
      defenseStepPyg: 23,
      normalPhaseBehavior: 'WAIT',
      safeWindowBehavior: 'WAIT',
      enterTargetPositionInEntryWindow: true,
      defendImmediatelyInCloseRisk: true,
      targetPricePyg: 2_000_000,
      autoDefenseToleranceBps: 150, // 1.5%
      autoLimitPyg: 1_970_000,
      mipymePolicy: {
        enabled: true,
        executionMode: 'BOUNDED_AUTO',
        defenseStepPyg: 23,
        economicLimitMode: 'USE_CURRENT_AUTO_LIMIT',
      },
      executionMode: 'BOUNDED_AUTO',
      maxStalenessMs: 5000,
      authorizedBy: 'gerencia.comercial@empresa.com.py',
    };

    const frozen = freezePolicy(policy, 1);
    expect(frozen.authorizedBy).toBe('gerencia.comercial@empresa.com.py');
    expect(frozen.authorizedAt).toBeDefined();
    expect(frozen.version).toBe(1);
    expect(frozen.policyFingerprint).toBeDefined();
    expect(verifyPolicyFingerprint(frozen)).toBe(true);

    // Tampering check
    const tampered = { ...frozen, targetPricePyg: 1_500_000 };
    expect(verifyPolicyFingerprint(tampered as any)).toBe(false);
  });
});
