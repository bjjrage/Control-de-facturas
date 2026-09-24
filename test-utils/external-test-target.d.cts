export interface ExternalTestTargetOptions {
  url?: string | null;
  projectRef?: string | null;
  label?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

export function assertNonProductionTestTarget(
  options: ExternalTestTargetOptions,
): void;
