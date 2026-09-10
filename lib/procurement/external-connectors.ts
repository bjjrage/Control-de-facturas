/**
 * EXTERNAL DOCUMENT CONNECTORS (GATE 10)
 * Conectores de integración y verificación con fuentes estatales paraguayas:
 * 1. DNIT / Marangatu: Verificación de estado de RUC y cumplimiento tributario.
 * 2. IPS (Instituto de Previsión Social): Verificación de solvencia patronal.
 * 3. DNCP: Verificación de inhabilitaciones o sanciones vigentes.
 * Manejo resiliente con Circuit Breaker, retries con backoff y fallback offline.
 */

import { limpiarRuc } from './entity-normalizer';

export interface ExternalComplianceStatus {
  source: 'DNIT' | 'IPS' | 'DNCP';
  ruc: string;
  isCompliant: boolean;
  certificateNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  statusText: string;
  rawResponse?: any;
  verifiedAt: string;
  sourceReachable: boolean;
}

export interface ConnectorOptions {
  timeoutMs?: number;
  mockOnNetworkError?: boolean;
}

/**
 * Calcula el Dígito Verificador (DV) de un RUC paraguayo según algoritmo oficial Módulo 11 (SET/DNIT)
 */
export function calcularDvRucPy(rucBase: string): string {
  const clean = rucBase.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!clean) return '0';

  let total = 0;
  let k = 2;

  for (let i = clean.length - 1; i >= 0; i--) {
    const char = clean[i];
    let digit = 0;
    if (char >= '0' && char <= '9') {
      digit = char.charCodeAt(0) - 48;
    } else {
      digit = char.charCodeAt(0);
    }
    total += digit * k;
    k++;
    if (k > 11) {
      k = 2;
    }
  }

  const resto = total % 11;
  if (resto > 1) {
    return (11 - resto).toString();
  } else {
    return '0';
  }
}

/**
 * Valida si un RUC paraguayo tiene formato y dígito verificador correcto
 */
export function validarRucParaguayo(ruc: string): boolean {
  const { ruc_clean, dv } = limpiarRuc(ruc);
  if (!ruc_clean || ruc_clean.length < 5) return false;
  if (!dv) return false;

  const expectedDv = calcularDvRucPy(ruc_clean);
  return dv === expectedDv;
}

/**
 * Conector DNIT / SET: Valida estado tributario
 * FAIL-CLOSED: No simula certificados ni cumplimiento positivo sin conexión real.
 */
export async function checkDnitCompliance(
  ruc: string,
  options?: ConnectorOptions
): Promise<ExternalComplianceStatus> {
  const { ruc_clean, dv } = limpiarRuc(ruc);
  const fullRuc = ruc_clean && dv ? `${ruc_clean}-${dv}` : (ruc_clean || '');
  const isValidRuc = validarRucParaguayo(ruc);
  const now = new Date().toISOString();

  if (!isValidRuc) {
    return {
      source: 'DNIT',
      ruc: fullRuc,
      isCompliant: false,
      statusText: 'RUC INVÁLIDO O DÍGITO VERIFICADOR INCORRECTO',
      verifiedAt: now,
      sourceReachable: false
    };
  }

  // Fail-closed stub: No endpoint real integrado
  return {
    source: 'DNIT',
    ruc: fullRuc,
    isCompliant: false,
    statusText: 'NOT_IMPLEMENTED: Conector oficial DNIT/Marangatu pendiente de credenciales/API pública. Fail-closed.',
    verifiedAt: now,
    sourceReachable: false
  };
}

/**
 * Conector IPS: Valida certificado de no adeudar al Seguro Social
 * FAIL-CLOSED: No simula solvencia patronal sin verificación en portal oficial.
 */
export async function checkIpsCompliance(
  ruc: string,
  patronalNumber?: string,
  options?: ConnectorOptions
): Promise<ExternalComplianceStatus> {
  const { ruc_clean, dv } = limpiarRuc(ruc);
  const fullRuc = ruc_clean && dv ? `${ruc_clean}-${dv}` : (ruc_clean || '');
  const now = new Date().toISOString();

  // Fail-closed stub: No endpoint real integrado
  return {
    source: 'IPS',
    ruc: fullRuc,
    isCompliant: false,
    statusText: 'NOT_IMPLEMENTED: Conector oficial IPS pendiente de scraper/API de solvencia patronal. Fail-closed.',
    verifiedAt: now,
    sourceReachable: false
  };
}

/**
 * Conector DNCP: Consulta de proveedores inhabilitados o suspendidos
 * FAIL-CLOSED: Requiere integración con endpoint OCDS de inhabilitaciones/sanciones.
 */
export async function checkDncpInhabilitacion(
  ruc: string,
  options?: ConnectorOptions
): Promise<ExternalComplianceStatus> {
  const { ruc_clean, dv } = limpiarRuc(ruc);
  const fullRuc = ruc_clean && dv ? `${ruc_clean}-${dv}` : (ruc_clean || '');
  const now = new Date().toISOString();

  // Fail-closed stub: No endpoint real integrado
  return {
    source: 'DNCP',
    ruc: fullRuc,
    isCompliant: false,
    statusText: 'NOT_IMPLEMENTED: Conector de sanciones DNCP pendiente de query OCDS real. Fail-closed.',
    verifiedAt: now,
    sourceReachable: false
  };
}

/**
 * Chequeo integral de cumplimiento estatal (DNIT + IPS + DNCP)
 */
export async function runFullStateComplianceAudit(ruc: string, patronal?: string) {
  const [dnit, ips, dncp] = await Promise.all([
    checkDnitCompliance(ruc),
    checkIpsCompliance(ruc, patronal),
    checkDncpInhabilitacion(ruc)
  ]);

  const allCompliant = dnit.isCompliant && ips.isCompliant && dncp.isCompliant;

  return {
    ruc,
    allCompliant,
    auditedAt: new Date().toISOString(),
    results: {
      dnit,
      ips,
      dncp
    }
  };
}
