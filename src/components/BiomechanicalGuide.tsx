import { Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ExerciseDefinition, JointPoint, StickFigureKeyframe } from '../types/exercise';

interface BiomechanicalGuideProps {
  exercise: ExerciseDefinition;
  compact?: boolean;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPoint(a: JointPoint, b: JointPoint, t: number): JointPoint {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function interpolatePose(
  keyframes: StickFigureKeyframe[],
  progress: number
): {
  joints: StickFigureKeyframe['joints'];
  activeKeyframe: StickFigureKeyframe;
} {
  if (keyframes.length === 0) {
    throw new Error('Exercise requires at least one keyframe');
  }
  if (keyframes.length === 1 || progress <= keyframes[0].progress) {
    return { joints: keyframes[0].joints, activeKeyframe: keyframes[0] };
  }
  const last = keyframes[keyframes.length - 1];
  if (progress >= last.progress) {
    return { joints: last.joints, activeKeyframe: last };
  }

  let idx = 0;
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (progress >= keyframes[i].progress && progress <= keyframes[i + 1].progress) {
      idx = i;
      break;
    }
  }

  const start = keyframes[idx];
  const end = keyframes[idx + 1];
  const span = Math.max(0.0001, end.progress - start.progress);
  const localT = (progress - start.progress) / span;
  // Smooth ease-in-out
  const eased = localT < 0.5 ? 2 * localT * localT : 1 - Math.pow(-2 * localT + 2, 2) / 2;

  const j1 = start.joints;
  const j2 = end.joints;

  const joints: StickFigureKeyframe['joints'] = {
    head: lerpPoint(j1.head, j2.head, eased),
    shoulder: lerpPoint(j1.shoulder, j2.shoulder, eased),
    elbow: lerpPoint(j1.elbow, j2.elbow, eased),
    wrist: lerpPoint(j1.wrist, j2.wrist, eased),
    hip: lerpPoint(j1.hip, j2.hip, eased),
    knee: lerpPoint(j1.knee, j2.knee, eased),
    ankle: lerpPoint(j1.ankle, j2.ankle, eased),
  };

  if (j1.shoulderR && j2.shoulderR) joints.shoulderR = lerpPoint(j1.shoulderR, j2.shoulderR, eased);
  if (j1.elbowR && j2.elbowR) joints.elbowR = lerpPoint(j1.elbowR, j2.elbowR, eased);
  if (j1.wristR && j2.wristR) joints.wristR = lerpPoint(j1.wristR, j2.wristR, eased);
  if (j1.hipR && j2.hipR) joints.hipR = lerpPoint(j1.hipR, j2.hipR, eased);
  if (j1.kneeR && j2.kneeR) joints.kneeR = lerpPoint(j1.kneeR, j2.kneeR, eased);
  if (j1.ankleR && j2.ankleR) joints.ankleR = lerpPoint(j1.ankleR, j2.ankleR, eased);

  const activeKeyframe = localT < 0.55 ? start : end;
  return { joints, activeKeyframe };
}

function interpolateHandPose(
  keyframes: StickFigureKeyframe[],
  progress: number
): {
  curl: number;
  splay: number;
  pinch: number;
  activeKeyframe: StickFigureKeyframe;
} {
  if (keyframes.length === 0) {
    throw new Error('Exercise requires at least one keyframe');
  }
  const fallback = { curl: 0, splay: 0.6, pinch: 0 };
  if (keyframes.length === 1 || progress <= keyframes[0].progress) {
    return { ...(keyframes[0].handPose ?? fallback), activeKeyframe: keyframes[0] };
  }
  const last = keyframes[keyframes.length - 1];
  if (progress >= last.progress) {
    return { ...(last.handPose ?? fallback), activeKeyframe: last };
  }

  let idx = 0;
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (progress >= keyframes[i].progress && progress <= keyframes[i + 1].progress) {
      idx = i;
      break;
    }
  }

  const start = keyframes[idx];
  const end = keyframes[idx + 1];
  const span = Math.max(0.0001, end.progress - start.progress);
  const localT = (progress - start.progress) / span;
  const eased = localT < 0.5 ? 2 * localT * localT : 1 - Math.pow(-2 * localT + 2, 2) / 2;

