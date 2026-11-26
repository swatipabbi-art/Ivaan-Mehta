import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  CheckpointStatus,
  ExerciseId,
  FormSeverity,
  HighlightSegment,
  PoseAnalysisResult,
  StrictnessLevel,
} from '../types/exercise';
import { calculateAngle } from './poseGeometry';

export const HAND_LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

const FINGER_SEGMENTS: Array<[number, number]> = [
  [5, 6],
  [6, 7],
  [7, 8],
  [9, 10],
  [10, 11],
  [11, 12],
  [13, 14],
  [14, 15],
  [15, 16],
  [17, 18],
  [18, 19],
  [19, 20],
];

const PINCH_SEGMENTS: Array<[number, number]> = [
  [1, 2],
  [2, 3],
  [3, 4],
  [5, 6],
  [6, 7],
  [7, 8],
];

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function dist2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function scoreFromCheckpoints(checkpoints: CheckpointStatus[]): number {
  if (checkpoints.length === 0) return 0;
  let total = 0;
  for (const cp of checkpoints) {
    if (cp.status === 'good') total += 100;
    else if (cp.status === 'warn') total += 74;
    else if (cp.status === 'error') total += 42;
    else total += 65;
  }
  return Math.round(total / checkpoints.length);
}

function aggregateStatus(checkpoints: CheckpointStatus[]): FormSeverity {
  if (checkpoints.some((c) => c.status === 'error')) return 'error';
  if (checkpoints.some((c) => c.status === 'warn')) return 'warn';
  if (checkpoints.some((c) => c.status === 'good')) return 'good';
  return 'waiting';
}

function segmentsWithStatus(
  pairs: Array<[number, number]>,
  status: FormSeverity
): HighlightSegment[] {
  return pairs.map(([from, to]) => ({ from, to, status }));
}

export class HandSmoother {
  private prev: NormalizedLandmark[] | null = null;
  private readonly alpha: number;

  constructor(alpha = 0.48) {
    this.alpha = alpha;
  }

  reset() {
    this.prev = null;
  }

  smooth(current: NormalizedLandmark[]): NormalizedLandmark[] {
    if (!this.prev || this.prev.length !== current.length) {
      this.prev = current.map((lm) => ({ ...lm }));
      return this.prev;
    }

    const smoothed = current.map((lm, i) => {
      const prevLm = this.prev![i];
      return {
        x: prevLm.x + this.alpha * (lm.x - prevLm.x),
        y: prevLm.y + this.alpha * (lm.y - prevLm.y),
        z: prevLm.z + this.alpha * (lm.z - prevLm.z),
        visibility: lm.visibility,
      };
    });

    this.prev = smoothed;
    return smoothed;
  }
}

export class HandEvaluator {
  private exerciseId: ExerciseId;
  private strictness: StrictnessLevel;

  private phaseState: 'start' | 'mid' = 'start';
  private reachedPeak = false;

  constructor(exerciseId: ExerciseId, strictness: StrictnessLevel) {
    this.exerciseId = exerciseId;
    this.strictness = strictness;
  }

  setExercise(exerciseId: ExerciseId) {
    this.exerciseId = exerciseId;
    this.resetRepState();
  }

  setStrictness(strictness: StrictnessLevel) {
    this.strictness = strictness;
  }

  resetRepState() {
    this.phaseState = 'start';
    this.reachedPeak = false;
  }

  evaluate(landmarks: NormalizedLandmark[]): PoseAnalysisResult {
    if (!landmarks || landmarks.length < 21) {
      return {
        phase: 'Hand Not Visible',
        phaseProgress: 0,
        repIncrement: false,
        isHoldExercise: this.exerciseId === 'wrist_fan_hold',
        holdActive: false,
        formScore: 0,
        primaryStatus: 'waiting',
        primaryCue: 'Hold one open hand 1–2 ft in front of your camera.',
        checkpoints: [],
        jointAngles: [],
        highlightSegments: [],
        bodyVisible: false,
      };
    }

    switch (this.exerciseId) {
      case 'star_hands':
        return this.evalStarHands(landmarks);
      case 'crab_pinch':
        return this.evalCrabPinch(landmarks);
      case 'tendon_glide':
        return this.evalTendonGlide(landmarks);
      case 'wrist_fan_hold':
        return this.evalWristFanHold(landmarks);
      default:
        return this.evalStarHands(landmarks);
    }
  }

