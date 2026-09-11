/**
 * SBE AUCTION BOT - Strategy Mapping
 * Clean abstraction mapping position goals to target ranks.
 */

import { PositionStrategyId } from '../types';
import { evaluatePositionGoal, PositionGoalResult } from '../position-evaluator';
import { AuctionState } from '../types';

export function resolveTargetRank(strategyId: PositionStrategyId, configuredTargetRank?: number): number {
  if (configuredTargetRank && configuredTargetRank >= 1) {
    return configuredTargetRank;
  }
  switch (strategyId) {
    case 'TARGET_RANK_1':
    case 'MAINTAIN_RANK_1':
      return 1;
    case 'TARGET_TOP_2':
    case 'MAINTAIN_TOP_2':
      return 2;
    case 'TARGET_TOP_3':
    case 'MAINTAIN_TOP_3':
      return 3;
    default:
      return 1;
  }
}

export { evaluatePositionGoal };
export type { PositionGoalResult };
