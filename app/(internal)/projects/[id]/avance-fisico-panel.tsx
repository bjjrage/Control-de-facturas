"use client";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  Project,
  ProjectCertificate,
  ProjectWeatherLog,
  ProjectSchedulePlan,
  ProjectSchedulePlanMonth,
  WeatherCode,
} from "@/lib/types";
import {
  setWeatherDay,
  saveSchedulePlan,
  activateSchedulePlan,
  deleteSchedulePlan,
} from "../certificado-anexos-actions";
import { getHistoricalWeatherAction } from "../historical-weather-actions";
import type { DailyObservedWeather } from "@/lib/procurement/weather-client";
import { WeeklyPlanSection } from "./weekly-plan-section";

const WEATHER_CYCLE: (WeatherCode | null)[] = [null, "B", "LL", "HH", "O"];
const WEATHER_LABEL: Record<WeatherCode, string> = {
  B: "Bueno / practicable",
  LL: "Lluvioso",
  HH: "Húmedo / encharcado",
  O: "Otras circunstancias",
};
const WEATHER_STYLE: Record<WeatherCode, string> = {
  B: "bg-[var(--panel-2)] text-[var(--muted)]",
  LL: "bg-blue-500/25 text-blue-700 dark:text-blue-300",
  HH: "bg-[var(--warn-bg)]/55 text-[#fff8e8] ring-1 ring-[var(--warn)]/20",
  O: "bg-[var(--hover)] text-[var(--foreground)]",
};
const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function buildSeries(
  certificates: ProjectCertificate[],
  planMonths: ProjectSchedulePlanMonth[],
  nMonths: number,
  contractAmount: number,
  hasPlan: boolean
): { mes: string; programado: number | null; ejecutado: number | null }[] {
  const frozenCerts = certificates
    .filter((c) => ["ELABORADO", "VERIFICADO", "APROBADO", "FACTURADO"].includes(c.status))
    .slice()
    .sort((a, b) => a.numero - b.numero);

  const progByMonth = new Map<number, number>();
  for (const m of planMonths) progByMonth.set(m.month_index, m.programado_pct);

  let progAcc = 0;
  let ejecAcc = 0;
  const rows: { mes: string; programado: number | null; ejecutado: number | null }[] = [];
  for (let i = 1; i <= nMonths; i++) {
    progAcc += progByMonth.get(i) ?? 0;
    const cert = frozenCerts[i - 1];
    let ejec: number | null = null;
    if (cert && contractAmount > 0) {
      ejecAcc += (cert.monto_presente / contractAmount) * 100;
      ejec = Number(ejecAcc.toFixed(2));
    } else if (frozenCerts.length >= i) {
      ejec = Number(ejecAcc.toFixed(2));
    }
    rows.push({
      mes: `M${i}`,
      programado: hasPlan ? Number(progAcc.toFixed(2)) : null,
      ejecutado: ejec,
    });
  }
  return rows;
}

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

