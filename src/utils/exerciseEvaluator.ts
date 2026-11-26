import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  CheckpointStatus,
  ExerciseId,
  FormSeverity,
  HighlightSegment,
  JointAngleOverlay,
  PoseAnalysisResult,
  StrictnessLevel,
} from '../types/exercise';
import {
  areLandmarksVisible,
  calculateAngle,
  calculateBodyLineDeviation,
  calculateVerticalTilt,
  getSideIndices,
  pickDominantSide,
  POSE_LANDMARK,
} from './poseGeometry';

interface ToleranceProfile {
  squatBottomMax: number;
  squatTorsoMax: number;
  squatTopMin: number;
  pushupBottomMax: number;
  pushupLineMin: number;
  pushupTopMin: number;
  pressTopMin: number;
  pressRackMax: number;
  pressSymmetryMax: number;
  curlPeakMax: number;
  curlDriftMax: number;
  curlBottomMin: number;
  lungeBottomMax: number;
  lungeTorsoMax: number;
  lungeTopMin: number;
  plankLineMin: number;
  plankElbowMin: number;
  plankElbowMax: number;
}

const TOLERANCES: Record<StrictnessLevel, ToleranceProfile> = {
  beginner: {
    squatBottomMax: 112,
    squatTorsoMax: 48,
    squatTopMin: 155,
    pushupBottomMax: 108,
    pushupLineMin: 154,
    pushupTopMin: 152,
    pressTopMin: 150,
    pressRackMax: 108,
    pressSymmetryMax: 0.08,
    curlPeakMax: 60,
    curlDriftMax: 28,
    curlBottomMin: 146,
    lungeBottomMax: 112,
    lungeTorsoMax: 30,
    lungeTopMin: 154,
    plankLineMin: 156,
    plankElbowMin: 68,
    plankElbowMax: 114,
  },
  standard: {
    squatBottomMax: 102,
    squatTorsoMax: 40,
    squatTopMin: 162,
    pushupBottomMax: 98,
    pushupLineMin: 162,
    pushupTopMin: 158,
    pressTopMin: 158,
    pressRackMax: 98,
    pressSymmetryMax: 0.055,
    curlPeakMax: 50,
    curlDriftMax: 22,
    curlBottomMin: 152,
    lungeBottomMax: 102,
    lungeTorsoMax: 24,
    lungeTopMin: 160,
    plankLineMin: 164,
    plankElbowMin: 74,
    plankElbowMax: 106,
  },
  strict: {
    squatBottomMax: 92,
    squatTorsoMax: 32,
    squatTopMin: 168,
    pushupBottomMax: 90,
    pushupLineMin: 168,
    pushupTopMin: 164,
    pressTopMin: 165,
    pressRackMax: 90,
    pressSymmetryMax: 0.038,
    curlPeakMax: 42,
    curlDriftMax: 16,
    curlBottomMin: 158,
    lungeBottomMax: 94,
    lungeTorsoMax: 18,
    lungeTopMin: 165,
    plankLineMin: 170,
    plankElbowMin: 80,
    plankElbowMax: 100,
  },
};

type RepState = 'ready' | 'eccentric' | 'bottom' | 'concentric';

export class ExerciseEvaluator {
  private exerciseId: ExerciseId;
  private strictness: StrictnessLevel;
  private repState: RepState = 'ready';
  private reachedTargetBottom = false;
  private minAngleInRep = 180;
  private maxAngleInRep = 0;

  constructor(exerciseId: ExerciseId, strictness: StrictnessLevel = 'standard') {
    this.exerciseId = exerciseId;
    this.strictness = strictness;
  }

  setExercise(exerciseId: ExerciseId) {
    if (this.exerciseId !== exerciseId) {
      this.exerciseId = exerciseId;
      this.resetRepState();
    }
  }

  setStrictness(strictness: StrictnessLevel) {
    this.strictness = strictness;
  }

  resetRepState() {
    this.repState = 'ready';
    this.reachedTargetBottom = false;
    this.minAngleInRep = 180;
    this.maxAngleInRep = 0;
  }

  evaluate(landmarks: NormalizedLandmark[]): PoseAnalysisResult {
    const tol = TOLERANCES[this.strictness];

    switch (this.exerciseId) {
      case 'squat':
        return this.evaluateSquat(landmarks, tol);
      case 'pushup':
        return this.evaluatePushup(landmarks, tol);
      case 'overhead_press':
        return this.evaluateOverheadPress(landmarks, tol);
      case 'bicep_curl':
        return this.evaluateBicepCurl(landmarks, tol);
      case 'lunge':
        return this.evaluateLunge(landmarks, tol);
      case 'plank':
        return this.evaluatePlank(landmarks, tol);
      case 'jumping_jacks':
        return this.evaluateJumpingJacks(landmarks, tol);
      case 'tree_pose':
        return this.evaluateTreePose(landmarks);
      case 'frog_squat':
        return this.evaluateFrogSquat(landmarks, tol);
      case 'superhero_raise':
        return this.evaluateSuperheroRaise(landmarks, tol);
      default:
        return this.noBodyResult(false, 'Switch to hand sensor mode to track this exercise.');
    }
  }

  private noBodyResult(isHold: boolean, hint: string): PoseAnalysisResult {
    return {
      phase: 'Waiting for Pose',
      phaseProgress: 0,
      repIncrement: false,
      isHoldExercise: isHold,
      holdActive: false,
      formScore: 0,
      primaryStatus: 'waiting',
      primaryCue: hint,
      checkpoints: [],
      jointAngles: [],
      highlightSegments: [],
      bodyVisible: false,
      visibilityHint: hint,
    };
  }

