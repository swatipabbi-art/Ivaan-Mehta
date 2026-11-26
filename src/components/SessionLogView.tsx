import { Camera, Download, Trash2, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { WorkoutSessionRecord } from '../types/exercise';

interface SessionLogViewProps {
  sessions: WorkoutSessionRecord[];
  onClearSessions: () => void;
  onStartWorkout: () => void;
}

const SERIES_COLORS = [
  '#2563EB', // Blue
  '#059669', // Emerald
  '#D97706', // Amber
  '#7C3AED', // Violet
  '#E11D48', // Rose
  '#0891B2', // Cyan
  '#4F46E5', // Indigo
  '#EA580C', // Orange
  '#0D9488', // Teal
  '#475569', // Slate
];

interface ChartPoint {
  key: string;
  timeLabel: string;
  fullDate: string;
  exerciseName: string;
  volumeLabel: string;
  score: number;
  [seriesKey: string]: string | number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    payload?: ChartPoint;
  }>;
}

function TrendTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm text-xs">
      <div className="font-semibold text-slate-900">{point.exerciseName}</div>
      <div className="text-slate-500 mt-0.5 tabular-nums">{point.fullDate}</div>
      <div className="mt-2 flex items-center justify-between gap-4 border-t border-slate-100 pt-1.5">
        <span className="text-slate-600">{point.volumeLabel}</span>
        <span className="font-mono font-bold text-slate-900 tabular-nums">
          {point.score}% accuracy
        </span>
      </div>
    </div>
  );
}

export function SessionLogView({
  sessions,
  onClearSessions,
  onStartWorkout,
}: SessionLogViewProps) {
  const [selectedExercise, setSelectedExercise] = useState<string>('ALL');

  const exerciseNames = useMemo(() => {
    const names = Array.from(new Set(sessions.map((s) => s.exerciseName)));
    return names.sort((a, b) => a.localeCompare(b));
  }, [sessions]);

  const activeFilter =
    selectedExercise !== 'ALL' && !exerciseNames.includes(selectedExercise)
      ? 'ALL'
      : selectedExercise;

  const filteredSessions = useMemo(() => {
    if (activeFilter === 'ALL') return sessions;
    return sessions.filter((s) => s.exerciseName === activeFilter);
  }, [sessions, activeFilter]);

  const totalReps = filteredSessions.reduce((acc, s) => acc + s.reps, 0);
  const totalHoldSeconds = filteredSessions.reduce(
    (acc, s) => acc + s.holdSeconds,
    0
  );
  const avgScore =
    filteredSessions.length > 0
      ? Math.round(
          filteredSessions.reduce((acc, s) => acc + s.avgFormScore, 0) /
            filteredSessions.length
        )
      : 0;

  // Build chronological points for Recharts LineChart (oldest -> newest)
  const { chartData, visibleExercises } = useMemo(() => {
    const chronological = [...filteredSessions].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    const seriesSet = Array.from(
      new Set(chronological.map((s) => s.exerciseName))
    );

    const data: ChartPoint[] = chronological.map((s, idx) => {
      const d = new Date(s.timestamp);
      const timeLabel = d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      const fullDate = d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const volumeLabel =
        s.holdSeconds > 0
          ? `${s.holdSeconds.toFixed(1)}s hold`
          : `${s.reps} reps`;

      return {
        key: `${s.id}-${idx}`,
        timeLabel: `${timeLabel} #${idx + 1}`,
        fullDate,
        exerciseName: s.exerciseName,
        volumeLabel,
        score: s.avgFormScore,
        [s.exerciseName]: s.avgFormScore,
      };
    });

    return { chartData: data, visibleExercises: seriesSet };
  }, [filteredSessions]);

  const handleExportCsv = () => {
    const header = [
      'Date',
      'Exercise',
      'Reps',
      'HoldSeconds',
      'AvgFormScore',
      'Strictness',
      'Notes',
    ].join(',');
    const rows = filteredSessions.map((s) =>
      [
        new Date(s.timestamp).toISOString(),
        `"${s.exerciseName}"`,
        s.reps,
        s.holdSeconds.toFixed(1),
        s.avgFormScore,
        s.strictness,
        `"${s.topIssues.join('; ')}"`,
      ].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `formlab-session-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-7">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">
            Session Log
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Completed sets saved from your camera or video form checks, stored locally in this browser.
          </p>
        </div>

        {sessions.length > 0 && (
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={onClearSessions}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Clear Log</span>
            </button>
          </div>
        )}
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Logged Sets</div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {filteredSessions.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Total Valid Reps</div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {totalReps}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Clean Hold Time</div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {totalHoldSeconds.toFixed(1)}s
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Average Accuracy</div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {filteredSessions.length > 0 ? `${avgScore}%` : '—'}
          </div>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
            <Camera className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="max-w-md">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              No completed sets recorded yet
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Start a camera or video check in Live Coach, complete a few reps or a plank hold, and click Save Completed Set to visualize your accuracy trend over time.
            </p>
          </div>
          <button
            type="button"
            onClick={onStartWorkout}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            <span>Go to Live Coach</span>
          </button>
        </div>
      ) : (
        <>
          {/* Form Accuracy Trend Line Chart */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Accuracy Progression</span>
                </div>
                <h2 className="mt-0.5 font-display text-lg font-bold text-slate-900">
                  Form Accuracy Over Time by Exercise
                </h2>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <label
                  htmlFor="history-exercise-filter"
                  className="text-xs font-medium text-slate-500 whitespace-nowrap"
                >
                  Filter Exercise
                </label>
                <select
                  id="history-exercise-filter"
                  value={activeFilter}
                  onChange={(e) => setSelectedExercise(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Exercises ({sessions.length})</option>
                  {exerciseNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="h-[290px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 16, left: -12, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="timeLabel"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={false}
                    axisLine={{ stroke: '#CBD5E1' }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 85, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<TrendTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                  />
                  <ReferenceLine
                    y={85}
                    stroke="#10B981"
                    strokeDasharray="4 4"
                    label={{
                      value: 'Target 85%',
                      position: 'insideTopRight',
                      fill: '#059669',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  />
                  {visibleExercises.map((exName, idx) => {
                    const color = SERIES_COLORS[idx % SERIES_COLORS.length];
                    return (
                      <Line
                        key={exName}
                        type="monotone"
                        dataKey={exName}
                        name={exName}
                        stroke={color}
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: color, strokeWidth: 2, stroke: '#FFFFFF' }}
                        activeDot={{ r: 6, strokeWidth: 2, stroke: '#FFFFFF' }}
                        connectNulls
                        isAnimationActive={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Session Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500">
                    <th className="py-3 px-4">Exercise</th>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Volume</th>
                    <th className="py-3 px-4">Form Accuracy</th>
                    <th className="py-3 px-4">Strictness</th>
                    <th className="py-3 px-4">Key Coaching Focus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredSessions.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        {s.exerciseName}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {new Date(s.timestamp).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-800">
                        {s.holdSeconds > 0
                          ? `${s.holdSeconds.toFixed(1)}s hold`
                          : `${s.reps} reps`}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums font-semibold text-slate-900">
                        {s.avgFormScore}%
                      </td>
                      <td className="py-3.5 px-4 capitalize text-slate-600">
                        {s.strictness}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600">
                        {s.topIssues.length > 0
                          ? s.topIssues.join(' · ')
                          : 'Clean form maintained'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
