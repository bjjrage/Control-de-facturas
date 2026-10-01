import type { ScannerEnginePreference } from './debug-store';

/**
 * Set true only after the shared A/B benchmark clears the scanner quality gates.
 * A forced scannerEngine=scanic override remains available for controlled testing.
 */
export const SCANIC_AUTO_QUALITY_GATE = false;

export function shouldUseScanicPrimary(preference: ScannerEnginePreference): boolean {
  return preference === 'scanic' || (preference === 'auto' && SCANIC_AUTO_QUALITY_GATE);
}

export function shouldUseScanicPerspective(preference: ScannerEnginePreference): boolean {
  return preference === 'scanic' || (preference === 'auto' && SCANIC_AUTO_QUALITY_GATE);
}