  private evaluateSquat(
    landmarks: NormalizedLandmark[],
    tol: ToleranceProfile
  ): PoseAnalysisResult {
    const side = pickDominantSide(landmarks);
    const idx = getSideIndices(side);
    const visible = areLandmarksVisible(landmarks, [
      idx.shoulder,
      idx.hip,
      idx.knee,
      idx.ankle,
    ]);

    if (!visible) {
      return this.noBodyResult(
        false,
        'Step back so shoulders, hips, knees, and ankles are visible.'
      );
    }

    const shoulder = landmarks[idx.shoulder];
    const hip = landmarks[idx.hip];
    const knee = landmarks[idx.knee];
    const ankle = landmarks[idx.ankle];

    const kneeAngle = calculateAngle(hip, knee, ankle);
    const hipAngle = calculateAngle(shoulder, hip, knee);
    const torsoLean = calculateVerticalTilt(shoulder, hip);

    let repIncrement = false;
    let phase = 'Standing Ready';

    if (this.repState === 'ready') {
      if (kneeAngle < tol.squatTopMin - 12) {
        this.repState = 'eccentric';
        this.minAngleInRep = kneeAngle;
        this.reachedTargetBottom = false;
      }
    } else if (this.repState === 'eccentric') {
      this.minAngleInRep = Math.min(this.minAngleInRep, kneeAngle);
      if (kneeAngle <= tol.squatBottomMax) {
        this.reachedTargetBottom = true;
        this.repState = 'bottom';
      } else if (kneeAngle >= tol.squatTopMin) {
        // Returned up without hitting target depth
        this.repState = 'ready';
      }
    } else if (this.repState === 'bottom') {
      this.minAngleInRep = Math.min(this.minAngleInRep, kneeAngle);
      if (kneeAngle > tol.squatBottomMax + 10) {
        this.repState = 'concentric';
      }
    } else if (this.repState === 'concentric') {
      if (kneeAngle >= tol.squatTopMin) {
        if (this.reachedTargetBottom) {
          repIncrement = true;
        }
        this.repState = 'ready';
        this.reachedTargetBottom = false;
      } else if (kneeAngle <= tol.squatBottomMax) {
        this.repState = 'bottom';
      }
    }

    if (this.repState === 'eccentric') phase = 'Lowering';
    else if (this.repState === 'bottom') phase = 'Bottom Depth';
    else if (this.repState === 'concentric') phase = 'Driving Up';
    else phase = 'Standing Ready';

    const depthGood = kneeAngle <= tol.squatBottomMax;
    const torsoGood = torsoLean <= tol.squatTorsoMax;
    const lockoutGood = kneeAngle >= tol.squatTopMin;

    const depthStatus: FormSeverity =
      this.repState === 'ready'
        ? 'waiting'
        : depthGood
        ? 'good'
        : kneeAngle <= tol.squatBottomMax + 14
        ? 'warn'
        : 'warn';

    const torsoStatus: FormSeverity = torsoGood
      ? 'good'
      : torsoLean <= tol.squatTorsoMax + 10
      ? 'warn'
      : 'error';

    const lockoutStatus: FormSeverity = lockoutGood
      ? 'good'
      : this.repState === 'ready'
      ? 'warn'
      : 'waiting';

    let score = 100;
    if (!torsoGood) score -= torsoStatus === 'error' ? 28 : 14;
    if (this.repState === 'bottom' && !depthGood) score -= 18;
    if (repIncrement) score = Math.max(score, 92);
    score = Math.max(40, Math.min(100, Math.round(score)));

    let primaryStatus: FormSeverity = 'good';
    let primaryCue = 'Solid posture — bend knees and sit hips back.';

    if (torsoStatus === 'error') {
      primaryStatus = 'error';
      primaryCue = 'Chest dropping — keep torso upright and core braced.';
    } else if (torsoStatus === 'warn') {
      primaryStatus = 'warn';
      primaryCue = 'Lift chest slightly to reduce forward torso lean.';
    } else if (repIncrement) {
      primaryStatus = 'good';
      primaryCue = 'Clean rep! Full depth and strong lockout.';
    } else if (this.repState === 'bottom' || depthGood) {
      primaryStatus = 'good';
      primaryCue = 'Depth hit — drive through heels back to standing.';
    } else if (this.repState === 'eccentric') {
      primaryStatus = 'warn';
      primaryCue = 'Keep lowering until thighs reach parallel.';
    } else if (this.repState === 'concentric') {
      primaryStatus = 'good';
      primaryCue = 'Push hips forward to full standing lockout.';
    }

    const phaseProgress = Math.max(
      0,
      Math.min(1, (175 - kneeAngle) / (175 - tol.squatBottomMax))
    );

    const checkpoints: CheckpointStatus[] = [
      {
        id: 'knee_depth',
        label: 'Squat Depth',
        targetText: `≤ ${tol.squatBottomMax}°`,
        currentValueText: `${Math.round(kneeAngle)}°`,
        status: depthStatus,
        feedback: depthGood
          ? 'Parallel or deeper reached'
          : 'Lower hips closer to knee level',
      },
      {
        id: 'torso_lean',
        label: 'Torso Alignment',
        targetText: `≤ ${tol.squatTorsoMax}° lean`,
        currentValueText: `${Math.round(torsoLean)}°`,
        status: torsoStatus,
        feedback: torsoGood
          ? 'Chest upright & spine neutral'
          : 'Avoid collapsing chest forward',
      },
      {
        id: 'hip_extension',
        label: 'Top Lockout',
        targetText: `≥ ${tol.squatTopMin}°`,
        currentValueText: `${Math.round(kneeAngle)}°`,
        status: lockoutStatus,
        feedback: lockoutGood
          ? 'Full standing extension'
          : 'Stand tall to finish rep',
      },
    ];

    const jointAngles: JointAngleOverlay[] = [
      {
        label: 'Knee',
        angle: Math.round(kneeAngle),
        x: knee.x,
        y: knee.y,
        status: depthGood ? 'good' : torsoStatus === 'error' ? 'warn' : 'good',
      },
      {
        label: 'Hip',
        angle: Math.round(hipAngle),
        x: hip.x,
        y: hip.y,
        status: torsoStatus,
      },
    ];

    const highlightSegments: HighlightSegment[] = [
      { from: idx.shoulder, to: idx.hip, status: torsoStatus },
      { from: idx.hip, to: idx.knee, status: depthGood ? 'good' : 'warn' },
      { from: idx.knee, to: idx.ankle, status: depthGood ? 'good' : 'warn' },
    ];

    return {
      phase,
      phaseProgress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: score,
      primaryStatus,
      primaryCue,
      checkpoints,
      jointAngles,
      highlightSegments,
      bodyVisible: true,
    };
  }

  private evaluatePushup(
    landmarks: NormalizedLandmark[],
    tol: ToleranceProfile
  ): PoseAnalysisResult {
    const side = pickDominantSide(landmarks);
    const idx = getSideIndices(side);
    const visible = areLandmarksVisible(landmarks, [
      idx.shoulder,
      idx.elbow,
      idx.wrist,
      idx.hip,
      idx.ankle,
    ]);

    if (!visible) {
      return this.noBodyResult(
        false,
        'Position camera low on your side so wrists, shoulders, hips, and ankles are visible.'
      );
    }

    const shoulder = landmarks[idx.shoulder];
    const elbow = landmarks[idx.elbow];
    const wrist = landmarks[idx.wrist];
    const hip = landmarks[idx.hip];
    const ankle = landmarks[idx.ankle];

    const elbowAngle = calculateAngle(shoulder, elbow, wrist);
    const bodyLineAngle = calculateAngle(shoulder, hip, ankle);
    const bodyDev = calculateBodyLineDeviation(shoulder, hip, ankle);

    let repIncrement = false;
    if (this.repState === 'ready') {
      if (elbowAngle < tol.pushupTopMin - 12) {
        this.repState = 'eccentric';
        this.reachedTargetBottom = false;
      }
    } else if (this.repState === 'eccentric') {
      if (elbowAngle <= tol.pushupBottomMax) {
        this.reachedTargetBottom = true;
        this.repState = 'bottom';
      } else if (elbowAngle >= tol.pushupTopMin) {
        this.repState = 'ready';
      }
    } else if (this.repState === 'bottom') {
      if (elbowAngle > tol.pushupBottomMax + 10) {
        this.repState = 'concentric';
      }
    } else if (this.repState === 'concentric') {
      if (elbowAngle >= tol.pushupTopMin) {
        if (this.reachedTargetBottom && bodyLineAngle >= tol.pushupLineMin - 8) {
          repIncrement = true;
        }
        this.repState = 'ready';
        this.reachedTargetBottom = false;
      } else if (elbowAngle <= tol.pushupBottomMax) {
        this.repState = 'bottom';
      }
    }

    const phase =
      this.repState === 'eccentric'
        ? 'Lowering Chest'
        : this.repState === 'bottom'
        ? 'Bottom Hover'
        : this.repState === 'concentric'
        ? 'Pressing Up'
        : 'High Plank Ready';

    const lineGood = bodyLineAngle >= tol.pushupLineMin;
    const lineStatus: FormSeverity = lineGood
      ? 'good'
      : bodyLineAngle >= tol.pushupLineMin - 10
      ? 'warn'
      : 'error';
    const depthGood = elbowAngle <= tol.pushupBottomMax;
    const depthStatus: FormSeverity =
      this.repState === 'ready' ? 'waiting' : depthGood ? 'good' : 'warn';
    const lockoutGood = elbowAngle >= tol.pushupTopMin;

    let score = 100;
    if (!lineGood) score -= lineStatus === 'error' ? 30 : 15;
    if (this.repState === 'bottom' && !depthGood) score -= 18;
    score = Math.max(35, Math.min(100, Math.round(score)));

    let primaryStatus: FormSeverity = 'good';
    let primaryCue = 'Plank alignment solid — lower chest with elbows at 45°.';

    if (lineStatus === 'error') {
      primaryStatus = 'error';
      primaryCue =
        bodyDev > 0
          ? 'Hips sagging — brace abs and squeeze glutes!'
          : 'Hips too high — flatten your back into a plank.';
    } else if (lineStatus === 'warn') {
      primaryStatus = 'warn';
      primaryCue = 'Keep hips aligned between shoulders and ankles.';
    } else if (repIncrement) {
      primaryStatus = 'good';
      primaryCue = 'Great push-up! Clean depth and plank stability.';
    } else if (depthGood || this.repState === 'bottom') {
      primaryStatus = 'good';
      primaryCue = 'Depth hit — press evenly to full arm extension.';
    } else if (this.repState === 'eccentric') {
      primaryStatus = 'warn';
      primaryCue = 'Lower slightly deeper toward ~90° elbow bend.';
    }

    const phaseProgress = Math.max(
      0,
      Math.min(1, (172 - elbowAngle) / (172 - tol.pushupBottomMax))
    );

    return {
      phase,
      phaseProgress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: score,
      primaryStatus,
      primaryCue,
      checkpoints: [
        {
          id: 'elbow_depth',
          label: 'Push-Up Depth',
          targetText: `≤ ${tol.pushupBottomMax}°`,
          currentValueText: `${Math.round(elbowAngle)}°`,
          status: depthStatus,
          feedback: depthGood ? 'Full chest depth reached' : 'Bend elbows closer to 90°',
        },
        {
          id: 'body_line',
          label: 'Plank Body Line',
          targetText: `≥ ${tol.pushupLineMin}°`,
          currentValueText: `${Math.round(bodyLineAngle)}°`,
          status: lineStatus,
          feedback: lineGood
            ? 'Straight shoulder-hip-ankle line'
            : bodyDev > 0
            ? 'Hips sagging downward'
            : 'Hips piked upward',
        },
        {
          id: 'arm_lockout',
          label: 'Top Lockout',
          targetText: `≥ ${tol.pushupTopMin}°`,
          currentValueText: `${Math.round(elbowAngle)}°`,
          status: lockoutGood ? 'good' : this.repState === 'ready' ? 'warn' : 'waiting',
          feedback: lockoutGood ? 'Arms locked at top' : 'Press to full extension',
        },
      ],
      jointAngles: [
        {
          label: 'Elbow',
          angle: Math.round(elbowAngle),
          x: elbow.x,
          y: elbow.y,
          status: depthGood ? 'good' : 'warn',
        },
        {
          label: 'Body Line',
          angle: Math.round(bodyLineAngle),
          x: hip.x,
          y: hip.y,
          status: lineStatus,
        },
      ],
      highlightSegments: [
        { from: idx.shoulder, to: idx.elbow, status: depthGood ? 'good' : 'warn' },
        { from: idx.elbow, to: idx.wrist, status: depthGood ? 'good' : 'warn' },
        { from: idx.shoulder, to: idx.hip, status: lineStatus },
        { from: idx.hip, to: idx.ankle, status: lineStatus },
      ],
      bodyVisible: true,
    };
  }

