export type ExerciseId =
  | 'squat'
  | 'pushup'
  | 'overhead_press'
  | 'bicep_curl'
  | 'lunge'
  | 'plank'
  | 'jumping_jacks'
  | 'tree_pose'
  | 'frog_squat'
  | 'superhero_raise'
  | 'star_hands'
  | 'crab_pinch'
  | 'tendon_glide'
  | 'wrist_fan_hold';

export type ExerciseAudience = 'general' | 'kids';

export type ExerciseTrackingMode = 'pose' | 'hand';

export type StrictnessLevel = 'beginner' | 'standard' | 'strict';

export type FormSeverity = 'good' | 'warn' | 'error' | 'waiting';

export type AppView = 'coach' | 'library' | 'classroom' | 'ai_coach' | 'history' | 'calibration';

export type ProCurrency = 'USD' | 'INR';

export interface JointPoint {
  x: number;
  y: number;
}

export interface HandGuidePose {
  curl: number; // 0 = straight fingers, 1 = full fist
  splay: number; // 0 = closed together, 1 = wide fan spread
  pinch: number; // 0 = thumb-index wide open, 1 = thumb-index O-ring pinch
}

export interface StickFigureKeyframe {
  phaseName: string;
  progress: number; // 0 to 1
  cue: string;
  handPose?: HandGuidePose;
  joints: {
    head: JointPoint;
    shoulder: JointPoint;
    elbow: JointPoint;
    wrist: JointPoint;
    hip: JointPoint;
    knee: JointPoint;
    ankle: JointPoint;
    shoulderR?: JointPoint;
    elbowR?: JointPoint;
    wristR?: JointPoint;
    hipR?: JointPoint;
    kneeR?: JointPoint;
    ankleR?: JointPoint;
  };
  angleAnnotation?: {
    vertex: 'knee' | 'elbow' | 'hip' | 'shoulder';
    label: string;
    value: string;
  };
}

export interface CheckpointRule {
  id: string;
  label: string;
  targetDescription: string;
}

export interface ExerciseMistake {
  fault: string;
  whyItMatters: string;
  fix: string;
}

export interface ExerciseDefinition {
  id: ExerciseId;
  name: string;
  category: string;
  audience: ExerciseAudience;
  ageGroup?: string;
  trackingMode?: ExerciseTrackingMode;
  difficulty: 'Beginner' | 'Intermediate';
  isHold: boolean;
  primaryMuscles: string;
  cameraSetup: {
    angle: 'Side Profile (90°)' | 'Front View (0°)' | 'Side or 45° Angle';
    distance: string;
    height: string;
    framingTip: string;
  };
  summary: string;
  steps: string[];
  checkpoints: CheckpointRule[];
  commonMistakes: ExerciseMistake[];
  keyframes: StickFigureKeyframe[];
}

export interface CheckpointStatus {
  id: string;
  label: string;
  targetText: string;
  currentValueText: string;
  status: FormSeverity;
  feedback: string;
}

export interface JointAngleOverlay {
  label: string;
  angle: number;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  status: FormSeverity;
}

export interface HighlightSegment {
  from: number;
  to: number;
  status: FormSeverity;
}

export interface PoseAnalysisResult {
  phase: string;
  phaseProgress: number; // 0..1
  repIncrement: boolean;
  isHoldExercise: boolean;
  holdActive: boolean;
  formScore: number; // 0..100
  primaryStatus: FormSeverity;
  primaryCue: string;
  checkpoints: CheckpointStatus[];
  jointAngles: JointAngleOverlay[];
  highlightSegments: HighlightSegment[];
  bodyVisible: boolean;
  visibilityHint?: string;
}

export interface WorkoutSessionRecord {
  id: string;
  exerciseId: ExerciseId;
  exerciseName: string;
  timestamp: number;
  reps: number;
  holdSeconds: number;
  avgFormScore: number;
  strictness: StrictnessLevel;
  topIssues: string[];
}

export interface AiCoachSolution {
  summary: string;
  rootCause: string;
  stepByStepFix: string[];
  recommendedDrill: string;
  cameraSensorCue: string;
}

export interface AiCoachEntry {
  id: string;
  question: string;
  exerciseName: string;
  timestamp: number;
  solution: AiCoachSolution;
}

export type UserRole = 'owner' | 'member';

export interface UserProfileRecord {
  uid: string;
  displayName: string;
  role: UserRole;
  proActive: boolean;
  proCurrency: ProCurrency;
}

export interface ProAccessRequestRecord {
  requestId: string;
  uid: string;
  requesterName: string;
  requesterEmail: string;
  currency: ProCurrency;
  amountLabel: '$29 USD' | '₹100';
  paymentReference: string;
  status: 'pending' | 'approved' | 'rejected';
}