  const h1 = start.handPose ?? fallback;
  const h2 = end.handPose ?? fallback;
  return {
    curl: lerp(h1.curl, h2.curl, eased),
    splay: lerp(h1.splay, h2.splay, eased),
    pinch: lerp(h1.pinch, h2.pinch, eased),
    activeKeyframe: localT < 0.55 ? start : end,
  };
}

interface HandBlueprintGeometry {
  wrist: JointPoint;
  palmPolygon: string;
  thumb: JointPoint[];
  fingers: JointPoint[][];
  splayDeg: number;
  curlDeg: number;
  pinchGapPct: number;
}

function buildHandGeometry(curl: number, splay: number, pinch: number): HandBlueprintGeometry {
  const wrist: JointPoint = { x: 140, y: 230 };
  const mcps: JointPoint[] = [
    { x: 108, y: 152 }, // Index
    { x: 132, y: 144 }, // Middle
    { x: 156, y: 148 }, // Ring
    { x: 178, y: 160 }, // Pinky
  ];
  const baseAngles = [-14, -3, 9, 21];
  const splayOffsets = [-16, -5, 7, 18];
  const fingerLengths = [
    [28, 22, 16],
    [32, 24, 18],
    [29, 22, 16],
    [23, 17, 13],
  ];

  const fingers: JointPoint[][] = mcps.map((mcp, idx) => {
    const isIndex = idx === 0;
    const spreadRad = ((baseAngles[idx] + splay * splayOffsets[idx]) * Math.PI) / 180;
    const effectiveCurl = isIndex ? Math.max(curl, pinch * 0.42) : curl;
    const lengths = fingerLengths[idx];
    // Project upward (-90 deg) with spread; curl shortens apparent vertical reach and bends joints inward
    const dirX = Math.sin(spreadRad) + (isIndex ? pinch * 0.14 : 0);
    const dirY = -Math.cos(spreadRad);

    const pipScale = 1 - effectiveCurl * 0.36;
    const dipScale = 1 - effectiveCurl * 0.62;
    const tipScale = 1 - effectiveCurl * 0.78;

    const pip: JointPoint = {
      x: mcp.x + dirX * lengths[0] * pipScale - (isIndex ? pinch * 6 : 0),
      y: mcp.y + dirY * lengths[0] * pipScale + effectiveCurl * 12,
    };
    const dip: JointPoint = {
      x: pip.x + dirX * lengths[1] * dipScale - (isIndex ? pinch * 10 : 0),
      y: pip.y + dirY * lengths[1] * dipScale + effectiveCurl * 18 + (isIndex ? pinch * 14 : 0),
    };
    const tip: JointPoint = {
      x: dip.x + dirX * lengths[2] * tipScale - (isIndex ? pinch * 10 : 0),
      y: dip.y + dirY * lengths[2] * tipScale + effectiveCurl * 22 + (isIndex ? pinch * 16 : 0),
    };
    return [mcp, pip, dip, tip];
  });

  // Thumb
  const thumbCmc: JointPoint = { x: 102, y: 204 };
  const thumbMcp: JointPoint = {
    x: lerp(80, 88, pinch * 0.5 + curl * 0.3),
    y: lerp(178, 170, pinch * 0.5),
  };
  const thumbIp: JointPoint = {
    x: lerp(62 - splay * 10, 86, pinch) + curl * 22,
    y: lerp(150, 134, pinch) + curl * 12,
  };
  const indexTip = fingers[0][3];
  const thumbTipTargetX = indexTip.x + 2;
  const thumbTipTargetY = indexTip.y + 4;
  const thumbTip: JointPoint = {
    x: lerp(50 - splay * 12 + curl * 38, thumbTipTargetX, pinch),
    y: lerp(124 + curl * 22, thumbTipTargetY, pinch),
  };

  const palmPolygon = `${wrist.x - 26},${wrist.y - 4} ${thumbCmc.x - 6},${thumbCmc.y - 8} ${mcps[0].x},${mcps[0].y} ${mcps[1].x},${mcps[1].y} ${mcps[2].x},${mcps[2].y} ${mcps[3].x},${mcps[3].y} ${wrist.x + 26},${wrist.y - 4}`;

  return {
    wrist,
    palmPolygon,
    thumb: [thumbCmc, thumbMcp, thumbIp, thumbTip],
    fingers,
    splayDeg: Math.round(16 + splay * 30 * (1 - curl * 0.65)),
    curlDeg: Math.round(174 - curl * 96),
    pinchGapPct: Math.round(lerp(92, 16, pinch)),
  };
}

