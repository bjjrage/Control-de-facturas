"use client";
import { Select } from "@/components/ui/input";


import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ClimateWorkdaysPanel } from "./climate-workdays-panel";
import { isValidProjectCoords } from "@/lib/projects/location-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  Project,
  ProjectCertificate,
  ProjectWeatherLog,
  ClimateEvent,
  ProjectWorkdayStatus,
  ClimateEvidence,
  ProjectSchedulePlan,
  ProjectSchedulePlanMonth,
  WeatherCode,
} from "@/lib/types";
import {
  saveSchedulePlan,
  activateSchedulePlan,
  deleteSchedulePlan,
} from "../certificado-anexos-actions";
import { getHistoricalWeatherAction } from "../historical-weather-actions";
import type { DailyObservedWeather } from "@/lib/procurement/weather-client";

const WEATHER_LABEL: Record<WeatherCode, string> = {
  B: "Bueno / practicable",
  LL: "Lluvioso",
  HH: "Húmedo / encharcado",
  O: "Otras circunstancias",
};
const WEATHER_STYLE: Record<WeatherCode, string> = {
  B: "bg-[var(--panel-2)] text-[var(--muted)]",
  LL: "bg-[var(--primary)]/15 text-[#b5d1ff] ring-1 ring-[var(--primary)]/30",
  HH: "bg-[var(--warn-bg)]/55 text-[#fff8e8] ring-1 ring-[var(--warn)]/20",
  O: "bg-[var(--hover)] text-[var(--foreground)]",
};
const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// One "programado" line per schedule version (Original, Adenda 1, …) plus
// the single "ejecutado" line — plotted together, the same way the source
// spreadsheet's own Curva S chart overlays every version against lo
// ejecutado instead of showing one version at a time.
function buildMultiSeries(
  certificates: ProjectCertificate[],
  schedulePlans: ProjectSchedulePlan[],
  planMonths: Record<string, ProjectSchedulePlanMonth[]>,
  nMonths: number,
  contractAmount: number
): Array<{ mes: string; ejecutado: number | null } & Record<string, number | null | string>> {
  const frozenCerts = certificates
    .filter((c) => ["ELABORADO", "VERIFICADO", "APROBADO", "FACTURADO"].includes(c.status))
    .slice()
    .sort((a, b) => a.numero - b.numero);

  const progByPlan = new Map<string, Map<number, number>>();
  const docExecByPlan = new Map<string, Map<number, number>>();
  for (const plan of schedulePlans) {
    const byMonth = new Map<number, number>();
    const docByMonth = new Map<number, number>();
    for (const row of planMonths[plan.id] ?? []) {
      byMonth.set(row.month_index, row.programado_pct);
      if (row.ejecutado_pct_documento != null) docByMonth.set(row.month_index, row.ejecutado_pct_documento);
    }
    progByPlan.set(plan.id, byMonth);
    docExecByPlan.set(plan.id, docByMonth);
  }
  const accByPlan = new Map<string, number>(schedulePlans.map((plan) => [plan.id, 0]));
  const docAccByPlan = new Map<string, number>(schedulePlans.map((plan) => [plan.id, 0]));

  let ejecAcc = 0;
  const rows: Array<{ mes: string; ejecutado: number | null } & Record<string, number | null | string>> = [];
  for (let i = 1; i <= nMonths; i++) {
    const row: { mes: string; ejecutado: number | null } & Record<string, number | null | string> = { mes: `M${i}`, ejecutado: null };
    for (const plan of schedulePlans) {
      const acc = (accByPlan.get(plan.id) ?? 0) + (progByPlan.get(plan.id)?.get(i) ?? 0);
      accByPlan.set(plan.id, acc);
      row[plan.id] = Number(acc.toFixed(2));
      // Ejecutado según el documento: solo se dibuja para los meses que el
      // documento realmente traía (evita una línea plana antes/después de
      // ese rango).
      if (docExecByPlan.get(plan.id)?.has(i)) {
        const docAcc = (docAccByPlan.get(plan.id) ?? 0) + (docExecByPlan.get(plan.id)?.get(i) ?? 0);
        docAccByPlan.set(plan.id, docAcc);
        row[`${plan.id}__doc`] = Number(docAcc.toFixed(2));
      } else {
        row[`${plan.id}__doc`] = null;
      }
    }
    const cert = frozenCerts[i - 1];
    if (cert && contractAmount > 0) {
      ejecAcc += (cert.monto_presente / contractAmount) * 100;
      row.ejecutado = Number(ejecAcc.toFixed(2));
    } else if (frozenCerts.length >= i) {
      row.ejecutado = Number(ejecAcc.toFixed(2));
    }
    rows.push(row);
  }
  return rows;
}