  private getFingerMetrics(landmarks: NormalizedLandmark[]) {
    const wrist = landmarks[HAND_LANDMARK.WRIST];
    const indexAngle = calculateAngle(
      landmarks[HAND_LANDMARK.INDEX_MCP],
      landmarks[HAND_LANDMARK.INDEX_PIP],
      landmarks[HAND_LANDMARK.INDEX_TIP]
    );
    const middleAngle = calculateAngle(
      landmarks[HAND_LANDMARK.MIDDLE_MCP],
      landmarks[HAND_LANDMARK.MIDDLE_PIP],
      landmarks[HAND_LANDMARK.MIDDLE_TIP]
    );
    const ringAngle = calculateAngle(
      landmarks[HAND_LANDMARK.RING_MCP],
      landmarks[HAND_LANDMARK.RING_PIP],
      landmarks[HAND_LANDMARK.RING_TIP]
    );
    const pinkyAngle = calculateAngle(
      landmarks[HAND_LANDMARK.PINKY_MCP],
      landmarks[HAND_LANDMARK.PINKY_PIP],
      landmarks[HAND_LANDMARK.PINKY_TIP]
    );

    const fingerAngles = [indexAngle, middleAngle, ringAngle, pinkyAngle];
    const avgCurl =
      fingerAngles.reduce((sum, v) => sum + v, 0) / fingerAngles.length;
    const fingerSymmetry =
      Math.max(...fingerAngles) - Math.min(...fingerAngles);

    const splayAngle = calculateAngle(
      landmarks[HAND_LANDMARK.INDEX_TIP],
      wrist,
      landmarks[HAND_LANDMARK.PINKY_TIP]
    );

    const palmScale = Math.max(
      0.04,
      dist2D(wrist, landmarks[HAND_LANDMARK.MIDDLE_MCP])
    );
    const pinchDist = dist2D(
      landmarks[HAND_LANDMARK.THUMB_TIP],
      landmarks[HAND_LANDMARK.INDEX_TIP]
    );
    const pinchRatio = pinchDist / palmScale;

    return {
      indexAngle,
      middleAngle,
      ringAngle,
      pinkyAngle,
      avgCurl,
      fingerSymmetry,
      splayAngle,
      pinchRatio,
    };
  }