  private evaluateOverheadPress(
    landmarks: NormalizedLandmark[],
    tol: ToleranceProfile
  ): PoseAnalysisResult {
    const visible = areLandmarksVisible(landmarks, [
      POSE_LANDMARK.LEFT_SHOULDER,
      POSE_LANDMARK.RIGHT_SHOULDER,
      POSE_LANDMARK.LEFT_ELBOW,
      POSE_LANDMARK.RIGHT_ELBOW,
      POSE_LANDMARK.LEFT_WRIST,
      POSE_LANDMARK.RIGHT_WRIST,
      POSE_LANDMARK.LEFT_HIP,
      POSE_LANDMARK.RIGHT_HIP,
    ]);

    if (!visible) {
      return this.noBodyResult(
        false,
        'Face the camera directly with space above your head for full overhead lockout.'
      );
    }

    const lShoulder = landmarks[POSE_LANDMARK.LEFT_SHOULDER];
    const rShoulder = landmarks[POSE_LANDMARK.RIGHT_SHOULDER];
    const lElbow = landmarks[POSE_LANDMARK.LEFT_ELBOW];
    const rElbow = landmarks[POSE_LANDMARK.RIGHT_ELBOW];
    const lWrist = landmarks[POSE_LANDMARK.LEFT_WRIST];
    const rWrist = landmarks[POSE_LANDMARK.RIGHT_WRIST];

    const lAngle = calculateAngle(lShoulder, lElbow, lWrist);
    const rAngle = calculateAngle(rShoulder, rElbow, rWrist);
    const avgAngle = (lAngle + rAngle) / 2;

    const wristsOverhead = lWrist.y < lShoulder.y - 0.1 && rWrist.y < rShoulder.y - 0.1;
    const wristDiff = Math.abs(lWrist.y - rWrist.y);
    const symGood = wristDiff <= tol.pressSymmetryMax;

    // For press, ready = rack (low angle), peak = overhead lockout (high angle + wrists overhead)
    let repIncrement = false;
    if (this.repState === 'ready') {
      if (avgAngle > tol.pressRackMax + 12 && lWrist.y < lShoulder.y) {
        this.repState = 'concentric';
        this.reachedTargetBottom = false;
      }
    } else if (this.repState === 'concentric') {
      if (avgAngle >= tol.pressTopMin && wristsOverhead) {
        this.reachedTargetBottom = true;
        this.repState = 'bottom'; // peak overhead
      } else if (avgAngle <= tol.pressRackMax) {
        this.repState = 'ready';
      }
    } else if (this.repState === 'bottom') {
      if (avgAngle < tol.pressTopMin - 12) {
        this.repState = 'eccentric';
      }
    } else if (this.repState === 'eccentric') {
      if (avgAngle <= tol.pressRackMax) {
        if (this.reachedTargetBottom) {
          repIncrement = true;
        }
        this.repState = 'ready';
        this.reachedTargetBottom = false;
      } else if (avgAngle >= tol.pressTopMin && wristsOverhead) {
        this.repState = 'bottom';
      }
    }

    const phase =
      this.repState === 'concentric'
        ? 'Pressing Overhead'
        : this.repState === 'bottom'
        ? 'Overhead Lockout'
        : this.repState === 'eccentric'
        ? 'Lowering to Rack'
        : 'Shoulder Rack Ready';

    const lockoutGood = avgAngle >= tol.pressTopMin && wristsOverhead;
    const rackGood = avgAngle <= tol.pressRackMax;
    const symStatus: FormSeverity = symGood
      ? 'good'
      : wristDiff <= tol.pressSymmetryMax * 1.6
      ? 'warn'
      : 'error';

    let score = 100;
    if (!symGood) score -= symStatus === 'error' ? 25 : 12;
    if (this.repState === 'bottom' && !lockoutGood) score -= 18;
    score = Math.max(40, Math.min(100, Math.round(score)));

    let primaryStatus: FormSeverity = 'good';
    let primaryCue = 'Rack position set — press both hands evenly overhead.';
    if (symStatus === 'error') {
      primaryStatus = 'error';
      primaryCue =
        lWrist.y < rWrist.y
          ? 'Right arm lagging — keep both wrists level.'
          : 'Left arm lagging — keep both wrists level.';
    } else if (repIncrement) {
      primaryStatus = 'good';
      primaryCue = 'Clean overhead rep! Balanced press and controlled return.';
    } else if (lockoutGood) {
      primaryStatus = 'good';
      primaryCue = 'Overhead lockout reached — lower slowly to shoulders.';
    } else if (this.repState === 'concentric') {
      primaryStatus = 'warn';
      primaryCue = 'Extend elbows all the way overhead.';
    }

    const phaseProgress = Math.max(
      0,
      Math.min(1, (avgAngle - tol.pressRackMax) / (tol.pressTopMin - tol.pressRackMax))
    );

    return {
      phase,
      phaseProgress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: score,
      primaryStatus,
      primaryCue,
      checkpoints: [
        {
          id: 'overhead_lockout',
          label: 'Overhead Lockout',
          targetText: `≥ ${tol.pressTopMin}°`,
          currentValueText: `${Math.round(avgAngle)}°`,
          status: lockoutGood ? 'good' : this.repState === 'ready' ? 'waiting' : 'warn',
          feedback: lockoutGood ? 'Full overhead extension' : 'Press arms straight overhead',
        },
        {
          id: 'arm_symmetry',
          label: 'Left / Right Balance',
          targetText: 'Even wrist height',
          currentValueText: `${Math.round(wristDiff * 100)}% delta`,
          status: symStatus,
          feedback: symGood ? 'Both arms pressing symmetrically' : 'Level out left and right hands',
        },
        {
          id: 'rack_bottom',
          label: 'Rack Return',
          targetText: `≤ ${tol.pressRackMax}°`,
          currentValueText: `${Math.round(avgAngle)}°`,
          status: rackGood ? 'good' : 'waiting',
          feedback: rackGood ? 'Returned cleanly to rack' : 'Lower hands to shoulder height',
        },
      ],
      jointAngles: [
        {
          label: 'L Elbow',
          angle: Math.round(lAngle),
          x: lElbow.x,
          y: lElbow.y,
          status: symStatus === 'error' ? 'warn' : 'good',
        },
        {
          label: 'R Elbow',
          angle: Math.round(rAngle),
          x: rElbow.x,
          y: rElbow.y,
          status: symStatus === 'error' ? 'warn' : 'good',
        },
      ],
      highlightSegments: [
        { from: POSE_LANDMARK.LEFT_SHOULDER, to: POSE_LANDMARK.LEFT_ELBOW, status: symStatus },
        { from: POSE_LANDMARK.LEFT_ELBOW, to: POSE_LANDMARK.LEFT_WRIST, status: symStatus },
        { from: POSE_LANDMARK.RIGHT_SHOULDER, to: POSE_LANDMARK.RIGHT_ELBOW, status: symStatus },
        { from: POSE_LANDMARK.RIGHT_ELBOW, to: POSE_LANDMARK.RIGHT_WRIST, status: symStatus },
      ],
      bodyVisible: true,
    };
  }