export function AvanceFisicoPanel({
  project,
  certificates,
  weatherLogs,
  schedulePlans,
  planMonths,
}: {
  project: Project;
  certificates: ProjectCertificate[];
  weatherLogs: ProjectWeatherLog[];
  schedulePlans: ProjectSchedulePlan[];
  planMonths: Record<string, ProjectSchedulePlanMonth[]>;
}) {
  return (
    <div className="space-y-6">
      <WeeklyPlanSection project={project} />
      <CurvaAvance
        project={project}
        certificates={certificates}
        schedulePlans={schedulePlans}
        planMonths={planMonths}
      />
      <DiasNoTrabajados project={project} weatherLogs={weatherLogs} />
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
  const activePlanMonths = activePlan ? planMonths[activePlan.id] ?? [] : [];
  const nMonths = Math.max(
    project.plazo_dias ? Math.ceil(project.plazo_dias / 30) : 6,
    certificates.length,
    activePlanMonths.reduce((mx, m) => Math.max(mx, m.month_index), 0),
    1
  );

  const series = buildSeries(certificates, activePlanMonths, nMonths, project.contract_amount, !!activePlan);

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
            <select
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
            </select>
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

      {!activePlan && !editing ? (
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
            <Line
              type="monotone"
              dataKey="programado"
              name="Programado acum."
              stroke="#8a8278"
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: string | null; success: string | null }>({
    error: null,
    success: null,
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDate, setEditorDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [editorCode, setEditorCode] = useState<string>("LL");
  // Evidencia meteorológica HISTÓRICA observada (solo lectura, por mes).
  // El clima NUNCA escribe el Libro solo: solo setWeatherDay con acción
  // explícita del usuario (ciclo de día, editor o "Usar como Lluvioso").
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

  const months = useMemo(() => monthSpan(project), [project]);

  const counts = useMemo(() => {
    let b = 0, ll = 0, hh = 0, o = 0;
    for (const w of weatherLogs) {
      if (w.code === "B") b++;
      else if (w.code === "LL") ll++;
      else if (w.code === "HH") hh++;
      else if (w.code === "O") o++;
    }
    return { b, ll, hh, o, total: ll + hh + o };
  }, [weatherLogs]);

  async function persist(dateStr: string, code: WeatherCode | null) {
    if (busy) return;
    setBusy(true);
    setFeedback({ error: null, success: null });
    const res = await setWeatherDay(project.id, dateStr, code);
    setBusy(false);
    if (res.error) {
      setFeedback({ error: res.error, success: null });
      return;
    }
    setFeedback({
      error: null,
      success:
        code === null
          ? `Registro de ${dateStr} eliminado.`
          : `${dateStr} registrado como ${WEATHER_LABEL[code]}.`,
    });
    router.refresh();
  }

  async function cycle(dateStr: string) {
    const current = byDate.get(dateStr) ?? null;
    const idx = WEATHER_CYCLE.indexOf(current);
    const next = WEATHER_CYCLE[(idx + 1) % WEATHER_CYCLE.length];
    await persist(dateStr, next);
    // Sincroniza editor si está abierto
    setEditorDate(dateStr);
    if (next) setEditorCode(next);
  }

  async function saveFromEditor() {
    if (!editorDate) {
      setFeedback({ error: "Elegí una fecha válida.", success: null });
      return;
    }
    if (editorCode === "__CLEAR__") {
      await persist(editorDate, null);
    } else {
      await persist(editorDate, editorCode as WeatherCode);
    }
  }

  function monthKey(year: number, month: number): string {
    return `${year}-${String(month + 1).padStart(2, "0")}`;
  }

  function monthRange(year: number, month: number): { start: string; end: string } {
    const last = new Date(year, month + 1, 0).getDate();
    const mm = String(month + 1).padStart(2, "0");
    return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, "0")}` };
  }

  // UNA sola consulta por rango mensual (nunca una request por día).
  async function loadHistMonth(year: number, month: number) {
    const key = monthKey(year, month);
    const cur = histByMonth[key];
    if (cur && (cur.loading || Object.keys(cur.days).length > 0 || cur.error)) return;
    const { start, end } = monthRange(year, month);
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
          <div className="text-[13px] font-semibold">Días no trabajados (Libro de Obra) — registro histórico</div>
          <p className="text-[11px] text-[var(--muted)]">
            Lo que realmente ocurrió (contractual). No es pronóstico futuro — el clima futuro se ve en
            Plan Semanal → Clima ON. Podés cargar el clima <em>observado</em> por mes como evidencia:
            el dato meteorológico no decide por vos, el registro en el Libro siempre es humano.
          </p>
        </div>
        <div className="flex gap-3 text-[12px]">
          <span>
            Lluvia <strong>{counts.ll}</strong>
          </span>
          <span>
            Húmedos <strong>{counts.hh}</strong>
          </span>
          <span>
            Otros <strong>{counts.o}</strong>
          </span>
          <span className="text-[var(--muted)]">
            Total no trabajados <strong className="text-[var(--foreground)]">{counts.total}</strong>
            {project.plazo_dias ? ` / plazo ${project.plazo_dias} d` : ""}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => setEditorOpen((v) => !v)}
          className="h-8 text-xs"
        >
          {editorOpen ? "Cerrar editor" : "Registrar día"}
        </Button>
        <div className="flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
          <LegendChip code="B" />
          <LegendChip code="LL" />
          <LegendChip code="HH" />
          <LegendChip code="O" />
          <span className="ml-1">— clic en un día para avanzar B → LL → HH → O → vacío</span>
        </div>
      </div>

      {editorOpen ? (
        <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] text-[var(--muted)]">Fecha</label>
            <Input
              type="date"
              value={editorDate}
              onChange={(e) => setEditorDate(e.target.value)}
              className="h-8 w-40"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--muted)]">Estado</label>
            <select
              value={editorCode}
              onChange={(e) => setEditorCode(e.target.value)}
              className="h-8 rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[12px]"
            >
              <option value="B">Bueno / practicable (B)</option>
              <option value="LL">Lluvioso (LL)</option>
              <option value="HH">Húmedo / encharcado (HH)</option>
              <option value="O">Otra circunstancia (O)</option>
              <option value="__CLEAR__">Limpiar registro (borrar)</option>
            </select>
          </div>
          <Button disabled={busy} onClick={saveFromEditor} className="h-8 text-xs">
            {busy ? "Guardando…" : "Guardar día"}
          </Button>
          <span className="text-[11px] text-[var(--muted)]">
            {editorDate && byDate.get(editorDate)
              ? `Actual: ${WEATHER_LABEL[byDate.get(editorDate)!]}`
              : "Sin registro en esa fecha"}
          </span>
        </div>
      ) : null}

      {feedback.error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {feedback.error}
        </div>
      ) : null}
      {feedback.success ? (
        <div className="semantic-success rounded px-2.5 py-1.5 text-[12px]">
          {feedback.success}
        </div>
      ) : null}

      <div className="space-y-3 overflow-x-auto" data-testid="libro-calendario">
        {months.map(({ year, month }) => {
          const days = new Date(year, month + 1, 0).getDate();
          const key = monthKey(year, month);
          const hist = histByMonth[key];
          const obsDays = hist ? Object.values(hist.days) : [];
          const rainyDays = obsDays.filter((o) => Number(o.precipitation_mm) > 0);
          const totalMm = rainyDays.reduce((s, o) => s + (Number(o.precipitation_mm) || 0), 0);
          const mm = String(month + 1).padStart(2, "0");
          let llInMonth = 0;
          for (const [dateStr, code] of byDate) {
            if (code === "LL" && dateStr.startsWith(`${year}-${mm}-`)) llInMonth++;
          }
          return (
            <div key={`${year}-${month}`} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-28 shrink-0 text-[12px] text-[var(--muted)]">
                  {MONTHS_ES[month]} {year}
                </div>
                {!hist || (!hist.loading && Object.keys(hist.days).length === 0 && !hist.error) ? (
                  <button
                    type="button"
                    onClick={() => loadHistMonth(year, month)}
                    disabled={busy || hist?.loading}
                    data-testid={`ver-clima-${year}-${mm}`}
                    className="h-6 px-2 rounded-md border border-[var(--border)] text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--panel-2)]"
                    title="Cargar clima observado de este mes (una sola consulta por rango)"
                  >
                    {hist?.loading ? "Cargando clima…" : "Ver clima observado"}
                  </button>
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
                    Clima observado · {MONTHS_ES[month]}: {rainyDays.length}{" "}
                    {rainyDays.length === 1 ? "día con precipitación" : "días con precipitación"},{" "}
                    {fmtMm(totalMm)} mm acumulados | Libro: {llInMonth} {llInMonth === 1 ? "día LL" : "días LL"}
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
                    const regLabel = code ? `Registro de obra: ${WEATHER_LABEL[code]} (${code})` : "Registro de obra: sin registro";
                    return (
                      <div key={dateStr} className="flex flex-col items-center w-8 shrink-0">
                        <button
                          type="button"
                          onClick={() => cycle(dateStr)}
                          disabled={busy}
                          title={`${dateStr}${code ? ` · ${WEATHER_LABEL[code]} (clic para cambiar)` : " · sin registro (clic para B)"}${obsLabel ? `\n${obsLabel}` : ""}\n${regLabel}`}
                          className={`h-6 w-6 rounded text-[10px] font-medium ${
                            code ? WEATHER_STYLE[code] : "bg-[var(--panel-2)] text-[var(--muted)]/40"
                          }`}
                        >
                          {code ?? d + 1}
                        </button>
                        {mmVal !== null ? (
                          <span
                            className={`text-[9px] leading-tight ${rainy ? "text-blue-600 dark:text-blue-300" : "text-[var(--muted)]/50"}`}
                            title={obsLabel ?? undefined}
                          >
                            {rainy ? `🌧 ${fmtMm(mmVal)}` : "0 mm"}
                          </span>
                        ) : null}
                        {rainy && code !== "LL" ? (
                          <button
                            type="button"
                            onClick={() => persist(dateStr, "LL")}
                            disabled={busy}
                            data-testid={`usar-como-ll-${dateStr}`}
                            title={`Usar como Lluvioso (LL) — registra ${dateStr} en el Libro de Obra (acción explícita)`}
                            className="mt-0.5 rounded border border-blue-500/40 px-1 text-[9px] font-semibold text-blue-600 dark:text-blue-300 hover:bg-blue-500/10"
                          >
                            LL
                          </button>
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

function LegendChip({ code }: { code: WeatherCode }) {
  return (
    <span className={`rounded px-1.5 py-0.5 ${WEATHER_STYLE[code]}`}>
      {code} · {WEATHER_LABEL[code]}
    </span>
  );
}