  private evalStarHands(landmarks: NormalizedLandmark[]): PoseAnalysisResult {
    const m = this.getFingerMetrics(landmarks);
    const fistThreshold =
      this.strictness === 'strict' ? 86 : this.strictness === 'beginner' ? 104 : 95;
    const openThreshold =
      this.strictness === 'strict' ? 158 : this.strictness === 'beginner' ? 144 : 152;
    const splayTarget =
      this.strictness === 'strict' ? 37 : this.strictness === 'beginner' ? 27 : 32;
    const symMax =
      this.strictness === 'strict' ? 20 : this.strictness === 'beginner' ? 34 : 26;

    // Cycle: Open -> Curl Fist (peak) -> Open Wide Starfish (rep!)
    let repIncrement = false;
    if (this.phaseState === 'start') {
      if (m.avgCurl <= fistThreshold) {
        this.phaseState = 'mid';
        this.reachedPeak = true;
      }
    } else if (this.phaseState === 'mid') {
      if (m.avgCurl >= openThreshold && m.splayAngle >= splayTarget) {
        if (this.reachedPeak) {
          repIncrement = true;
        }
        this.phaseState = 'start';
        this.reachedPeak = false;
      }
    }

    const isCurled = m.avgCurl <= fistThreshold + 8;
    const splayStatus: FormSeverity = isCurled
      ? 'good'
      : m.splayAngle >= splayTarget
      ? 'good'
      : m.splayAngle >= splayTarget - 7
      ? 'warn'
      : 'error';

    const rangeStatus: FormSeverity =
      m.avgCurl <= fistThreshold || m.avgCurl >= openThreshold
        ? 'good'
        : 'warn';

    const symStatus: FormSeverity =
      m.fingerSymmetry <= symMax
        ? 'good'
        : m.fingerSymmetry <= symMax + 10
        ? 'warn'
        : 'error';

    const checkpoints: CheckpointStatus[] = [
      {
        id: 'finger_spread',
        label: 'Starfish Finger Spread',
        targetText: `>= ${splayTarget}°`,
        currentValueText: `${Math.round(m.splayAngle)}°`,
        status: splayStatus,
        feedback:
          isCurled
            ? 'Squeezed fist—now pop fingers out wide like a star!'
            : splayStatus === 'good'
            ? 'Wide starfish spread!'
            : 'Stretch your thumb and pinky wider apart.',
      },
      {
        id: 'fist_squeeze',
        label: 'Open / Fist Range',
        targetText: `<= ${fistThreshold}° / >= ${openThreshold}°`,
        currentValueText: `${Math.round(m.avgCurl)}°`,
        status: rangeStatus,
        feedback:
          m.avgCurl <= fistThreshold
            ? 'Strong fist squeeze!'
            : m.avgCurl >= openThreshold
            ? 'Fingers fully straight—now curl into a gentle fist.'
            : 'Keep moving cleanly between a soft fist and wide open fingers.',
      },
      {
        id: 'even_fingers',
        label: 'Even Finger Motion',
        targetText: `<= ${symMax}° diff`,
        currentValueText: `${Math.round(m.fingerSymmetry)}°`,
        status: symStatus,
        feedback:
          symStatus === 'good'
            ? 'All four fingers moving together cleanly.'
            : 'Try curling and opening your pinky with the other fingers.',
      },
    ];

    const primaryStatus = aggregateStatus(checkpoints);
    const phase =
      m.avgCurl <= fistThreshold
        ? 'Gentle Fist'
        : m.avgCurl >= openThreshold && m.splayAngle >= splayTarget
        ? 'Starfish Spread'
        : 'Transition';

    const progress = clamp((165 - m.avgCurl) / 85, 0, 1);

    let primaryCue = 'Great starfish hands—open wide then squeeze softly!';
    if (splayStatus === 'error') {
      primaryCue = 'Spread your fingers wide apart like a bright starfish!';
    } else if (symStatus === 'error') {
      primaryCue = 'Move all fingers smoothly together.';
    } else if (m.avgCurl <= fistThreshold) {
      primaryCue = 'Nice squeeze! Now burst open into a big star!';
    }

    return {
      phase,
      phaseProgress: progress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: scoreFromCheckpoints(checkpoints),
      primaryStatus,
      primaryCue,
      checkpoints,
      jointAngles: [
        {
          label: 'Fingers',
          angle: Math.round(m.avgCurl),
          x: landmarks[HAND_LANDMARK.MIDDLE_PIP].x,
          y: landmarks[HAND_LANDMARK.MIDDLE_PIP].y,
          status: rangeStatus,
        },
        {
          label: 'Splay',
          angle: Math.round(m.splayAngle),
          x: landmarks[HAND_LANDMARK.WRIST].x,
          y: landmarks[HAND_LANDMARK.WRIST].y,
          status: splayStatus,
        },
      ],
      highlightSegments: [
        ...segmentsWithStatus(FINGER_SEGMENTS, rangeStatus),
        ...segmentsWithStatus([[5, 9], [9, 13], [13, 17]], splayStatus),
      ],
      bodyVisible: true,
    };
  }