  private evaluateBicepCurl(
    landmarks: NormalizedLandmark[],
    tol: ToleranceProfile
  ): PoseAnalysisResult {
    const side = pickDominantSide(landmarks);
    const idx = getSideIndices(side);
    const visible = areLandmarksVisible(landmarks, [
      idx.shoulder,
      idx.elbow,
      idx.wrist,
      idx.hip,
    ]);

    if (!visible) {
      return this.noBodyResult(
        false,
        'Stand sideways to the camera so shoulder, elbow, wrist, and hip stay in frame.'
      );
    }

    const shoulder = landmarks[idx.shoulder];
    const elbow = landmarks[idx.elbow];
    const wrist = landmarks[idx.wrist];

    const elbowAngle = calculateAngle(shoulder, elbow, wrist);
    const upperArmDrift = calculateVerticalTilt(shoulder, elbow);

    let repIncrement = false;
    if (this.repState === 'ready') {
      if (elbowAngle < tol.curlBottomMin - 15) {
        this.repState = 'concentric';
        this.reachedTargetBottom = false;
      }
    } else if (this.repState === 'concentric') {
      if (elbowAngle <= tol.curlPeakMax) {
        this.reachedTargetBottom = true;
        this.repState = 'bottom'; // peak contraction
      } else if (elbowAngle >= tol.curlBottomMin) {
        this.repState = 'ready';
      }
    } else if (this.repState === 'bottom') {
      if (elbowAngle > tol.curlPeakMax + 12) {
        this.repState = 'eccentric';
      }
    } else if (this.repState === 'eccentric') {
      if (elbowAngle >= tol.curlBottomMin) {
        if (this.reachedTargetBottom) {
          repIncrement = true;
        }
        this.repState = 'ready';
        this.reachedTargetBottom = false;
      } else if (elbowAngle <= tol.curlPeakMax) {
        this.repState = 'bottom';
      }
    }

    const phase =
      this.repState === 'concentric'
        ? 'Curling Up'
        : this.repState === 'bottom'
        ? 'Peak Squeeze'
        : this.repState === 'eccentric'
        ? 'Lowering Slowly'
        : 'Full Extension';

    const peakGood = elbowAngle <= tol.curlPeakMax;
    const driftGood = upperArmDrift <= tol.curlDriftMax;
    const driftStatus: FormSeverity = driftGood
      ? 'good'
      : upperArmDrift <= tol.curlDriftMax + 10
      ? 'warn'
      : 'error';
    const extGood = elbowAngle >= tol.curlBottomMin;

    let score = 100;
    if (!driftGood) score -= driftStatus === 'error' ? 28 : 14;
    if (this.repState === 'bottom' && !peakGood) score -= 16;
    score = Math.max(40, Math.min(100, Math.round(score)));

    let primaryStatus: FormSeverity = 'good';
    let primaryCue = 'Elbow pinned at your ribs — curl smoothly upward.';
    if (driftStatus === 'error') {
      primaryStatus = 'error';
      primaryCue = 'Elbow swinging forward — pin upper arm to your torso.';
    } else if (driftStatus === 'warn') {
      primaryStatus = 'warn';
      primaryCue = 'Keep upper arm vertical without momentum.';
    } else if (repIncrement) {
      primaryStatus = 'good';
      primaryCue = 'Strict curl rep! Full squeeze and full extension.';
    } else if (peakGood || this.repState === 'bottom') {
      primaryStatus = 'good';
      primaryCue = 'Peak contraction hit — lower with control.';
    }

    const phaseProgress = Math.max(
      0,
      Math.min(1, (168 - elbowAngle) / (168 - tol.curlPeakMax))
    );

    return {
      phase,
      phaseProgress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: score,
      primaryStatus,
      primaryCue,
      checkpoints: [
        {
          id: 'peak_flexion',
          label: 'Peak Contraction',
          targetText: `≤ ${tol.curlPeakMax}°`,
          currentValueText: `${Math.round(elbowAngle)}°`,
          status: peakGood ? 'good' : this.repState === 'ready' ? 'waiting' : 'warn',
          feedback: peakGood ? 'Full bicep contraction' : 'Curl higher toward shoulder',
        },
        {
          id: 'upper_arm_pin',
          label: 'Upper Arm Stability',
          targetText: `≤ ${tol.curlDriftMax}° drift`,
          currentValueText: `${Math.round(upperArmDrift)}°`,
          status: driftStatus,
          feedback: driftGood ? 'Elbows pinned neatly by ribs' : 'Reduce forward elbow swing',
        },
        {
          id: 'full_extension',
          label: 'Bottom Extension',
          targetText: `≥ ${tol.curlBottomMin}°`,
          currentValueText: `${Math.round(elbowAngle)}°`,
          status: extGood ? 'good' : 'waiting',
          feedback: extGood ? 'Full bottom stretch' : 'Extend arm completely down',
        },
      ],
      jointAngles: [
        {
          label: 'Elbow',
          angle: Math.round(elbowAngle),
          x: elbow.x,
          y: elbow.y,
          status: peakGood ? 'good' : driftStatus,
        },
      ],
      highlightSegments: [
        { from: idx.shoulder, to: idx.elbow, status: driftStatus },
        { from: idx.elbow, to: idx.wrist, status: peakGood ? 'good' : 'warn' },
      ],
      bodyVisible: true,
    };
  }

