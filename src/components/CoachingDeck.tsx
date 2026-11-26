import {
  AlertTriangle,
  BookmarkCheck,
  CheckCircle2,
  CircleDashed,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { EXERCISE_LIST } from '../data/exercises';
import {
  ExerciseDefinition,
  ExerciseId,
  FormSeverity,
  PoseAnalysisResult,
  StrictnessLevel,
} from '../types/exercise';

interface CoachingDeckProps {
  exercise: ExerciseDefinition;
  onSelectExercise: (id: ExerciseId) => void;
  strictness: StrictnessLevel;
  onChangeStrictness: (level: StrictnessLevel) => void;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  reps: number;
  holdSeconds: number;
  avgFormScore: number;
  analysis: PoseAnalysisResult | null;
  onResetCounter: () => void;
  onSaveSession: () => void;
  sessionSavedNotice: boolean;
  isProActive: boolean;
  isOwner: boolean;
  onOpenAiCoach: () => void;
}

function getSeverityIcon(status: FormSeverity) {
  switch (status) {
    case 'good':
      return <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />;
    case 'warn':
      return <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-rose-600 shrink-0" aria-hidden="true" />;
    default:
      return <CircleDashed className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />;
  }
}

function getSeverityTextClass(status: FormSeverity) {
  switch (status) {
    case 'good':
      return 'text-emerald-700';
    case 'warn':
      return 'text-amber-700';
    case 'error':
      return 'text-rose-700';
    default:
      return 'text-slate-500';
  }
}

function formatHoldTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  return `${secs}.${tenths}s`;
}

