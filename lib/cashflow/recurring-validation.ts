import { dateOnly } from "./dates";
import { currency } from "./model";
export function validateRecurringExpense(data: {
    descripcion: string;
    monto_estimado: number;
    moneda: string;
    periodicidad: string;
    categoria: string;
    dia_del_mes?: number | null;
    proximo_vencimiento?: string | null;
}): string | null {
    if (!data.descripcion?.trim())
        return "La descripción no puede estar vacía";
    if (!Number.isFinite(data.monto_estimado) || data.monto_estimado <= 0 || data.monto_estimado >= 1e16)
        return "Monto recurrente inválido";
    if (!["MENSUAL", "BIMESTRAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"].includes(data.periodicidad))
        return "Periodicidad inválida";
    if (!["ALQUILER", "SUELDOS", "SEGUROS", "PRESTAMO", "SERVICIOS", "IMPUESTOS", "HONORARIOS", "OTRO"].includes(data.categoria))
        return "Categoría inválida";
    if (data.dia_del_mes != null && (!Number.isInteger(data.dia_del_mes) || data.dia_del_mes < 1 || data.dia_del_mes > 31))
        return "Día recurrente inválido";
    try {
        currency(data.moneda);
        if (data.proximo_vencimiento)
            dateOnly(data.proximo_vencimiento);
    }
    catch {
        return "Moneda o fecha inválida";
    }
    return null;
}