  private evaluateLunge(
    landmarks: NormalizedLandmark[],
    tol: ToleranceProfile
  ): PoseAnalysisResult {
    const visible = areLandmarksVisible(landmarks, [
      POSE_LANDMARK.LEFT_HIP,
      POSE_LANDMARK.LEFT_KNEE,
      POSE_LANDMARK.LEFT_ANKLE,
      POSE_LANDMARK.RIGHT_HIP,
      POSE_LANDMARK.RIGHT_KNEE,
      POSE_LANDMARK.RIGHT_ANKLE,
      POSE_LANDMARK.LEFT_SHOULDER,
    ]);

    if (!visible) {
      return this.noBodyResult(
        false,
        'Stand sideways with extra floor space so both legs stay visible during the step.'
      );
    }

    const lKneeAngle = calculateAngle(
      landmarks[POSE_LANDMARK.LEFT_HIP],
      landmarks[POSE_LANDMARK.LEFT_KNEE],
      landmarks[POSE_LANDMARK.LEFT_ANKLE]
    );
    const rKneeAngle = calculateAngle(
      landmarks[POSE_LANDMARK.RIGHT_HIP],
      landmarks[POSE_LANDMARK.RIGHT_KNEE],
      landmarks[POSE_LANDMARK.RIGHT_ANKLE]
    );

    const activeSide = lKneeAngle <= rKneeAngle ? 'left' : 'right';
    const idx = getSideIndices(activeSide);
    const frontKneeAngle = Math.min(lKneeAngle, rKneeAngle);
    const torsoLean = calculateVerticalTilt(landmarks[idx.shoulder], landmarks[idx.hip]);

    let repIncrement = false;
    if (this.repState === 'ready') {
      if (frontKneeAngle < tol.lungeTopMin - 15) {
        this.repState = 'eccentric';
        this.reachedTargetBottom = false;
      }
    } else if (this.repState === 'eccentric') {
      if (frontKneeAngle <= tol.lungeBottomMax) {
        this.reachedTargetBottom = true;
        this.repState = 'bottom';
      } else if (frontKneeAngle >= tol.lungeTopMin) {
        this.repState = 'ready';
      }
    } else if (this.repState === 'bottom') {
      if (frontKneeAngle > tol.lungeBottomMax + 12) {
        this.repState = 'concentric';
      }
    } else if (this.repState === 'concentric') {
      if (frontKneeAngle >= tol.lungeTopMin) {
        if (this.reachedTargetBottom) {
          repIncrement = true;
        }
        this.repState = 'ready';
        this.reachedTargetBottom = false;
      } else if (frontKneeAngle <= tol.lungeBottomMax) {
        this.repState = 'bottom';
      }
    }

    const phase =
      this.repState === 'eccentric'
        ? 'Stepping & Dropping'
        : this.repState === 'bottom'
        ? '90/90 Bottom'
        : this.repState === 'concentric'
        ? 'Driving Back'
        : 'Standing Ready';

    const depthGood = frontKneeAngle <= tol.lungeBottomMax;
    const torsoGood = torsoLean <= tol.lungeTorsoMax;
    const torsoStatus: FormSeverity = torsoGood
      ? 'good'
      : torsoLean <= tol.lungeTorsoMax + 8
      ? 'warn'
      : 'error';
    const topGood = frontKneeAngle >= tol.lungeTopMin;

    let score = 100;
    if (!torsoGood) score -= torsoStatus === 'error' ? 28 : 14;
    if (this.repState === 'bottom' && !depthGood) score -= 18;
    score = Math.max(40, Math.min(100, Math.round(score)));

    let primaryStatus: FormSeverity = 'good';
    let primaryCue = 'Step forward and drop hips straight down with tall posture.';
    if (torsoStatus === 'error') {
      primaryStatus = 'error';
      primaryCue = 'Leaning too far forward — stack shoulders over hips.';
    } else if (repIncrement) {
      primaryStatus = 'good';
      primaryCue = 'Balanced lunge rep! Clean 90° drop and drive back.';
    } else if (depthGood || this.repState === 'bottom') {
      primaryStatus = 'good';
      primaryCue = '90° lunge depth hit — drive through front heel.';
    } else if (this.repState === 'eccentric') {
      primaryStatus = 'warn';
      primaryCue = 'Drop back knee slightly lower toward floor.';
    }

    const phaseProgress = Math.max(
      0,
      Math.min(1, (172 - frontKneeAngle) / (172 - tol.lungeBottomMax))
    );

    const activeKnee = landmarks[idx.knee];

    return {
      phase,
      phaseProgress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: score,
      primaryStatus,
      primaryCue,
      checkpoints: [
        {
          id: 'front_knee',
          label: 'Lead Knee Depth',
          targetText: `≤ ${tol.lungeBottomMax}°`,
          currentValueText: `${Math.round(frontKneeAngle)}°`,
          status: this.repState === 'ready' ? 'waiting' : depthGood ? 'good' : 'warn',
          feedback: depthGood ? '90° lunge depth achieved' : 'Lower hips straight down',
        },
        {
          id: 'upright_torso',
          label: 'Upright Posture',
          targetText: `≤ ${tol.lungeTorsoMax}° lean`,
          currentValueText: `${Math.round(torsoLean)}°`,
          status: torsoStatus,
          feedback: torsoGood ? 'Torso upright over hips' : 'Keep chest stacked above pelvis',
        },
        {
          id: 'standing_return',
          label: 'Return Extension',
          targetText: `≥ ${tol.lungeTopMin}°`,
          currentValueText: `${Math.round(frontKneeAngle)}°`,
          status: topGood ? 'good' : 'waiting',
          feedback: topGood ? 'Standing tall' : 'Return to starting stance',
        },
      ],
      jointAngles: [
        {
          label: 'Lead Knee',
          angle: Math.round(frontKneeAngle),
          x: activeKnee.x,
          y: activeKnee.y,
          status: depthGood ? 'good' : 'warn',
        },
      ],
      highlightSegments: [
        { from: idx.shoulder, to: idx.hip, status: torsoStatus },
        { from: idx.hip, to: idx.knee, status: depthGood ? 'good' : 'warn' },
        { from: idx.knee, to: idx.ankle, status: depthGood ? 'good' : 'warn' },
      ],
      bodyVisible: true,
    };
  }

  private evaluatePlank(
    landmarks: NormalizedLandmark[],
    tol: ToleranceProfile
  ): PoseAnalysisResult {
    const side = pickDominantSide(landmarks);
    const idx = getSideIndices(side);
    const visible = areLandmarksVisible(landmarks, [
      idx.shoulder,
      idx.elbow,
      idx.wrist,
      idx.hip,
      idx.ankle,
    ]);

    if (!visible) {
      return this.noBodyResult(
        true,
        'Position camera low on your side so elbows, shoulders, hips, and ankles are visible.'
      );
    }

    const shoulder = landmarks[idx.shoulder];
    const elbow = landmarks[idx.elbow];
    const hip = landmarks[idx.hip];
    const ankle = landmarks[idx.ankle];

    const isHorizontal = Math.abs(shoulder.x - ankle.x) > Math.abs(shoulder.y - ankle.y) * 1.15;
    const bodyLineAngle = calculateAngle(shoulder, hip, ankle);
    const bodyDev = calculateBodyLineDeviation(shoulder, hip, ankle);
    const elbowStackAngle = calculateAngle(hip, shoulder, elbow);

    const lineGood = isHorizontal && bodyLineAngle >= tol.plankLineMin;
    const elbowGood =
      isHorizontal &&
      elbowStackAngle >= tol.plankElbowMin &&
      elbowStackAngle <= tol.plankElbowMax;

    const holdActive = lineGood && isHorizontal;

    const lineStatus: FormSeverity = !isHorizontal
      ? 'waiting'
      : lineGood
      ? 'good'
      : bodyLineAngle >= tol.plankLineMin - 10
      ? 'warn'
      : 'error';

    const elbowStatus: FormSeverity = !isHorizontal
      ? 'waiting'
      : elbowGood
      ? 'good'
      : 'warn';

    let score = 100;
    if (!isHorizontal) score = 0;
    else {
      if (!lineGood) score -= lineStatus === 'error' ? 32 : 15;
      if (!elbowGood) score -= 12;
      score = Math.max(35, Math.min(100, Math.round(score)));
    }

    let primaryStatus: FormSeverity = 'good';
    let primaryCue = 'Hold steady — timer is counting clean alignment.';

    if (!isHorizontal) {
      primaryStatus = 'waiting';
      primaryCue = 'Get into forearm plank position on the floor to start timer.';
    } else if (lineStatus === 'error') {
      primaryStatus = 'error';
      primaryCue =
        bodyDev > 0
          ? 'Hips sagging — timer paused! Lift hips and brace core.'
          : 'Hips piked high — timer paused! Flatten your back.';
    } else if (lineStatus === 'warn') {
      primaryStatus = 'warn';
      primaryCue = 'Minor drift — squeeze glutes to lock straight body line.';
    } else if (!elbowGood) {
      primaryStatus = 'warn';
      primaryCue = 'Stack shoulders directly over your elbows.';
    }

    return {
      phase: !isHorizontal
        ? 'Get Into Plank'
        : holdActive
        ? 'Active Clean Hold'
        : 'Hold Paused (Adjust Form)',
      phaseProgress: holdActive ? 1 : 0.3,
      repIncrement: false,
      isHoldExercise: true,
      holdActive,
      formScore: score,
      primaryStatus,
      primaryCue,
      checkpoints: [
        {
          id: 'plank_line',
          label: 'Body Line Straightness',
          targetText: `≥ ${tol.plankLineMin}°`,
          currentValueText: isHorizontal ? `${Math.round(bodyLineAngle)}°` : '—',
          status: lineStatus,
          feedback: !isHorizontal
            ? 'Assume horizontal plank'
            : lineGood
            ? 'Straight shoulder-hip-ankle axis'
            : bodyDev > 0
            ? 'Hips sagging below line'
            : 'Hips piking above line',
        },
        {
          id: 'elbow_stack',
          label: 'Shoulder Over Elbow',
          targetText: `${tol.plankElbowMin}°–${tol.plankElbowMax}°`,
          currentValueText: isHorizontal ? `${Math.round(elbowStackAngle)}°` : '—',
          status: elbowStatus,
          feedback: elbowGood ? 'Elbows stacked under shoulders' : 'Shift shoulders above elbows',
        },
        {
          id: 'hip_level',
          label: 'Timer Gate',
          targetText: 'Clean alignment',
          currentValueText: holdActive ? 'Counting' : 'Paused',
          status: holdActive ? 'good' : isHorizontal ? 'error' : 'waiting',
          feedback: holdActive ? 'Hold time actively recording' : 'Fix alignment to resume timer',
        },
      ],
      jointAngles: isHorizontal
        ? [
            {
              label: 'Body Line',
              angle: Math.round(bodyLineAngle),
              x: hip.x,
              y: hip.y,
              status: lineStatus,
            },
            {
              label: 'Arm Stack',
              angle: Math.round(elbowStackAngle),
              x: shoulder.x,
              y: shoulder.y,
              status: elbowStatus,
            },
          ]
        : [],
      highlightSegments: isHorizontal
        ? [
            { from: idx.shoulder, to: idx.hip, status: lineStatus },
            { from: idx.hip, to: idx.ankle, status: lineStatus },
            { from: idx.shoulder, to: idx.elbow, status: elbowStatus },
          ]
        : [],
      bodyVisible: true,
    };
  }

