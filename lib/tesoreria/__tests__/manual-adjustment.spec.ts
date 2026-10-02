import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock, requireProfileMock, logAuditMock, revalidatePathMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
  requireProfileMock: vi.fn(),
  logAuditMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth", () => ({ requireProfile: requireProfileMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

import { registrarMovimientoManual } from "@/app/(internal)/tesoreria/actions";

const validCases: Array<{
  name: string;
  tipo: "INGRESO" | "EGRESO" | "AJUSTE";
  monto: number;
  expectedRpcAmount: number;
  permitirNegativo: boolean;
}> = [
  { name: "AJUSTE positivo", tipo: "AJUSTE", monto: 125, expectedRpcAmount: 125, permitirNegativo: true },
  { name: "AJUSTE negativo", tipo: "AJUSTE", monto: -125, expectedRpcAmount: -125, permitirNegativo: true },
  { name: "INGRESO positivo", tipo: "INGRESO", monto: 125, expectedRpcAmount: 125, permitirNegativo: false },
  { name: "EGRESO positivo", tipo: "EGRESO", monto: 125, expectedRpcAmount: -125, permitirNegativo: false },
];

const invalidCases: Array<{ name: string; tipo: "INGRESO" | "EGRESO" | "AJUSTE"; monto: number }> = [
  { name: "AJUSTE cero", tipo: "AJUSTE", monto: 0 },
  { name: "INGRESO negativo", tipo: "INGRESO", monto: -125 },
  { name: "INGRESO cero", tipo: "INGRESO", monto: 0 },
  { name: "EGRESO negativo", tipo: "EGRESO", monto: -125 },
  { name: "EGRESO cero", tipo: "EGRESO", monto: 0 },
];

describe("registrarMovimientoManual — contrato de signo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    requireProfileMock.mockResolvedValue({ empresa_id: "empresa-1", id: "user-1" });
    logAuditMock.mockResolvedValue(undefined);
    rpcMock.mockResolvedValue({ data: 275, error: null });
  });

  it.each(validCases)("$name conserva el contrato de la RPC", async ({ tipo, monto, expectedRpcAmount, permitirNegativo }) => {
    const result = await registrarMovimientoManual({
      cuenta_id: "cuenta-1",
      tipo,
      monto,
      motivo: "  Ajuste de caja  ",
    });

    expect(result).toEqual({ saldo_nuevo: 275 });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("registrar_movimiento_tesoreria", {
      p_empresa_id: "empresa-1",
      p_cuenta_id: "cuenta-1",
      p_monto: expectedRpcAmount,
      p_tipo: tipo,
      p_fecha: null,
      p_motivo: "Ajuste de caja",
      p_project_id: null,
      p_created_by: "user-1",
      p_permitir_negativo: permitirNegativo,
    });
  });

  it.each(invalidCases)("$name se rechaza antes de llamar la RPC", async ({ tipo, monto }) => {
    const result = await registrarMovimientoManual({
      cuenta_id: "cuenta-1",
      tipo,
      monto,
      motivo: "Movimiento manual",
    });

    expect(result.error).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rechaza montos no finitos (%s) antes de llamar la RPC",
    async (monto) => {
      const result = await registrarMovimientoManual({
        cuenta_id: "cuenta-1",
        tipo: "AJUSTE",
        monto,
        motivo: "Movimiento manual",
      });

      expect(result.error).toBeTruthy();
      expect(rpcMock).not.toHaveBeenCalled();
    }
  );
});