function computeJointDeg(a: JointPoint, b: JointPoint, c: JointPoint): number {
  const rad = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let deg = Math.abs((rad * 180) / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return Math.round(deg);
}

export function BiomechanicalGuide({ exercise, compact = false }: BiomechanicalGuideProps) {
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState<0.5 | 1>(1);
  const isHandGuide = exercise.trackingMode === 'hand';

  useEffect(() => {
    setProgress(0);
    setIsPlaying(true);
  }, [exercise.id]);

  useEffect(() => {
    if (!isPlaying) return;
    let frameId: number;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const cycleSeconds = 3.4 / speed;
      setProgress((prev) => (prev + dt / cycleSeconds) % 1);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, speed]);

  const { joints, activeKeyframe } = useMemo(
    () => interpolatePose(exercise.keyframes, progress),
    [exercise.keyframes, progress]
  );

  const handState = useMemo(() => {
    if (!isHandGuide) return null;
    const interp = interpolateHandPose(exercise.keyframes, progress);
    return {
      geom: buildHandGeometry(interp.curl, interp.splay, interp.pinch),
      activeKeyframe: interp.activeKeyframe,
    };
  }, [exercise.keyframes, isHandGuide, progress]);

  const currentPhase = handState ? handState.activeKeyframe : activeKeyframe;

  const liveAngleDisplay = useMemo(() => {
    const ann = currentPhase.angleAnnotation;
    if (!ann || isHandGuide) return null;
    let deg = 0;
    let pos: JointPoint = joints.knee;
    if (ann.vertex === 'knee') {
      deg = computeJointDeg(joints.hip, joints.knee, joints.ankle);
      pos = joints.knee;
    } else if (ann.vertex === 'elbow') {
      deg = computeJointDeg(joints.shoulder, joints.elbow, joints.wrist);
      pos = joints.elbow;
    } else if (ann.vertex === 'hip') {
      deg = computeJointDeg(joints.shoulder, joints.hip, joints.ankle);
      pos = joints.hip;
    } else if (ann.vertex === 'shoulder') {
      deg = computeJointDeg(joints.hip, joints.shoulder, joints.elbow);
      pos = joints.shoulder;
    }
    return { label: ann.label, deg, pos };
  }, [currentPhase.angleAnnotation, isHandGuide, joints]);

  const hasSecondarySide = Boolean(joints.kneeR || joints.elbowR);

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Top phase bar */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 bg-slate-50/70">
        <div className="min-w-0">
          <span className="text-xs font-medium text-slate-500">
            {isHandGuide ? 'Hand Sensor Guide' : 'Target Form Guide'}
          </span>
          <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
          <span className="text-xs font-semibold text-blue-700">
            {currentPhase.phaseName}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setSpeed((s) => (s === 1 ? 0.5 : 1))}
            className="px-2 py-1 text-xs font-mono font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md cursor-pointer whitespace-nowrap"
            title="Toggle playback speed"
          >
            {speed}x
          </button>
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            aria-label={isPlaying ? 'Pause guide' : 'Play guide'}
            className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-white border border-slate-200 text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setProgress(0);
              setIsPlaying(false);
            }}
            aria-label="Reset guide to start"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-white border border-slate-200 text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Interactive SVG Biomechanical Stage */}
      <div className={`relative bg-slate-900 ${compact ? 'h-48' : 'h-64 sm:h-72'}`}>
        <svg
          viewBox="0 0 280 280"
          className="h-full w-full"
          role="img"
          aria-label={`${exercise.name} biomechanical reference diagram`}
        >
          {/* Coordinate blueprint grid */}
          <defs>
            <pattern id={`grid-${exercise.id}`} width="28" height="28" patternUnits="userSpaceOnUse">
              <path
                d="M 28 0 L 0 0 0 28"
                fill="none"
                stroke="rgba(148, 163, 184, 0.12)"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="280" height="280" fill={`url(#grid-${exercise.id})`} />

          {isHandGuide && handState ? (
            <g>
              {/* Subtle wrist reference line */}
              <line
                x1="70"
                y1="234"
                x2="210"
                y2="234"
                stroke="#475569"
                strokeWidth="2"
                strokeDasharray="4 4"
              />

              {/* Palm polygon */}
              <polygon
                points={handState.geom.palmPolygon}
                fill="rgba(56, 189, 248, 0.12)"
                stroke="#10B981"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />

              {/* Knuckle arch */}
              <polyline
                points={handState.geom.fingers.map((f) => `${f[0].x},${f[0].y}`).join(' ')}
                fill="none"
                stroke="#38BDF8"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Wrist rays to MCP */}
              {handState.geom.fingers.map((f, idx) => (
                <line
                  key={`ray-${idx}`}
                  x1={handState.geom.wrist.x}
                  y1={handState.geom.wrist.y}
                  x2={f[0].x}
                  y2={f[0].y}
                  stroke="rgba(148, 163, 184, 0.55)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              ))}

              {/* Thumb segments */}
              <polyline
                points={[
                  handState.geom.wrist,
                  ...handState.geom.thumb,
                ]
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
                fill="none"
                stroke={exercise.id === 'crab_pinch' ? '#10B981' : '#38BDF8'}
                strokeWidth="5.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* 4 Finger chains */}
              {handState.geom.fingers.map((chain, fIdx) => (
                <polyline
                  key={`finger-${fIdx}`}
                  points={chain.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={
                    exercise.id === 'crab_pinch' && fIdx === 0 ? '#10B981' : '#38BDF8'
                  }
                  strokeWidth="5.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}

              {/* Hand joint nodes */}
              {[handState.geom.wrist, ...handState.geom.thumb, ...handState.geom.fingers.flat()].map(
                (pt, i) => (
                  <circle
                    key={`hj-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r="3.8"
                    fill="#FFFFFF"
                    stroke="#0284C7"
                    strokeWidth="2"
                  />
                )
              )}

              {/* Live hand metric badge */}
              <g>
                <rect
                  x="176"
                  y="14"
                  width="92"
                  height="24"
                  rx="5"
                  fill="rgba(15, 23, 42, 0.9)"
                  stroke="rgba(16, 185, 129, 0.75)"
                  strokeWidth="1"
                />
                <text
                  x="222"
                  y="29.5"
                  textAnchor="middle"
                  fill="#ECFDF5"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="600"
                >
                  {exercise.id === 'crab_pinch'
                    ? `Gap ${handState.geom.pinchGapPct}%`
                    : exercise.id === 'tendon_glide'
                    ? `Curl ${handState.geom.curlDeg}°`
                    : `Splay ${handState.geom.splayDeg}°`}
                </text>
              </g>
            </g>
          ) : (
            <>
              {/* Floor baseline */}
              <line
                x1="16"
                y1="264"
                x2="264"
                y2="264"
                stroke="#475569"
                strokeWidth="2"
                strokeDasharray="4 4"
              />

              {/* Secondary / back limb (muted slate for depth clarity) */}
              {hasSecondarySide && (
                <g stroke="#64748B" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none">
                  {joints.hipR && joints.kneeR && (
                    <line x1={joints.hipR.x} y1={joints.hipR.y} x2={joints.kneeR.x} y2={joints.kneeR.y} />
                  )}
                  {!joints.hipR && joints.kneeR && (
                    <line x1={joints.hip.x} y1={joints.hip.y} x2={joints.kneeR.x} y2={joints.kneeR.y} />
                  )}
                  {joints.kneeR && joints.ankleR && (
                    <line x1={joints.kneeR.x} y1={joints.kneeR.y} x2={joints.ankleR.x} y2={joints.ankleR.y} />
                  )}
                  {joints.shoulderR && joints.elbowR && (
                    <line x1={joints.shoulderR.x} y1={joints.shoulderR.y} x2={joints.elbowR.x} y2={joints.elbowR.y} />
                  )}
                  {joints.elbowR && joints.wristR && (
                    <line x1={joints.elbowR.x} y1={joints.elbowR.y} x2={joints.wristR.x} y2={joints.wristR.y} />
                  )}
                  {joints.shoulderR && joints.hipR && (
                    <>
                      <line x1={joints.shoulder.x} y1={joints.shoulder.y} x2={joints.shoulderR.x} y2={joints.shoulderR.y} />
                      <line x1={joints.shoulderR.x} y1={joints.shoulderR.y} x2={joints.hipR.x} y2={joints.hipR.y} />
                      <line x1={joints.hip.x} y1={joints.hip.y} x2={joints.hipR.x} y2={joints.hipR.y} />
                    </>
                  )}
                </g>
              )}

              {/* Primary skeleton limbs */}
              <g stroke="#38BDF8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none">
                {/* Neck to shoulder */}
                <line x1={joints.head.x} y1={joints.head.y + 10} x2={joints.shoulder.x} y2={joints.shoulder.y} />
                {/* Torso */}
                <line x1={joints.shoulder.x} y1={joints.shoulder.y} x2={joints.hip.x} y2={joints.hip.y} stroke="#10B981" />
                {/* Leg */}
                <line x1={joints.hip.x} y1={joints.hip.y} x2={joints.knee.x} y2={joints.knee.y} />
                <line x1={joints.knee.x} y1={joints.knee.y} x2={joints.ankle.x} y2={joints.ankle.y} />
                {/* Arm */}
                <line x1={joints.shoulder.x} y1={joints.shoulder.y} x2={joints.elbow.x} y2={joints.elbow.y} />
                <line x1={joints.elbow.x} y1={joints.elbow.y} x2={joints.wrist.x} y2={joints.wrist.y} />
              </g>

              {/* Head */}
              <circle
                cx={joints.head.x}
                cy={joints.head.y}
                r="13"
                fill="#0F172A"
                stroke="#38BDF8"
                strokeWidth="3.5"
              />

              {/* Joint nodes */}
              {[
                joints.shoulder,
                joints.elbow,
                joints.wrist,
                joints.hip,
                joints.knee,
                joints.ankle,
              ].map((pt, i) => (
                <circle
                  key={i}
                  cx={pt.x}
                  cy={pt.y}
                  r="5"
                  fill="#FFFFFF"
                  stroke="#0284C7"
                  strokeWidth="2.5"
                />
              ))}

              {/* Live angle readout ring */}
              {liveAngleDisplay && (
                <g>
                  <circle
                    cx={liveAngleDisplay.pos.x}
                    cy={liveAngleDisplay.pos.y}
                    r="14"
                    fill="rgba(16, 185, 129, 0.16)"
                    stroke="#10B981"
                    strokeWidth="1.5"
                    strokeDasharray="3 2"
                  />
                  <rect
                    x={Math.min(200, Math.max(8, liveAngleDisplay.pos.x + 14))}
                    y={Math.min(238, Math.max(8, liveAngleDisplay.pos.y - 26))}
                    width="74"
                    height="22"
                    rx="4"
                    fill="rgba(15, 23, 42, 0.9)"
                    stroke="rgba(16, 185, 129, 0.7)"
                    strokeWidth="1"
                  />
                  <text
                    x={Math.min(200, Math.max(8, liveAngleDisplay.pos.x + 14)) + 37}
                    y={Math.min(238, Math.max(8, liveAngleDisplay.pos.y - 26)) + 14.5}
                    textAnchor="middle"
                    fill="#ECFDF5"
                    fontSize="10"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="600"
                  >
                    {liveAngleDisplay.label} {liveAngleDisplay.deg}°
                  </text>
                </g>
              )}
            </>
          )}
        </svg>

        {/* Bottom cue scrim */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent px-4 py-2.5">
          <p className="text-xs font-medium text-slate-100 leading-snug">
            {currentPhase.cue}
          </p>
        </div>
      </div>

      {/* Interactive phase scrubber */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-100 bg-white">
        <label
          htmlFor={`scrubber-${exercise.id}`}
          className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0"
        >
          Phase Scrub
        </label>
        <input
          id={`scrubber-${exercise.id}`}
          type="range"
          min={0}
          max={100}
          value={Math.round(progress * 100)}
          onChange={(e) => {
            setIsPlaying(false);
            setProgress(Number(e.target.value) / 100);
          }}
          className="w-full accent-blue-600 cursor-pointer"
        />
        <span className="text-xs font-mono tabular-nums text-slate-600 w-9 text-right shrink-0">
          {Math.round(progress * 100)}%
        </span>
      </div>
    </div>
  );
}