  private evaluateJumpingJacks(
    landmarks: NormalizedLandmark[],
    tol: ToleranceProfile
  ): PoseAnalysisResult {
    const visible = areLandmarksVisible(landmarks, [
      POSE_LANDMARK.NOSE,
      POSE_LANDMARK.LEFT_SHOULDER,
      POSE_LANDMARK.RIGHT_SHOULDER,
      POSE_LANDMARK.LEFT_WRIST,
      POSE_LANDMARK.RIGHT_WRIST,
      POSE_LANDMARK.LEFT_ANKLE,
      POSE_LANDMARK.RIGHT_ANKLE,
    ]);

    if (!visible) {
      return this.noBodyResult(
        false,
        'Face the camera so your head, hands, and both feet fit inside the frame.'
      );
    }

    const nose = landmarks[POSE_LANDMARK.NOSE];
    const lShoulder = landmarks[POSE_LANDMARK.LEFT_SHOULDER];
    const rShoulder = landmarks[POSE_LANDMARK.RIGHT_SHOULDER];
    const lWrist = landmarks[POSE_LANDMARK.LEFT_WRIST];
    const rWrist = landmarks[POSE_LANDMARK.RIGHT_WRIST];
    const lHip = landmarks[POSE_LANDMARK.LEFT_HIP];
    const rHip = landmarks[POSE_LANDMARK.RIGHT_HIP];
    const lAnkle = landmarks[POSE_LANDMARK.LEFT_ANKLE];
    const rAnkle = landmarks[POSE_LANDMARK.RIGHT_ANKLE];

    const shoulderWidth = Math.max(0.06, Math.abs(lShoulder.x - rShoulder.x));
    const ankleSpan = Math.abs(lAnkle.x - rAnkle.x);
    const footSpreadRatio = ankleSpan / shoulderWidth;

    const handsOverhead = lWrist.y < nose.y && rWrist.y < nose.y;
    const handsDown = lWrist.y > lHip.y - 0.04 && rWrist.y > rHip.y - 0.04;
    const feetWide = footSpreadRatio >= 1.25;
    const feetTogether = footSpreadRatio <= 1.05;
    const wristSymDiff = Math.abs(lWrist.y - rWrist.y);
    const symGood = wristSymDiff <= tol.pressSymmetryMax * 1.4;

    let repIncrement = false;
    if (this.repState === 'ready') {
      if (lWrist.y < lShoulder.y || rWrist.y < rShoulder.y) {
        this.repState = 'concentric';
        this.reachedTargetBottom = false;
      }
    } else if (this.repState === 'concentric') {
      if (handsOverhead && feetWide) {
        this.reachedTargetBottom = true;
        this.repState = 'bottom'; // star peak
      } else if (handsDown) {
        this.repState = 'ready';
      }
    } else if (this.repState === 'bottom') {
      if (!handsOverhead) {
        this.repState = 'eccentric';
      }
    } else if (this.repState === 'eccentric') {
      if (handsDown && feetTogether) {
        if (this.reachedTargetBottom) {
          repIncrement = true;
        }
        this.repState = 'ready';
        this.reachedTargetBottom = false;
      } else if (handsOverhead && feetWide) {
        this.repState = 'bottom';
      }
    }

    const phase =
      this.repState === 'concentric'
        ? 'Jumping to Star'
        : this.repState === 'bottom'
        ? 'Star Peak!'
        : this.repState === 'eccentric'
        ? 'Landing Softly'
        : 'Pencil Stance Ready';

    const symStatus: FormSeverity = symGood ? 'good' : 'warn';
    const armStatus: FormSeverity = handsOverhead
      ? 'good'
      : this.repState === 'ready'
      ? 'waiting'
      : 'warn';
    const footStatus: FormSeverity = feetWide
      ? 'good'
      : this.repState === 'ready'
      ? 'waiting'
      : 'warn';

    let score = 100;
    if (!symGood) score -= 14;
    if (this.repState === 'bottom' && !feetWide) score -= 18;
    score = Math.max(45, Math.min(100, Math.round(score)));

    let primaryStatus: FormSeverity = 'good';
    let primaryCue = 'Stand tall like a pencil — jump wide and reach up like a star!';
    if (repIncrement) {
      primaryStatus = 'good';
      primaryCue = 'Awesome star jump! Smooth landing back to pencil stance.';
    } else if (handsOverhead && feetWide) {
      primaryStatus = 'good';
      primaryCue = 'Big star shape hit — hop softly back to feet together!';
    } else if (handsOverhead && !feetWide) {
      primaryStatus = 'warn';
      primaryCue = 'Jump feet wider apart to match your arms!';
    } else if (!symGood) {
      primaryStatus = 'warn';
      primaryCue = 'Swing both hands up at the same height.';
    }

    const lArmSpan = calculateAngle(lHip, lShoulder, lWrist);
    const rArmSpan = calculateAngle(rHip, rShoulder, rWrist);
    const avgSpan = (lArmSpan + rArmSpan) / 2;
    const phaseProgress = Math.max(0, Math.min(1, avgSpan / 155));

    return {
      phase,
      phaseProgress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: score,
      primaryStatus,
      primaryCue,
      checkpoints: [
        {
          id: 'star_arms',
          label: 'Overhead Star Reach',
          targetText: 'Above head',
          currentValueText: `${Math.round(avgSpan)}° span`,
          status: armStatus,
          feedback: handsOverhead ? 'Hands high overhead!' : 'Reach fingers above your head',
        },
        {
          id: 'foot_spread',
          label: 'Wide Star Stance',
          targetText: '≥ 1.25× width',
          currentValueText: `${footSpreadRatio.toFixed(1)}×`,
          status: footStatus,
          feedback: feetWide ? 'Wide star stance hit' : 'Hop feet wider apart at top',
        },
        {
          id: 'arm_symmetry',
          label: 'Even Left / Right Arms',
          targetText: 'Level hands',
          currentValueText: symGood ? 'Balanced' : 'Uneven',
          status: symStatus,
          feedback: symGood ? 'Both arms moving together' : 'Lift both hands evenly',
        },
      ],
      jointAngles: [
        {
          label: 'L Span',
          angle: Math.round(lArmSpan),
          x: lShoulder.x,
          y: lShoulder.y,
          status: armStatus,
        },
        {
          label: 'R Span',
          angle: Math.round(rArmSpan),
          x: rShoulder.x,
          y: rShoulder.y,
          status: armStatus,
        },
      ],
      highlightSegments: [
        { from: POSE_LANDMARK.LEFT_SHOULDER, to: POSE_LANDMARK.LEFT_WRIST, status: armStatus },
        { from: POSE_LANDMARK.RIGHT_SHOULDER, to: POSE_LANDMARK.RIGHT_WRIST, status: armStatus },
        { from: POSE_LANDMARK.LEFT_HIP, to: POSE_LANDMARK.LEFT_ANKLE, status: footStatus },
        { from: POSE_LANDMARK.RIGHT_HIP, to: POSE_LANDMARK.RIGHT_ANKLE, status: footStatus },
      ],
      bodyVisible: true,
    };
  }

