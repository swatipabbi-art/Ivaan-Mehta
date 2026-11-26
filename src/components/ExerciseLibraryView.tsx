import { Camera, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { EXERCISE_LIST } from '../data/exercises';
import { ExerciseId } from '../types/exercise';
import { BiomechanicalGuide } from './BiomechanicalGuide';

interface ExerciseLibraryViewProps {
  selectedExerciseId: ExerciseId;
  onPracticeExercise: (id: ExerciseId, startCamera: boolean) => void;
}

const CATEGORIES = [
  'All',
  'Hand Exercises',
  'Kids (Ages 5–12)',
  'Lower Body',
  'Upper Body',
  'Core Stability',
] as const;

export function ExerciseLibraryView({
  selectedExerciseId,
  onPracticeExercise,
}: ExerciseLibraryViewProps) {
  const [categoryFilter, setCategoryFilter] =
    useState<(typeof CATEGORIES)[number]>('All');

  const filtered =
    categoryFilter === 'All'
      ? EXERCISE_LIST
      : categoryFilter === 'Hand Exercises'
      ? EXERCISE_LIST.filter((ex) => ex.trackingMode === 'hand')
      : categoryFilter === 'Kids (Ages 5–12)'
      ? EXERCISE_LIST.filter((ex) => ex.audience === 'kids')
      : EXERCISE_LIST.filter(
          (ex) => ex.audience === 'general' && ex.category === categoryFilter
        );

  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-7">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">
            Exercise Technique Curriculum
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            Study joint angles, free hand-tracking drills for kids and adults, and movement phases before stepping in front of the camera sensor.
          </p>
        </div>

        {/* Category Filter Segmented Control */}
        <div
          className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto"
          role="group"
          aria-label="Filter exercises by audience or muscle group"
        >
          {CATEGORIES.map((cat) => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Curriculum Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filtered.map((exercise) => {
          const isCurrent = exercise.id === selectedExerciseId;
          return (
            <article
              key={exercise.id}
              className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900">
                    {exercise.name}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className={exercise.audience === 'kids' ? 'font-semibold text-blue-700' : ''}>
                      {exercise.ageGroup ? `${exercise.ageGroup} · ` : ''}
                      {exercise.category}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{exercise.difficulty}</span>
                    {exercise.trackingMode === 'hand' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-emerald-700">Free · Hand Sensor</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>{exercise.cameraSetup.angle}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onPracticeExercise(exercise.id, false)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      isCurrent
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Open Guide
                  </button>
                  <button
                    type="button"
                    onClick={() => onPracticeExercise(exercise.id, true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Practice Live</span>
                  </button>
                </div>
              </div>

              <BiomechanicalGuide exercise={exercise} compact />

              <p className="text-sm text-slate-600 leading-relaxed">
                {exercise.summary}
              </p>

              <div className="border-t border-slate-100 pt-4">
                <div className="text-xs font-semibold text-slate-800 mb-2">
                  Sensor Angle Checkpoints
                </div>
                <ul className="space-y-1.5">
                  {exercise.checkpoints.map((cp) => (
                    <li
                      key={cp.id}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="inline-flex items-center gap-1.5 text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                        <span>{cp.label}</span>
                      </span>
                      <span className="font-mono text-slate-500 tabular-nums shrink-0">
                        {cp.targetDescription}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