  private evalCrabPinch(landmarks: NormalizedLandmark[]): PoseAnalysisResult {
    const m = this.getFingerMetrics(landmarks);
    const pinchCloseMax =
      this.strictness === 'strict' ? 0.28 : this.strictness === 'beginner' ? 0.43 : 0.35;
    const pinchOpenMin =
      this.strictness === 'strict' ? 0.82 : this.strictness === 'beginner' ? 0.65 : 0.74;
    const supportMin =
      this.strictness === 'strict' ? 132 : this.strictness === 'beginner' ? 110 : 122;

    let repIncrement = false;
    if (this.phaseState === 'start') {
      if (m.pinchRatio <= pinchCloseMax) {
        this.phaseState = 'mid';
        this.reachedPeak = true;
      }
    } else if (this.phaseState === 'mid') {
      if (m.pinchRatio >= pinchOpenMin) {
        if (this.reachedPeak) {
          repIncrement = true;
        }
        this.phaseState = 'start';
        this.reachedPeak = false;
      }
    }

    const supportAvg = (m.middleAngle + m.ringAngle + m.pinkyAngle) / 3;
    const pinchPct = Math.round(m.pinchRatio * 100);
    const pinchTargetPct = Math.round(pinchCloseMax * 100);
    const openTargetPct = Math.round(pinchOpenMin * 100);

    const pinchStatus: FormSeverity =
      m.pinchRatio <= pinchCloseMax || m.pinchRatio >= pinchOpenMin
        ? 'good'
        : 'warn';

    const supportStatus: FormSeverity =
      supportAvg >= supportMin
        ? 'good'
        : supportAvg >= supportMin - 15
        ? 'warn'
        : 'error';

    const checkpoints: CheckpointStatus[] = [
      {
        id: 'pinch_gap',
        label: 'Crab Pinch Tap',
        targetText: `<= ${pinchTargetPct}% / >= ${openTargetPct}%`,
        currentValueText: `${pinchPct}%`,
        status: pinchStatus,
        feedback:
          m.pinchRatio <= pinchCloseMax
            ? 'Snap! Clean thumb-to-index O-ring pinch—now open wide!'
            : m.pinchRatio >= pinchOpenMin
            ? 'Claw open—touch thumb tip and pointer fingertip gently.'
            : 'Keep tapping fingertips cleanly and opening wide.',
      },
      {
        id: 'relaxed_fingers',
        label: 'Relaxed Back Fingers',
        targetText: `>= ${supportMin}°`,
        currentValueText: `${Math.round(supportAvg)}°`,
        status: supportStatus,
        feedback:
          supportStatus === 'good'
            ? 'Great finger isolation—middle, ring, and pinky stay relaxed!'
            : 'Keep your other three fingers tall instead of curling into a fist.',
      },
    ];

    const primaryStatus = aggregateStatus(checkpoints);
    const phase =
      m.pinchRatio <= pinchCloseMax
        ? 'Crab Pinch Closed'
        : m.pinchRatio >= pinchOpenMin
        ? 'Claw Open'
        : 'Pinching';
    const progress = clamp((0.85 - m.pinchRatio) / 0.6, 0, 1);

    let primaryCue = 'Tap thumb tip and pointer finger into a neat crab claw O!';
    if (supportStatus === 'error') {
      primaryCue = 'Only pinch thumb and pointer—keep your other 3 fingers up!';
    } else if (m.pinchRatio <= pinchCloseMax) {
      primaryCue = 'Great pinch! Open your claw wide to finish the rep.';
    }

    const midPinchX =
      (landmarks[HAND_LANDMARK.THUMB_TIP].x + landmarks[HAND_LANDMARK.INDEX_TIP].x) / 2;
    const midPinchY =
      (landmarks[HAND_LANDMARK.THUMB_TIP].y + landmarks[HAND_LANDMARK.INDEX_TIP].y) / 2;

    return {
      phase,
      phaseProgress: progress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: scoreFromCheckpoints(checkpoints),
      primaryStatus,
      primaryCue,
      checkpoints,
      jointAngles: [
        {
          label: 'Pinch Gap',
          angle: pinchPct,
          x: midPinchX,
          y: midPinchY,
          status: pinchStatus,
        },
        {
          label: 'Other 3',
          angle: Math.round(supportAvg),
          x: landmarks[HAND_LANDMARK.RING_PIP].x,
          y: landmarks[HAND_LANDMARK.RING_PIP].y,
          status: supportStatus,
        },
      ],
      highlightSegments: [
        ...segmentsWithStatus(PINCH_SEGMENTS, pinchStatus),
        ...segmentsWithStatus(
          [
            [9, 10],
            [10, 11],
            [11, 12],
            [13, 14],
            [14, 15],
            [15, 16],
            [17, 18],
            [18, 19],
            [19, 20],
          ],
          supportStatus
        ),
      ],
      bodyVisible: true,
    };
  }

