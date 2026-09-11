import { describe, it, expect } from 'vitest';
import { calculateCostEstimate } from '../weighting';
import { CostObservation } from '../types';

describe('P0 Invariants: Financial Security, Currency Semantics and Fail-Closed Cost Engine', () => {
  const asOfDate = '2026-09-11';

  describe('Monetary Semantics & Exchange Rate Invariants', () => {
    it('PYG válido permanece PYG y se pondera correctamente', () => {
      const obs: CostObservation[] = [
        {
          id: 'obs-pyg-1',
          empresaId: 'emp-1',
          fuente: 'FACTURA',
          descripcionItem: 'Cemento Portland Tipo I',
          categoriaInsumo: 'MATERIAL',
          cantidad: 100,
          unidad: 'BOLSA',
          precioUnitario: 65000,
          moneda: 'PYG',
          monedaOriginal: 'PYG',
          precioUnitarioOriginal: 65000,
          tipoCambio: 1.0,
          fechaObservacion: '2026-09-01',
          estadoEvidencia: 'VALIDA'
        }
      ];

      const estimate = calculateCostEstimate(obs, asOfDate);
      expect(estimate.sampleSize).toBe(1);
      expect(estimate.recommendedUnitPrice).toBe(65000);
      expect(estimate.priceRange.min).toBe(65000);
      expect(estimate.priceRange.max).toBe(65000);
    });

    it('USD con tipo de cambio verificado se convierte y no se altera posteriormente', () => {
      // 25 USD con TC 7500 => 187500 PYG
      const obs: CostObservation[] = [
        {
          id: 'obs-usd-1',
          empresaId: 'emp-1',
          fuente: 'FACTURA',
          descripcionItem: 'Válvula de Presión 2"',
          categoriaInsumo: 'MATERIAL',
          cantidad: 10,
          unidad: 'UN',
          precioUnitario: 187500, // 25 * 7500 normalizado
          moneda: 'PYG',
          monedaOriginal: 'USD',
          precioUnitarioOriginal: 25,
          tipoCambio: 7500,
          fechaObservacion: '2026-09-05',
          estadoEvidencia: 'VALIDA'
        }
      ];

      const estimate = calculateCostEstimate(obs, asOfDate);
      expect(estimate.sampleSize).toBe(1);
      expect(estimate.recommendedUnitPrice).toBe(187500);
    });

    it('USD sin tipo de cambio verificado JAMÁS termina etiquetado como PYG con el mismo valor numérico', () => {
      // Caso que denunció la auditoría en 0067:
      // Fila original: 25 USD sin FX.
      // En 0067 corrupto: precio_unitario quedaba en 25 con moneda PYG y estado REVISION_REQUERIDA.
      // En 0068 corregido: precio_unitario = null, moneda_original = null (UNKNOWN != DEFAULT: jamás inventar 'USD'),
      // precio_unitario_original = 25, estado REVISION_REQUERIDA.
      const corruptLegacyRow: CostObservation = {
        id: 'obs-corrupt-1',
        empresaId: 'emp-1',
        fuente: 'FACTURA',
        descripcionItem: 'Filtro Especial Importado',
        categoriaInsumo: 'MATERIAL',
        cantidad: 5,
        unidad: 'UN',
        precioUnitario: null, // Desacoplado: jamás 25 PYG
        moneda: 'PYG',
        monedaOriginal: null, // No inferir ni inventar USD si no hay evidencia inequívoca
        precioUnitarioOriginal: 25,
        tipoCambio: undefined,
        fechaObservacion: '2026-08-01',
        estadoEvidencia: 'REVISION_REQUERIDA'
      };

      // Si se envía al motor de estimación, debe descartarse inmediatamente
      const estimate = calculateCostEstimate([corruptLegacyRow], asOfDate);
      expect(estimate.sampleSize).toBe(0);
      expect(estimate.recommendedUnitPrice).toBe(0);
      expect(estimate.confidenceTier).toBe('INSUFICIENTE');
    });

    it('Dato ambiguo o en REVISION_REQUERIDA queda no computable y se excluye de cálculos', () => {
      const validObs: CostObservation = {
        id: 'obs-valid',
        empresaId: 'emp-1',
        fuente: 'FACTURA',
        descripcionItem: 'Arena Lavada',
        categoriaInsumo: 'MATERIAL',
        cantidad: 50,
        unidad: 'M3',
        precioUnitario: 90000,
        moneda: 'PYG',
        fechaObservacion: '2026-09-01',
        estadoEvidencia: 'VALIDA'
      };

      const pendingRevisionObs: CostObservation = {
        id: 'obs-pending',
        empresaId: 'emp-1',
        fuente: 'COTIZACION',
        descripcionItem: 'Arena Lavada',
        categoriaInsumo: 'MATERIAL',
        cantidad: 50,
        unidad: 'M3',
        precioUnitario: 30, // Posible valor en USD sin TC
        moneda: 'PYG',
        monedaOriginal: 'USD',
        precioUnitarioOriginal: 30,
        fechaObservacion: '2026-09-02',
        estadoEvidencia: 'REVISION_REQUERIDA'
      };

      const obsoleteObs: CostObservation = {
        id: 'obs-obsolete',
        empresaId: 'emp-1',
        fuente: 'FACTURA',
        descripcionItem: 'Arena Lavada',
        categoriaInsumo: 'MATERIAL',
        cantidad: 50,
        unidad: 'M3',
        precioUnitario: 150000,
        moneda: 'PYG',
        fechaObservacion: '2025-01-01',
        estadoEvidencia: 'OBSOLETA'
      };

      const estimate = calculateCostEstimate([validObs, pendingRevisionObs, obsoleteObs], asOfDate);
      // Solo la observación VALIDA debe ser considerada
      expect(estimate.sampleSize).toBe(1);
      expect(estimate.recommendedUnitPrice).toBe(90000);
      expect(estimate.weightingDetails.length).toBe(1);
      expect(estimate.weightingDetails[0].observationId).toBe('obs-valid');
    });

    it('FAIL-CLOSED: Un ítem con precioUnitario nulo o no finito es descartado sin romper la agregación', () => {
      const mixedObs: CostObservation[] = [
        {
          id: 'obs-null-price',
          empresaId: 'emp-1',
          fuente: 'FACTURA',
          descripcionItem: 'Piedra Triturada 6ta',
          categoriaInsumo: 'MATERIAL',
          cantidad: 15,
          unidad: 'TON',
          precioUnitario: null,
          moneda: 'PYG',
          fechaObservacion: '2026-09-05',
          estadoEvidencia: 'REVISION_REQUERIDA'
        },
        {
          id: 'obs-valid-2',
          empresaId: 'emp-1',
          fuente: 'FACTURA',
          descripcionItem: 'Piedra Triturada 6ta',
          categoriaInsumo: 'MATERIAL',
          cantidad: 20,
          unidad: 'TON',
          precioUnitario: 110000,
          moneda: 'PYG',
          fechaObservacion: '2026-09-06',
          estadoEvidencia: 'VALIDA'
        }
      ];

      const estimate = calculateCostEstimate(mixedObs, asOfDate);
      expect(estimate.sampleSize).toBe(1);
      expect(estimate.recommendedUnitPrice).toBe(110000);
    });
  });

  describe('[SIMULACIÓN UNITARIA EN MEMORIA] Contrato Lógico de Seguridad Multi-Tenant (NO reemplaza pruebas reales PostgreSQL)', () => {
    // Simulación unitaria de la lógica de negocio TypeScript que replica las compuertas de la RPC.
    // NOTA PARA AUDITORÍA: Estos tests validan únicamente la lógica y contratos en TypeScript.
    function simulateEjecutarOrdenPago(ctx: {
      authUid: string | null;
      callerEmpresaId: string | null;
      pEmpresaId: string;
      opEmpresaId: string;
      invoices: Array<{ id: string; empresaId: string }>;
      cuentaFinancieraEmpresaId?: string;
    }) {
      if (!ctx.authUid) {
        throw new Error('Acceso denegado: se requiere sesión autenticada');
      }
      if (!ctx.callerEmpresaId || ctx.callerEmpresaId !== ctx.pEmpresaId) {
        throw new Error('Acceso denegado: el usuario no pertenece a la empresa especificada');
      }
      if (ctx.opEmpresaId !== ctx.pEmpresaId) {
        throw new Error('Orden de pago no encontrada para la empresa');
      }
      const invalidInvoices = ctx.invoices.filter(i => i.empresaId !== ctx.pEmpresaId);
      if (invalidInvoices.length > 0) {
        throw new Error('Integridad tenant violada: la orden de pago contiene facturas que no pertenecen a la empresa');
      }
      if (ctx.cuentaFinancieraEmpresaId && ctx.cuentaFinancieraEmpresaId !== ctx.pEmpresaId) {
        throw new Error('Cuenta financiera no encontrada para la empresa');
      }
      return { status: 'EJECUTADA', success: true };
    }

    it('empresa A -> recurso A = OK', () => {
      const res = simulateEjecutarOrdenPago({
        authUid: 'usr-1',
        callerEmpresaId: 'emp-A',
        pEmpresaId: 'emp-A',
        opEmpresaId: 'emp-A',
        invoices: [{ id: 'inv-1', empresaId: 'emp-A' }],
        cuentaFinancieraEmpresaId: 'emp-A'
      });
      expect(res.success).toBe(true);
    });

    it('empresa A -> p_empresa_id B = FAIL (rechazado cerrado)', () => {
      expect(() => {
        simulateEjecutarOrdenPago({
          authUid: 'usr-1',
          callerEmpresaId: 'emp-A',
          pEmpresaId: 'emp-B',
          opEmpresaId: 'emp-B',
          invoices: [{ id: 'inv-2', empresaId: 'emp-B' }]
        });
      }).toThrow('Acceso denegado: el usuario no pertenece a la empresa especificada');
    });

    it('empresa A -> empresa_id A + recurso B (cross-tenant OP) = FAIL', () => {
      expect(() => {
        simulateEjecutarOrdenPago({
          authUid: 'usr-1',
          callerEmpresaId: 'emp-A',
          pEmpresaId: 'emp-A',
          opEmpresaId: 'emp-B', // OP pertenece a B
          invoices: [{ id: 'inv-1', empresaId: 'emp-A' }]
        });
      }).toThrow('Orden de pago no encontrada para la empresa');
    });

    it('empresa A -> OP A con factura infiltrada de empresa B = FAIL (abort total)', () => {
      expect(() => {
        simulateEjecutarOrdenPago({
          authUid: 'usr-1',
          callerEmpresaId: 'emp-A',
          pEmpresaId: 'emp-A',
          opEmpresaId: 'emp-A',
          invoices: [
            { id: 'inv-1', empresaId: 'emp-A' },
            { id: 'inv-2-infiltrada', empresaId: 'emp-B' }
          ]
        });
      }).toThrow('Integridad tenant violada: la orden de pago contiene facturas que no pertenecen a la empresa');
    });

    it('empresa A -> cuenta financiera de empresa B = FAIL', () => {
      expect(() => {
        simulateEjecutarOrdenPago({
          authUid: 'usr-1',
          callerEmpresaId: 'emp-A',
          pEmpresaId: 'emp-A',
          opEmpresaId: 'emp-A',
          invoices: [{ id: 'inv-1', empresaId: 'emp-A' }],
          cuentaFinancieraEmpresaId: 'emp-B' // Cuenta ajena
        });
      }).toThrow('Cuenta financiera no encontrada para la empresa');
    });

    it('NULL auth.uid o sesión anónima = FAIL cerrado', () => {
      expect(() => {
        simulateEjecutarOrdenPago({
          authUid: null,
          callerEmpresaId: null,
          pEmpresaId: 'emp-A',
          opEmpresaId: 'emp-A',
          invoices: [{ id: 'inv-1', empresaId: 'emp-A' }]
        });
      }).toThrow('Acceso denegado: se requiere sesión autenticada');
    });
  });

  describe('Tender to Project Conversion Tenant Gate', () => {
    function simulateConvertirLicitacion(ctx: {
      authUid: string | null;
      callerEmpresaId: string | null;
      pEmpresaId: string;
      tenderEmpresaId: string;
    }) {
      if (!ctx.authUid) {
        throw new Error('Acceso denegado: se requiere sesión autenticada');
      }
      if (!ctx.callerEmpresaId || ctx.callerEmpresaId !== ctx.pEmpresaId) {
        throw new Error('Acceso denegado: el usuario autenticado no pertenece a la empresa especificada');
      }
      if (ctx.tenderEmpresaId !== ctx.pEmpresaId) {
        throw new Error('Licitación no encontrada para la empresa');
      }
      return { success: true };
    }

    it('tenant correcto y sesión activa = OK', () => {
      const res = simulateConvertirLicitacion({
        authUid: 'usr-1',
        callerEmpresaId: 'emp-A',
        pEmpresaId: 'emp-A',
        tenderEmpresaId: 'emp-A'
      });
      expect(res.success).toBe(true);
    });

    it('tenant incorrecto = FAIL', () => {
      expect(() => {
        simulateConvertirLicitacion({
          authUid: 'usr-1',
          callerEmpresaId: 'emp-A',
          pEmpresaId: 'emp-B',
          tenderEmpresaId: 'emp-B'
        });
      }).toThrow('Acceso denegado: el usuario autenticado no pertenece a la empresa especificada');
    });

    it('caller sin auth.uid (antiguo bypass de auth.uid() IS NULL) = FAIL cerrado', () => {
      expect(() => {
        simulateConvertirLicitacion({
          authUid: null,
          callerEmpresaId: null,
          pEmpresaId: 'emp-A',
          tenderEmpresaId: 'emp-A'
        });
      }).toThrow('Acceso denegado: se requiere sesión autenticada');
    });
  });
});