export function CoachingDeck({
  exercise,
  onSelectExercise,
  strictness,
  onChangeStrictness,
  audioEnabled,
  onToggleAudio,
  reps,
  holdSeconds,
  avgFormScore,
  analysis,
  onResetCounter,
  onSaveSession,
  sessionSavedNotice,
  isProActive,
  isOwner,
  onOpenAiCoach,
}: CoachingDeckProps) {
  const handExercises = EXERCISE_LIST.filter((e) => e.trackingMode === 'hand');
  const generalExercises = EXERCISE_LIST.filter(
    (e) => e.audience === 'general' && e.trackingMode !== 'hand'
  );
  const kidsExercises = EXERCISE_LIST.filter(
    (e) => e.audience === 'kids' && e.trackingMode !== 'hand'
  );
  const displayCheckpoints =
    analysis && analysis.checkpoints.length > 0
      ? analysis.checkpoints
      : exercise.checkpoints.map((cp) => ({
          id: cp.id,
          label: cp.label,
          targetText: cp.targetDescription,
          currentValueText: '—',
          status: 'waiting' as FormSeverity,
          feedback: 'Awaiting camera tracking',
        }));

  const hasActivity = exercise.isHold ? holdSeconds >= 1 : reps > 0;

  return (
    <aside className="flex flex-col gap-5">
      {/* Exercise Selector & Strictness Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="exercise-select"
              className="block text-xs font-medium text-slate-500 mb-1.5"
            >
              Active Exercise
            </label>
            <select
              id="exercise-select"
              value={exercise.id}
              onChange={(e) => onSelectExercise(e.target.value as ExerciseId)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none cursor-pointer"
            >
              <optgroup label="Hand Exercises (Free · Kids & Adults)">
                {handExercises.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.ageGroup ? `Kids ${item.ageGroup}` : 'Adults'})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Adult & General Strength">
                {generalExercises.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.category})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Children's Full-Body Library (Ages 5–12)">
                {kidsExercises.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.ageGroup})
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        {/* Metadata line — clean unboxed typography */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>{exercise.primaryMuscles}</span>
          <span aria-hidden="true">·</span>
          <span>{exercise.cameraSetup.angle}</span>
          <span aria-hidden="true">·</span>
          <span>{exercise.cameraSetup.distance}</span>
        </div>

        {/* Controls row: Strictness + Audio Coach */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" role="group" aria-label="Form tolerance">
            {(['beginner', 'standard', 'strict'] as StrictnessLevel[]).map((level) => {
              const active = strictness === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onChangeStrictness(level)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {level}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onToggleAudio}
            aria-pressed={audioEnabled}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              audioEnabled
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
          >
            {audioEnabled ? (
              <>
                <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Voice Coach On</span>
              </>
            ) : (
              <>
                <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Voice Muted</span>
              </>
            )}
          </button>
        </div>
      </section>

      {/* Live Performance Readout */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Live Session Metrics
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetCounter}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
              title="Reset current set"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3.5 py-3">
            <div className="text-xs font-medium text-slate-500">
              {exercise.isHold ? 'Clean Hold Time' : 'Valid Reps'}
            </div>
            <div className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
              {exercise.isHold ? formatHoldTime(holdSeconds) : reps}
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3.5 py-3">
            <div className="text-xs font-medium text-slate-500">
              Form Accuracy
            </div>
            <div className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
              {analysis?.bodyVisible ? `${analysis.formScore}%` : avgFormScore > 0 ? `${avgFormScore}%` : '—'}
            </div>
          </div>
        </div>

        {/* Phase Progress Indicator */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-slate-600">
              {analysis?.bodyVisible ? analysis.phase : 'Camera Waiting'}
            </span>
            <span className="font-mono tabular-nums text-slate-400">
              {analysis?.bodyVisible ? `${Math.round(analysis.phaseProgress * 100)}%` : '0%'}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-transform duration-150 origin-left"
              style={{
                transform: `scaleX(${analysis?.bodyVisible ? Math.max(0.03, analysis.phaseProgress) : 0})`,
              }}
            />
          </div>
        </div>

        {/* Save Set Action */}
        <button
          type="button"
          onClick={onSaveSession}
          disabled={!hasActivity}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
            sessionSavedNotice
              ? 'bg-emerald-600 text-white'
              : hasActivity
              ? 'bg-slate-900 text-white hover:bg-slate-800'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          <BookmarkCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {sessionSavedNotice
              ? 'Set Saved to Session Log'
              : exercise.isHold
              ? 'Save Hold Time to Log'
              : 'Save Completed Set'}
          </span>
        </button>
      </section>

      {/* Real-Time Joint Checkpoints */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Biomechanical Checkpoints
          </h2>
          <span className="text-xs text-slate-400 font-mono">Live vs Target</span>
        </div>

        <div className="divide-y divide-slate-100">
          {displayCheckpoints.map((cp) => (
            <div key={cp.id} className="py-3 first:pt-1 last:pb-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {getSeverityIcon(cp.status)}
                  <span className="text-sm font-medium text-slate-800 truncate">
                    {cp.label}
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5 shrink-0 font-mono tabular-nums">
                  <span className={`text-sm font-semibold ${getSeverityTextClass(cp.status)}`}>
                    {cp.currentValueText}
                  </span>
                  <span className="text-xs text-slate-400">/ {cp.targetText}</span>
                </div>
              </div>
              <p className="mt-1 pl-6 text-xs text-slate-500">
                {cp.feedback}
              </p>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onOpenAiCoach}
          className="mt-1 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
        >
          <Sparkles className="h-3.5 w-3.5 text-blue-600 shrink-0" aria-hidden="true" />
          <span>
            {isOwner
              ? 'Ask AI Coach · Owner Free'
              : isProActive
              ? 'Ask AI Coach For Solutions'
              : 'AI Coach Solutions · Pro ($29 / ₹100)'}
          </span>
        </button>
      </section>

      {/* Camera Framing Tip */}
      <section className="bg-slate-100/80 border border-slate-200 rounded-xl p-4">
        <div className="text-xs font-semibold text-slate-800">
          Camera Placement · {exercise.cameraSetup.angle}
        </div>
        <p className="mt-1 text-xs text-slate-600 leading-relaxed">
          {exercise.cameraSetup.framingTip} Place camera at{' '}
          <span className="font-medium text-slate-800">{exercise.cameraSetup.height.toLowerCase()}</span>,{' '}
          <span className="font-medium text-slate-800">{exercise.cameraSetup.distance}</span>.
        </p>
      </section>
    </aside>
  );
}