  private evalTendonGlide(landmarks: NormalizedLandmark[]): PoseAnalysisResult {
    const m = this.getFingerMetrics(landmarks);
    const fistMax =
      this.strictness === 'strict' ? 82 : this.strictness === 'beginner' ? 100 : 90;
    const extMin =
      this.strictness === 'strict' ? 158 : this.strictness === 'beginner' ? 145 : 152;
    const symMax =
      this.strictness === 'strict' ? 16 : this.strictness === 'beginner' ? 30 : 22;

    let repIncrement = false;
    if (this.phaseState === 'start') {
      if (m.avgCurl <= fistMax) {
        this.phaseState = 'mid';
        this.reachedPeak = true;
      }
    } else if (this.phaseState === 'mid') {
      if (m.avgCurl >= extMin) {
        if (this.reachedPeak) {
          repIncrement = true;
        }
        this.phaseState = 'start';
        this.reachedPeak = false;
      }
    }

    const extStatus: FormSeverity =
      m.avgCurl >= extMin ? 'good' : m.avgCurl <= fistMax ? 'good' : 'warn';

    const flexStatus: FormSeverity =
      m.avgCurl <= fistMax ? 'good' : m.avgCurl >= extMin ? 'good' : 'warn';

    const symStatus: FormSeverity =
      m.fingerSymmetry <= symMax
        ? 'good'
        : m.fingerSymmetry <= symMax + 10
        ? 'warn'
        : 'error';

    const checkpoints: CheckpointStatus[] = [
      {
        id: 'full_extension',
        label: 'Straight Finger Glide',
        targetText: `>= ${extMin}°`,
        currentValueText: `${Math.round(m.avgCurl)}°`,
        status: extStatus,
        feedback:
          m.avgCurl >= extMin
            ? 'Full straight tendon extension reached.'
            : m.avgCurl <= fistMax
            ? 'Full fist curl reached—now glide smoothly to straight fingers.'
            : 'Glide smoothly all the way to straight fingers or full fist.',
      },
      {
        id: 'fist_flexion',
        label: 'Full Fist Curl',
        targetText: `<= ${fistMax}°`,
        currentValueText: `${Math.round(m.avgCurl)}°`,
        status: flexStatus,
        feedback:
          m.avgCurl <= fistMax
            ? 'Controlled full flexion achieved without tension.'
            : 'Curl fingertips gently into the center of your palm.',
      },
      {
        id: 'glide_symmetry',
        label: '4-Finger Curl Symmetry',
        targetText: `<= ${symMax}° spread`,
        currentValueText: `${Math.round(m.fingerSymmetry)}°`,
        status: symStatus,
        feedback:
          symStatus === 'good'
            ? 'All four flexor tendons gliding evenly.'
            : 'Keep pinky and ring finger aligned with index and middle.',
      },
    ];

    const primaryStatus = aggregateStatus(checkpoints);
    const phase =
      m.avgCurl <= fistMax
        ? 'Full Fist'
        : m.avgCurl >= extMin
        ? 'Straight Extension'
        : 'Tendon Glide';
    const progress = clamp((165 - m.avgCurl) / 90, 0, 1);

    let primaryCue = 'Glide slowly from straight fingers to a soft full fist.';
    if (symStatus === 'error') {
      primaryCue = 'Keep all four fingers curling at the same pace.';
    } else if (m.avgCurl <= fistMax) {
      primaryCue = 'Clean fist—smoothly lengthen fingers back to straight.';
    }

    return {
      phase,
      phaseProgress: progress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: scoreFromCheckpoints(checkpoints),
      primaryStatus,
      primaryCue,
      checkpoints,
      jointAngles: [
        {
          label: 'Index',
          angle: Math.round(m.indexAngle),
          x: landmarks[HAND_LANDMARK.INDEX_PIP].x,
          y: landmarks[HAND_LANDMARK.INDEX_PIP].y,
          status: extStatus,
        },
        {
          label: 'Ring',
          angle: Math.round(m.ringAngle),
          x: landmarks[HAND_LANDMARK.RING_PIP].x,
          y: landmarks[HAND_LANDMARK.RING_PIP].y,
          status: symStatus,
        },
      ],
      highlightSegments: [
        ...segmentsWithStatus(FINGER_SEGMENTS, symStatus),
        ...segmentsWithStatus([[0, 5], [0, 9], [0, 13], [0, 17]], extStatus),
      ],
      bodyVisible: true,
    };
  }