const PLAN_LINE_COLORS = ["#8a8278", "#22c55e", "#eab308", "#f97316", "#a855f7", "#06b6d4"];

function monthSpan(project: Project): { year: number; month: number }[] {
  const startStr = project.orden_inicio_date ?? project.start_date;
  const start = startStr ? new Date(`${startStr}T00:00:00`) : new Date();
  const months = Math.max(1, Math.min(24, Math.ceil((project.plazo_dias ?? 150) / 30) + 1));
  const out: { year: number; month: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  return out;
}

function localDateIso(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function AvanceFisicoPanel({
  project,
  certificates,
  weatherLogs,
  climateEvents,
  climateWorkdays,
  climateEvidence,
  schedulePlans,
  planMonths,
}: {
  project: Project;
  certificates: ProjectCertificate[];
  weatherLogs: ProjectWeatherLog[];
  climateEvents: ClimateEvent[];
  climateWorkdays: ProjectWorkdayStatus[];
  climateEvidence: ClimateEvidence[];
  schedulePlans: ProjectSchedulePlan[];
  planMonths: Record<string, ProjectSchedulePlanMonth[]>;
}) {
  return (
    <div className="space-y-6">
      <CurvaAvance
        project={project}
        certificates={certificates}
        schedulePlans={schedulePlans}
        planMonths={planMonths}
      />
      <div className="space-y-3">
        <ClimateWorkdaysPanel
          project={project}
          events={climateEvents}
          workdays={climateWorkdays}
          evidence={climateEvidence}
          historicalOnly
        />
        <DiasNoTrabajados project={project} weatherLogs={weatherLogs} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Curva de avance
// ---------------------------------------------------------------------------

function CurvaAvance({
  project,
  certificates,
  schedulePlans,
  planMonths,
}: {
  project: Project;
  certificates: ProjectCertificate[];
  schedulePlans: ProjectSchedulePlan[];
  planMonths: Record<string, ProjectSchedulePlanMonth[]>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const activePlan = schedulePlans.find((p) => p.is_active) ?? null;
  const nMonths = Math.max(
    project.plazo_dias ? Math.ceil(project.plazo_dias / 30) : 6,
    certificates.length,
    ...schedulePlans.map((plan) => (planMonths[plan.id] ?? []).reduce((mx, m) => Math.max(mx, m.month_index), 0)),
    1
  );

  const series = buildMultiSeries(certificates, schedulePlans, planMonths, nMonths, project.contract_amount);

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-semibold">Curva de avance financiero</div>
        <div className="flex items-center gap-2">
          {schedulePlans.length > 0 ? (
            <Select
              className="h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[12px]"
              value={activePlan?.id ?? ""}
              onChange={(e) => run(() => activateSchedulePlan(e.target.value))}
              disabled={pending}
            >
              {schedulePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.is_active ? " (activa)" : ""}
                </option>
              ))}
            </Select>
          ) : null}
          <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cerrar" : activePlan ? "Editar cronograma" : "Cargar cronograma"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}

      {!schedulePlans.length && !editing ? (
        <p className="text-[12px] text-[var(--muted)]">
          Cargá el cronograma físico-financiero (% del contrato previsto por mes) para ver la curva. Cada
          adenda es una versión nueva; la desviación se mide contra la versión activa.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={series} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="mes" tick={{ fontSize: 11 }} stroke="var(--muted)" />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="var(--muted)"
              width={44}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v) => (v == null ? "—" : `${Number(v).toFixed(2)}%`)}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {schedulePlans.map((plan, index) => (
              <Line
                key={plan.id}
                type="monotone"
                dataKey={plan.id}
                name={`Programado acum. (${plan.label})`}
                stroke={PLAN_LINE_COLORS[index % PLAN_LINE_COLORS.length]}
                strokeDasharray="5 4"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
            {schedulePlans
              .filter((plan) => series.some((row) => row[`${plan.id}__doc`] != null))
              .map((plan, index) => (
                <Line
                  key={`${plan.id}__doc`}
                  type="monotone"
                  dataKey={`${plan.id}__doc`}
                  name={`Ejecutado acum. según documento (${plan.label})`}
                  stroke={PLAN_LINE_COLORS[index % PLAN_LINE_COLORS.length]}
                  strokeWidth={2}
                  strokeOpacity={0.6}
                  dot={false}
                  connectNulls
                />
              ))}
            <Line
              type="monotone"
              dataKey="ejecutado"
              name="Ejecutado acum."
              stroke="#1d4ed8"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {editing ? (
        <SchedulePlanEditor
          projectId={project.id}
          plan={activePlan}
          months={activePlan ? planMonths[activePlan.id] ?? [] : []}
          defaultMonths={nMonths}
          pending={pending}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
          onError={setError}
          onDeletePlan={activePlan ? () => run(() => deleteSchedulePlan(activePlan.id)) : undefined}
        />
      ) : null}
    </div>
  );
}

function SchedulePlanEditor({
  projectId,
  plan,
  months,
  defaultMonths,
  pending,
  onSaved,
  onError,
  onDeletePlan,
}: {
  projectId: string;
  plan: ProjectSchedulePlan | null;
  months: ProjectSchedulePlanMonth[];
  defaultMonths: number;
  pending: boolean;
  onSaved: () => void;
  onError: (msg: string) => void;
  onDeletePlan?: () => void;
}) {
  const [asNew, setAsNew] = useState(false);
  const [label, setLabel] = useState(plan?.label ?? "Original");
  const initial = useMemo(() => {
    const m = new Map<number, number>();
    for (const row of months) m.set(row.month_index, row.programado_pct);
    return Array.from({ length: Math.max(defaultMonths, months.length, 1) }, (_, i) => m.get(i + 1) ?? 0);
  }, [months, defaultMonths]);
  const [values, setValues] = useState<number[]>(initial);
  const [saving, setSaving] = useState(false);

  const total = values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);

  async function save() {
    setSaving(true);
    const res = await saveSchedulePlan(projectId, {
      planId: asNew ? null : plan?.id ?? null,
      label,
      months: values.map((v, i) => ({ month_index: i + 1, programado_pct: v })),
    });
    setSaving(false);
    if (res.error) onError(res.error);
    else onSaved();
  }

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] text-[var(--muted)]">Nombre de la versión</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 w-40" />
        </div>
        {plan ? (
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
            <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} />
            Guardar como versión nueva (adenda)
          </label>
        ) : null}
        <div className="ml-auto text-[12px] text-[var(--muted)]">
          Suma: <span className={total > 100.5 ? "text-[var(--error)]" : ""}>{total.toFixed(1)}%</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {values.map((v, i) => (
          <div key={i}>
            <label className="text-[10px] text-[var(--muted)]">Mes {i + 1}</label>
            <input
              type="number"
              step="any"
              min="0"
              value={v}
              onChange={(e) => {
                const next = [...values];
                next[i] = Number(e.target.value);
                setValues(next);
              }}
              className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1.5 py-0.5 text-right text-[12px]"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setValues([...values, 0])}
          className="self-end rounded border border-dashed border-[var(--border)] px-2 py-1 text-[12px] text-[var(--muted)]"
        >
          + mes
        </button>
      </div>

      <div className="flex items-center justify-between">
        {onDeletePlan && !asNew ? (
          <Button variant="ghost" disabled={pending || saving} onClick={onDeletePlan}>
            Eliminar versión
          </Button>
        ) : (
          <span />
        )}
        <Button disabled={saving} onClick={save}>
          {saving ? "Guardando…" : "Guardar cronograma"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Días no trabajados
// ---------------------------------------------------------------------------

function DiasNoTrabajados({
  project,
  weatherLogs,
}: {
  project: Project;
  weatherLogs: ProjectWeatherLog[];
}) {
  const [histByMonth, setHistByMonth] = useState<
    Record<
      string,
      {
        days: Record<string, DailyObservedWeather>;
        sources: string[];
        loading: boolean;
        error: string | null;
      }
    >
  >({});
  const byDate = useMemo(() => {
    const m = new Map<string, WeatherCode>();
    for (const w of weatherLogs) m.set(w.log_date, w.code);
    return m;
  }, [weatherLogs]);

  const today = localDateIso();
  const months = useMemo(() => monthSpan(project), [project]);

  function monthKey(year: number, month: number): string {
    return `${year}-${String(month + 1).padStart(2, "0")}`;
  }

  function monthRange(year: number, month: number): { start: string; end: string } {
    const last = new Date(year, month + 1, 0).getDate();
    const mm = String(month + 1).padStart(2, "0");
    const monthEnd = `${year}-${mm}-${String(last).padStart(2, "0")}`;
    return { start: `${year}-${mm}-01`, end: monthEnd > today ? today : monthEnd };
  }

  // UNA sola consulta por rango mensual (nunca una request por día).
  async function loadHistMonth(year: number, month: number) {
    const key = monthKey(year, month);
    const cur = histByMonth[key];
    if (cur && (cur.loading || Object.keys(cur.days).length > 0 || cur.error)) return;
    const { start, end } = monthRange(year, month);
    if (start > today) return;
    setHistByMonth((prev) => ({
      ...prev,
      [key]: { days: {}, sources: [], loading: true, error: null },
    }));
    const res = await getHistoricalWeatherAction({ projectId: project.id, startDate: start, endDate: end });
    if (res.error || !res.data) {
      setHistByMonth((prev) => ({
        ...prev,
        [key]: { days: {}, sources: [], loading: false, error: res.error || "Datos meteorológicos no disponibles." },
      }));
      return;
    }
    const days: Record<string, DailyObservedWeather> = {};
    for (const d of res.data.days) days[d.date] = d;
    setHistByMonth((prev) => ({
      ...prev,
      [key]: { days, sources: res.data?.sources ?? [], loading: false, error: null },
    }));
  }

  function fmtMm(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return "—";
    return Number(v).toLocaleString("es-PY", { maximumFractionDigits: 1 });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold">HISTÓRICO LEGACY — SOLO LECTURA</div>
          <p className="text-[11px] text-[var(--muted)]">
            Datos conservados de <code>project_weather_log</code>. No representan el registro contractual vigente;
            las propuestas y decisiones se consultan en Jornadas climaticas.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">LEGACY - {weatherLogs.length} registros</span>
      </div>
      <div className="erp-surface-strong p-3 text-[12px] text-[var(--muted)] space-y-1">
        <p>Open-Meteo aporta clima observado como evidencia de apoyo. No crea ni confirma jornadas contractuales.</p>
        {!isValidProjectCoords(project.latitude, project.longitude) ? <p>La consulta de evidencia requiere latitud y longitud configuradas. La evaluacion DMH/DINAC tambien necesita ambas coordenadas.</p> : null}
      </div>
      <div className="space-y-3 overflow-x-auto" data-testid="legacy-project-weather-log">
        {months.map(({ year, month }) => {
          const days = new Date(year, month + 1, 0).getDate();
          const key = monthKey(year, month);
          const hist = histByMonth[key];
          const obsDays = hist ? Object.values(hist.days) : [];
          const rainyDays = obsDays.filter((o) => Number(o.precipitation_mm) > 0);
          const totalMm = rainyDays.reduce((s, o) => s + (Number(o.precipitation_mm) || 0), 0);
          const mm = String(month + 1).padStart(2, "0");
          const isFutureMonth = `${year}-${mm}-01` > today;
          let legacyRowsInMonth = 0;
          for (const [dateStr] of byDate) {
            if (dateStr.startsWith(`${year}-${mm}-`)) legacyRowsInMonth++;
          }
          return (
            <div key={`${year}-${month}`} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-28 shrink-0 text-[12px] text-[var(--muted)]">
                  {MONTHS_ES[month]} {year}
                </div>
                {!isFutureMonth && (!hist || (!hist.loading && Object.keys(hist.days).length === 0 && !hist.error)) ? (
                  <Button variant="secondary" size="sm"
                    type="button"
                    onClick={() => loadHistMonth(year, month)}
                    disabled={hist?.loading || !isValidProjectCoords(project.latitude,project.longitude)}
                    data-testid={`ver-clima-${year}-${mm}`}

                    title="Cargar clima observado de este mes (una sola consulta por rango)"
                  >
                    {hist?.loading ? "Cargando clima…" : "Ver clima observado"}
                  </Button>
                ) : null}
                {hist?.loading ? (
                  <span className="text-[11px] text-[var(--muted)]">Cargando clima observado…</span>
                ) : null}
                {hist?.error ? (
                  <span className="text-[11px] text-[var(--muted)]">
                    {hist.error.includes("ubicación geográfica") ? hist.error : "Datos meteorológicos no disponibles."}
                  </span>
                ) : null}
                {hist && !hist.loading && !hist.error && Object.keys(hist.days).length > 0 ? (
                  <span className="text-[11px] text-[var(--muted)]" data-testid={`resumen-clima-${year}-${mm}`}>
                    Evidencia Open-Meteo (solo apoyo) · {MONTHS_ES[month]}: {rainyDays.length}{" "}
                    {rainyDays.length === 1 ? "día con precipitación" : "días con precipitación"},{" "}
                    {fmtMm(totalMm)} mm acumulados · {legacyRowsInMonth} {legacyRowsInMonth === 1 ? "fila legacy" : "filas legacy"}
                    {hist.sources.length > 0 ? ` · Fuente: ${hist.sources.join(" + ")}` : ""}
                  </span>
                ) : null}
              </div>
              <div className="flex items-start gap-1">
                <div className="w-28 shrink-0" />
                <div className="flex gap-0.5">
                  {Array.from({ length: days }, (_, d) => {
                    const dd = String(d + 1).padStart(2, "0");
                    const dateStr = `${year}-${mm}-${dd}`;
                    const code = byDate.get(dateStr);
                    const obs = hist?.days[dateStr];
                    const mmVal = obs ? Number(obs.precipitation_mm) || 0 : null;
                    const rainy = mmVal !== null && mmVal > 0;
                    const obsLabel = obs
                      ? `Clima observado: ${fmtMm(mmVal)} mm de precipitación. Fuente: ${obs.source}`
                      : null;
                    const regLabel = code ? `Registro legacy de solo lectura: ${WEATHER_LABEL[code]} (${code})` : "Sin fila legacy";
                    return (
                      <div key={dateStr} className="flex flex-col items-center w-8 shrink-0">
                        <span
                          title={`${dateStr} - Solo lectura - ${regLabel}${obsLabel ? `\n${obsLabel}` : ""}`}
                          className={`inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-medium ${
                            code ? WEATHER_STYLE[code] : "bg-[var(--panel-2)] text-[var(--muted)]/40"
                          }`}
                        >
                          {code ?? d + 1}
                        </span>
                        {mmVal !== null ? (
                          <span
                            className={`text-[9px] leading-tight ${rainy ? "text-[#b5d1ff]" : "text-[var(--muted)]/50"}`}
                            title={obsLabel ?? undefined}
                          >
                            {rainy ? `🌧 ${fmtMm(mmVal)}` : "0 mm"}
                          </span>
                        ) : null}

                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