  private evaluateTreePose(landmarks: NormalizedLandmark[]): PoseAnalysisResult {
    const visible = areLandmarksVisible(landmarks, [
      POSE_LANDMARK.LEFT_SHOULDER,
      POSE_LANDMARK.RIGHT_SHOULDER,
      POSE_LANDMARK.LEFT_HIP,
      POSE_LANDMARK.RIGHT_HIP,
      POSE_LANDMARK.LEFT_KNEE,
      POSE_LANDMARK.RIGHT_KNEE,
      POSE_LANDMARK.LEFT_ANKLE,
      POSE_LANDMARK.RIGHT_ANKLE,
    ]);

    if (!visible) {
      return this.noBodyResult(
        true,
        'Face the camera with both feet and shoulders visible to track your Tree Balance.'
      );
    }

    const lShoulder = landmarks[POSE_LANDMARK.LEFT_SHOULDER];
    const rShoulder = landmarks[POSE_LANDMARK.RIGHT_SHOULDER];
    const lHip = landmarks[POSE_LANDMARK.LEFT_HIP];
    const rHip = landmarks[POSE_LANDMARK.RIGHT_HIP];
    const lAnkle = landmarks[POSE_LANDMARK.LEFT_ANKLE];
    const rAnkle = landmarks[POSE_LANDMARK.RIGHT_ANKLE];

    const midShoulder: NormalizedLandmark = {
      x: (lShoulder.x + rShoulder.x) / 2,
      y: (lShoulder.y + rShoulder.y) / 2,
      z: 0,
      visibility: 1,
    };
    const midHip: NormalizedLandmark = {
      x: (lHip.x + rHip.x) / 2,
      y: (lHip.y + rHip.y) / 2,
      z: 0,
      visibility: 1,
    };

    const torsoTilt = calculateVerticalTilt(midShoulder, midHip);
    const trunkTall = torsoTilt <= 16;

    const legHeight = Math.max(0.18, Math.abs(lAnkle.y - lHip.y));
    const ankleLiftRatio = Math.abs(lAnkle.y - rAnkle.y) / legHeight;
    const footLifted = ankleLiftRatio >= 0.16;

    const holdActive = footLifted && trunkTall;

    const liftStatus: FormSeverity = footLifted ? 'good' : 'waiting';
    const trunkStatus: FormSeverity = trunkTall
      ? 'good'
      : torsoTilt <= 22
      ? 'warn'
      : 'error';

    let score = 100;
    if (!footLifted) score = 50;
    else if (!trunkTall) score -= trunkStatus === 'error' ? 28 : 14;
    score = Math.max(40, Math.min(100, Math.round(score)));

    let primaryStatus: FormSeverity = 'good';
    let primaryCue = 'Awesome Tree Balance! Timer is counting steady seconds.';
    if (!footLifted) {
      primaryStatus = 'waiting';
      primaryCue = 'Lift one foot onto your opposite calf to start the balance timer!';
    } else if (!trunkTall) {
      primaryStatus = trunkStatus;
      primaryCue = 'Grow tall through your head — avoid leaning sideways!';
    }

    return {
      phase: holdActive ? 'Steady Tree Balance' : footLifted ? 'Wobbling — Stand Tall' : 'Ready to Balance',
      phaseProgress: holdActive ? 1 : footLifted ? 0.5 : 0.1,
      repIncrement: false,
      isHoldExercise: true,
      holdActive,
      formScore: score,
      primaryStatus,
      primaryCue,
      checkpoints: [
        {
          id: 'foot_lift',
          label: 'Single-Leg Lift',
          targetText: 'Foot raised on calf',
          currentValueText: footLifted ? 'Lifted' : '2 feet down',
          status: liftStatus,
          feedback: footLifted ? 'Balancing on one foot!' : 'Lift one foot gently onto your calf',
        },
        {
          id: 'tall_trunk',
          label: 'Tall Tree Trunk',
          targetText: '≤ 16° tilt',
          currentValueText: `${Math.round(torsoTilt)}°`,
          status: trunkStatus,
          feedback: trunkTall ? 'Trunk straight and calm' : 'Stand upright without leaning sideways',
        },
        {
          id: 'balance_gate',
          label: 'Balance Timer',
          targetText: 'Steady tree',
          currentValueText: holdActive ? 'Counting' : 'Paused',
          status: holdActive ? 'good' : 'waiting',
          feedback: holdActive ? 'Holding steady!' : 'Lift foot and stand tall to count',
        },
      ],
      jointAngles: [
        {
          label: 'Trunk Tilt',
          angle: Math.round(torsoTilt),
          x: midHip.x,
          y: midHip.y,
          status: trunkStatus,
        },
      ],
      highlightSegments: [
        { from: POSE_LANDMARK.LEFT_SHOULDER, to: POSE_LANDMARK.LEFT_HIP, status: trunkStatus },
        { from: POSE_LANDMARK.RIGHT_SHOULDER, to: POSE_LANDMARK.RIGHT_HIP, status: trunkStatus },
        { from: POSE_LANDMARK.LEFT_KNEE, to: POSE_LANDMARK.LEFT_ANKLE, status: liftStatus },
        { from: POSE_LANDMARK.RIGHT_KNEE, to: POSE_LANDMARK.RIGHT_ANKLE, status: liftStatus },
      ],
      bodyVisible: true,
    };
  }

  private evaluateFrogSquat(
    landmarks: NormalizedLandmark[],
    tol: ToleranceProfile
  ): PoseAnalysisResult {
    // Kid-friendly squat with slightly more forgiving depth (tol.squatBottomMax + 6)
    const side = pickDominantSide(landmarks);
    const idx = getSideIndices(side);
    const visible = areLandmarksVisible(landmarks, [
      idx.shoulder,
      idx.hip,
      idx.knee,
      idx.ankle,
    ]);

    if (!visible) {
      return this.noBodyResult(
        false,
        'Turn slightly sideways so your head, knees, and feet stay visible.'
      );
    }

    const shoulder = landmarks[idx.shoulder];
    const hip = landmarks[idx.hip];
    const knee = landmarks[idx.knee];
    const ankle = landmarks[idx.ankle];

    const kneeAngle = calculateAngle(hip, knee, ankle);
    const torsoLean = calculateVerticalTilt(shoulder, hip);
    const targetDepth = Math.min(118, tol.squatBottomMax + 8);
    const targetTop = Math.max(152, tol.squatTopMin - 4);
    const maxTorso = tol.squatTorsoMax + 4;

    let repIncrement = false;
    if (this.repState === 'ready') {
      if (kneeAngle < targetTop - 12) {
        this.repState = 'eccentric';
        this.reachedTargetBottom = false;
      }
    } else if (this.repState === 'eccentric') {
      if (kneeAngle <= targetDepth) {
        this.reachedTargetBottom = true;
        this.repState = 'bottom';
      } else if (kneeAngle >= targetTop) {
        this.repState = 'ready';
      }
    } else if (this.repState === 'bottom') {
      if (kneeAngle > targetDepth + 10) {
        this.repState = 'concentric';
      }
    } else if (this.repState === 'concentric') {
      if (kneeAngle >= targetTop) {
        if (this.reachedTargetBottom) {
          repIncrement = true;
        }
        this.repState = 'ready';
        this.reachedTargetBottom = false;
      } else if (kneeAngle <= targetDepth) {
        this.repState = 'bottom';
      }
    }

    const phase =
      this.repState === 'eccentric'
        ? 'Crouching Down'
        : this.repState === 'bottom'
        ? 'Lily Pad Crouch!'
        : this.repState === 'concentric'
        ? 'Springing Tall'
        : 'Tall Ready';

    const depthGood = kneeAngle <= targetDepth;
    const torsoGood = torsoLean <= maxTorso;
    const topGood = kneeAngle >= targetTop;

    const torsoStatus: FormSeverity = torsoGood
      ? 'good'
      : torsoLean <= maxTorso + 10
      ? 'warn'
      : 'error';

    let score = 100;
    if (!torsoGood) score -= torsoStatus === 'error' ? 24 : 12;
    score = Math.max(45, Math.min(100, Math.round(score)));

    let primaryStatus: FormSeverity = 'good';
    let primaryCue = 'Bend knees like a frog on a lily pad while keeping eyes up!';
    if (torsoStatus === 'error') {
      primaryStatus = 'error';
      primaryCue = 'Eyes & chest up! Do not drop your nose toward your knees.';
    } else if (repIncrement) {
      primaryStatus = 'good';
      primaryCue = 'Awesome Frog Squat! Reach tall and get ready for the next one.';
    } else if (depthGood || this.repState === 'bottom') {
      primaryStatus = 'good';
      primaryCue = 'Great lily pad crouch! Push through your heels to stand tall.';
    }

    const phaseProgress = Math.max(
      0,
      Math.min(1, (175 - kneeAngle) / (175 - targetDepth))
    );

    return {
      phase,
      phaseProgress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: score,
      primaryStatus,
      primaryCue,
      checkpoints: [
        {
          id: 'frog_depth',
          label: 'Lily Pad Crouch',
          targetText: `≤ ${targetDepth}°`,
          currentValueText: `${Math.round(kneeAngle)}°`,
          status: this.repState === 'ready' ? 'waiting' : depthGood ? 'good' : 'warn',
          feedback: depthGood ? 'Nice frog crouch!' : 'Squat a little lower with heels flat',
        },
        {
          id: 'frog_chest',
          label: 'Eyes & Chest Up',
          targetText: `≤ ${maxTorso}° lean`,
          currentValueText: `${Math.round(torsoLean)}°`,
          status: torsoStatus,
          feedback: torsoGood ? 'Chest lifted nicely' : 'Keep looking forward at screen',
        },
        {
          id: 'frog_reach',
          label: 'Tall Stand Finish',
          targetText: `≥ ${targetTop}°`,
          currentValueText: `${Math.round(kneeAngle)}°`,
          status: topGood ? 'good' : 'waiting',
          feedback: topGood ? 'Tall frog finish!' : 'Stand all the way up',
        },
      ],
      jointAngles: [
        {
          label: 'Knee',
          angle: Math.round(kneeAngle),
          x: knee.x,
          y: knee.y,
          status: depthGood ? 'good' : 'warn',
        },
      ],
      highlightSegments: [
        { from: idx.shoulder, to: idx.hip, status: torsoStatus },
        { from: idx.hip, to: idx.knee, status: depthGood ? 'good' : 'warn' },
        { from: idx.knee, to: idx.ankle, status: depthGood ? 'good' : 'warn' },
      ],
      bodyVisible: true,
    };
  }