  private evalWristFanHold(landmarks: NormalizedLandmark[]): PoseAnalysisResult {
    const m = this.getFingerMetrics(landmarks);
    const splayMin =
      this.strictness === 'strict' ? 37 : this.strictness === 'beginner' ? 27 : 32;
    const extMin =
      this.strictness === 'strict' ? 154 : this.strictness === 'beginner' ? 140 : 148;
    const symMax =
      this.strictness === 'strict' ? 16 : this.strictness === 'beginner' ? 28 : 22;

    const splayStatus: FormSeverity =
      m.splayAngle >= splayMin
        ? 'good'
        : m.splayAngle >= splayMin - 6
        ? 'warn'
        : 'error';

    const extStatus: FormSeverity =
      m.avgCurl >= extMin
        ? 'good'
        : m.avgCurl >= extMin - 12
        ? 'warn'
        : 'error';

    const symStatus: FormSeverity =
      m.fingerSymmetry <= symMax
        ? 'good'
        : m.fingerSymmetry <= symMax + 10
        ? 'warn'
        : 'error';

    const holdActive = splayStatus !== 'error' && extStatus !== 'error';

    const checkpoints: CheckpointStatus[] = [
      {
        id: 'fan_spread',
        label: 'Wide Finger Fan',
        targetText: `>= ${splayMin}°`,
        currentValueText: `${Math.round(m.splayAngle)}°`,
        status: splayStatus,
        feedback:
          splayStatus === 'good'
            ? 'Wide isometric finger spread held cleanly.'
            : 'Abduct fingers wider apart to open the palmar fascia.',
      },
      {
        id: 'finger_lock',
        label: 'Straight Finger Hold',
        targetText: `>= ${extMin}°`,
        currentValueText: `${Math.round(m.avgCurl)}°`,
        status: extStatus,
        feedback:
          extStatus === 'good'
            ? 'Fingers extended straight without clawing.'
            : 'Lengthen fingertips straight toward the ceiling.',
      },
      {
        id: 'even_extension',
        label: 'Balanced Finger Line',
        targetText: `<= ${symMax}° diff`,
        currentValueText: `${Math.round(m.fingerSymmetry)}°`,
        status: symStatus,
        feedback:
          symStatus === 'good'
            ? 'Balanced finger extension across the whole hand.'
            : 'Straighten your ring and pinky fingers evenly.',
      },
    ];

    const primaryStatus = aggregateStatus(checkpoints);
    let primaryCue = 'Hold wide open hand steady—breathe slowly.';
    if (splayStatus === 'error') {
      primaryCue = 'Widen the gap between every finger to start the hold timer.';
    } else if (extStatus === 'error') {
      primaryCue = 'Straighten all four fingers fully without bending knuckles.';
    }

    return {
      phase: holdActive ? 'Active Fan Hold' : 'Open & Widen Fingers',
      phaseProgress: holdActive ? 1 : clamp(m.splayAngle / splayMin, 0.1, 0.8),
      repIncrement: false,
      isHoldExercise: true,
      holdActive,
      formScore: scoreFromCheckpoints(checkpoints),
      primaryStatus,
      primaryCue,
      checkpoints,
      jointAngles: [
        {
          label: 'Fan',
          angle: Math.round(m.splayAngle),
          x: landmarks[HAND_LANDMARK.WRIST].x,
          y: landmarks[HAND_LANDMARK.WRIST].y,
          status: splayStatus,
        },
        {
          label: 'Straight',
          angle: Math.round(m.avgCurl),
          x: landmarks[HAND_LANDMARK.MIDDLE_PIP].x,
          y: landmarks[HAND_LANDMARK.MIDDLE_PIP].y,
          status: extStatus,
        },
      ],
      highlightSegments: [
        ...segmentsWithStatus(FINGER_SEGMENTS, extStatus),
        ...segmentsWithStatus([[5, 9], [9, 13], [13, 17]], splayStatus),
      ],
      bodyVisible: true,
    };
  }
}