  private evaluateSuperheroRaise(
    landmarks: NormalizedLandmark[],
    tol: ToleranceProfile
  ): PoseAnalysisResult {
    const visible = areLandmarksVisible(landmarks, [
      POSE_LANDMARK.LEFT_SHOULDER,
      POSE_LANDMARK.RIGHT_SHOULDER,
      POSE_LANDMARK.LEFT_ELBOW,
      POSE_LANDMARK.RIGHT_ELBOW,
      POSE_LANDMARK.LEFT_WRIST,
      POSE_LANDMARK.RIGHT_WRIST,
      POSE_LANDMARK.LEFT_HIP,
      POSE_LANDMARK.RIGHT_HIP,
    ]);

    if (!visible) {
      return this.noBodyResult(
        false,
        'Face the camera with arms stretched wide so both wrists stay inside the screen.'
      );
    }

    const lShoulder = landmarks[POSE_LANDMARK.LEFT_SHOULDER];
    const rShoulder = landmarks[POSE_LANDMARK.RIGHT_SHOULDER];
    const lElbow = landmarks[POSE_LANDMARK.LEFT_ELBOW];
    const rElbow = landmarks[POSE_LANDMARK.RIGHT_ELBOW];
    const lWrist = landmarks[POSE_LANDMARK.LEFT_WRIST];
    const rWrist = landmarks[POSE_LANDMARK.RIGHT_WRIST];
    const lHip = landmarks[POSE_LANDMARK.LEFT_HIP];
    const rHip = landmarks[POSE_LANDMARK.RIGHT_HIP];

    const lElbowStraight = calculateAngle(lShoulder, lElbow, lWrist);
    const rElbowStraight = calculateAngle(rShoulder, rElbow, rWrist);
    const avgStraight = (lElbowStraight + rElbowStraight) / 2;

    const lWingAngle = calculateAngle(lHip, lShoulder, lWrist);
    const rWingAngle = calculateAngle(rHip, rShoulder, rWrist);
    const avgWingAngle = (lWingAngle + rWingAngle) / 2;

    const wristsHighV = lWrist.y < lShoulder.y - 0.08 && rWrist.y < rShoulder.y - 0.08;
    const wristsDown = lWrist.y > lHip.y - 0.06 && rWrist.y > rHip.y - 0.06;
    const wristDiff = Math.abs(lWrist.y - rWrist.y);
    const symGood = wristDiff <= tol.pressSymmetryMax * 1.3;
    const straightGood = avgStraight >= 145;

    let repIncrement = false;
    if (this.repState === 'ready') {
      if (avgWingAngle > 48) {
        this.repState = 'concentric';
        this.reachedTargetBottom = false;
      }
    } else if (this.repState === 'concentric') {
      if (wristsHighV && avgWingAngle >= 122) {
        this.reachedTargetBottom = true;
        this.repState = 'bottom'; // high V peak
      } else if (wristsDown) {
        this.repState = 'ready';
      }
    } else if (this.repState === 'bottom') {
      if (!wristsHighV) {
        this.repState = 'eccentric';
      }
    } else if (this.repState === 'eccentric') {
      if (wristsDown && avgWingAngle <= 42) {
        if (this.reachedTargetBottom) {
          repIncrement = true;
        }
        this.repState = 'ready';
        this.reachedTargetBottom = false;
      } else if (wristsHighV && avgWingAngle >= 122) {
        this.repState = 'bottom';
      }
    }

    const phase =
      this.repState === 'concentric'
        ? 'Lifting Wingspan'
        : this.repState === 'bottom'
        ? 'High Superhero V!'
        : this.repState === 'eccentric'
        ? 'Lowering Slowly'
        : 'Standing Ready';

    const symStatus: FormSeverity = symGood ? 'good' : 'warn';
    const straightStatus: FormSeverity = straightGood ? 'good' : 'warn';

    let score = 100;
    if (!symGood) score -= 16;
    if (!straightGood) score -= 16;
    score = Math.max(45, Math.min(100, Math.round(score)));

    let primaryStatus: FormSeverity = 'good';
    let primaryCue = 'Lift straight arms wide into a superhero V above shoulders!';
    if (repIncrement) {
      primaryStatus = 'good';
      primaryCue = 'Super wingspan rep! Great posture and smooth control.';
    } else if (!straightGood) {
      primaryStatus = 'warn';
      primaryCue = 'Stretch fingertips wide to keep elbows straight.';
    } else if (!symGood) {
      primaryStatus = 'warn';
      primaryCue = 'Keep both hands rising at the exact same level.';
    } else if (wristsHighV) {
      primaryStatus = 'good';
      primaryCue = 'High V reached — lower arms slowly back to your sides.';
    }

    const phaseProgress = Math.max(0, Math.min(1, (avgWingAngle - 20) / 115));

    return {
      phase,
      phaseProgress,
      repIncrement,
      isHoldExercise: false,
      holdActive: false,
      formScore: score,
      primaryStatus,
      primaryCue,
      checkpoints: [
        {
          id: 'wing_height',
          label: 'Superhero V-Reach',
          targetText: '≥ 122° wing lift',
          currentValueText: `${Math.round(avgWingAngle)}°`,
          status: wristsHighV ? 'good' : this.repState === 'ready' ? 'waiting' : 'warn',
          feedback: wristsHighV ? 'Great high V posture!' : 'Raise straight arms higher overhead',
        },
        {
          id: 'straight_wings',
          label: 'Straight Arms',
          targetText: '≥ 145° elbow',
          currentValueText: `${Math.round(avgStraight)}°`,
          status: straightStatus,
          feedback: straightGood ? 'Arms extended cleanly' : 'Avoid bending elbows',
        },
        {
          id: 'wing_symmetry',
          label: 'Level Wingspan',
          targetText: 'Even height',
          currentValueText: symGood ? 'Level' : 'Uneven',
          status: symStatus,
          feedback: symGood ? 'Left & right hands level' : 'Match left and right arm height',
        },
      ],
      jointAngles: [
        {
          label: 'L Wing',
          angle: Math.round(lWingAngle),
          x: lShoulder.x,
          y: lShoulder.y,
          status: symStatus,
        },
        {
          label: 'R Wing',
          angle: Math.round(rWingAngle),
          x: rShoulder.x,
          y: rShoulder.y,
          status: symStatus,
        },
      ],
      highlightSegments: [
        { from: POSE_LANDMARK.LEFT_SHOULDER, to: POSE_LANDMARK.LEFT_ELBOW, status: straightStatus },
        { from: POSE_LANDMARK.LEFT_ELBOW, to: POSE_LANDMARK.LEFT_WRIST, status: symStatus },
        { from: POSE_LANDMARK.RIGHT_SHOULDER, to: POSE_LANDMARK.RIGHT_ELBOW, status: straightStatus },
        { from: POSE_LANDMARK.RIGHT_ELBOW, to: POSE_LANDMARK.RIGHT_WRIST, status: symStatus },
      ],
      bodyVisible: true,
    };
  }
}
