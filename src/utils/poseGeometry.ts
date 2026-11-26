import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export const POSE_LANDMARK = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export const SKELETON_CONNECTIONS: Array<[number, number]> = [
  [POSE_LANDMARK.LEFT_SHOULDER, POSE_LANDMARK.RIGHT_SHOULDER],
  [POSE_LANDMARK.LEFT_SHOULDER, POSE_LANDMARK.LEFT_ELBOW],
  [POSE_LANDMARK.LEFT_ELBOW, POSE_LANDMARK.LEFT_WRIST],
  [POSE_LANDMARK.RIGHT_SHOULDER, POSE_LANDMARK.RIGHT_ELBOW],
  [POSE_LANDMARK.RIGHT_ELBOW, POSE_LANDMARK.RIGHT_WRIST],
  [POSE_LANDMARK.LEFT_SHOULDER, POSE_LANDMARK.LEFT_HIP],
  [POSE_LANDMARK.RIGHT_SHOULDER, POSE_LANDMARK.RIGHT_HIP],
  [POSE_LANDMARK.LEFT_HIP, POSE_LANDMARK.RIGHT_HIP],
  [POSE_LANDMARK.LEFT_HIP, POSE_LANDMARK.LEFT_KNEE],
  [POSE_LANDMARK.LEFT_KNEE, POSE_LANDMARK.LEFT_ANKLE],
  [POSE_LANDMARK.RIGHT_HIP, POSE_LANDMARK.RIGHT_KNEE],
  [POSE_LANDMARK.RIGHT_KNEE, POSE_LANDMARK.RIGHT_ANKLE],
];

/**
 * Computes the interior angle (0..180 degrees) at vertex B formed by points A-B-C.
 */
export function calculateAngle(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark
): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) {
    angle = 360.0 - angle;
  }
  return angle;
}

/**
 * Computes angle (0..90+ degrees) of segment (bottom -> top) relative to true vertical.
 * 0° means perfectly upright vertical; 90° means horizontal.
 */
export function calculateVerticalTilt(
  top: NormalizedLandmark,
  bottom: NormalizedLandmark
): number {
  const dx = Math.abs(top.x - bottom.x);
  const dy = Math.abs(bottom.y - top.y);
  if (dy < 1e-5 && dx < 1e-5) return 0;
  return (Math.atan2(dx, dy) * 180.0) / Math.PI;
}

/**
 * Signed vertical deviation of hip relative to the shoulder-ankle line.
 * Positive means hip is lower (sagging in plank/pushup); negative means hip is higher (piking).
 */
export function calculateBodyLineDeviation(
  shoulder: NormalizedLandmark,
  hip: NormalizedLandmark,
  ankle: NormalizedLandmark
): number {
  const t =
    Math.abs(ankle.x - shoulder.x) > 0.05
      ? (hip.x - shoulder.x) / (ankle.x - shoulder.x)
      : 0.5;
  const expectedHipY = shoulder.y + t * (ankle.y - shoulder.y);
  return hip.y - expectedHipY; // positive = below line (sag) in image Y-down coords
}

export function getVisibility(lm: NormalizedLandmark | undefined): number {
  if (!lm) return 0;
  return typeof lm.visibility === 'number' ? lm.visibility : 1;
}

export function areLandmarksVisible(
  landmarks: NormalizedLandmark[],
  indices: number[],
  minVisibility = 0.45
): boolean {
  return indices.every((idx) => {
    const lm = landmarks[idx];
    if (!lm) return false;
    const vis = getVisibility(lm);
    return (
      vis >= minVisibility &&
      lm.x >= -0.05 &&
      lm.x <= 1.05 &&
      lm.y >= -0.05 &&
      lm.y <= 1.05
    );
  });
}

export type BodySide = 'left' | 'right';

/**
 * Chooses whichever side (left or right) has higher average landmark visibility.
 */
export function pickDominantSide(landmarks: NormalizedLandmark[]): BodySide {
  const leftScore =
    getVisibility(landmarks[POSE_LANDMARK.LEFT_SHOULDER]) +
    getVisibility(landmarks[POSE_LANDMARK.LEFT_ELBOW]) +
    getVisibility(landmarks[POSE_LANDMARK.LEFT_HIP]) +
    getVisibility(landmarks[POSE_LANDMARK.LEFT_KNEE]) +
    getVisibility(landmarks[POSE_LANDMARK.LEFT_ANKLE]);

  const rightScore =
    getVisibility(landmarks[POSE_LANDMARK.RIGHT_SHOULDER]) +
    getVisibility(landmarks[POSE_LANDMARK.RIGHT_ELBOW]) +
    getVisibility(landmarks[POSE_LANDMARK.RIGHT_HIP]) +
    getVisibility(landmarks[POSE_LANDMARK.RIGHT_KNEE]) +
    getVisibility(landmarks[POSE_LANDMARK.RIGHT_ANKLE]);

  return leftScore >= rightScore ? 'left' : 'right';
}

export function getSideIndices(side: BodySide) {
  if (side === 'left') {
    return {
      shoulder: POSE_LANDMARK.LEFT_SHOULDER,
      elbow: POSE_LANDMARK.LEFT_ELBOW,
      wrist: POSE_LANDMARK.LEFT_WRIST,
      hip: POSE_LANDMARK.LEFT_HIP,
      knee: POSE_LANDMARK.LEFT_KNEE,
      ankle: POSE_LANDMARK.LEFT_ANKLE,
    };
  }
  return {
    shoulder: POSE_LANDMARK.RIGHT_SHOULDER,
    elbow: POSE_LANDMARK.RIGHT_ELBOW,
    wrist: POSE_LANDMARK.RIGHT_WRIST,
    hip: POSE_LANDMARK.RIGHT_HIP,
    knee: POSE_LANDMARK.RIGHT_KNEE,
    ankle: POSE_LANDMARK.RIGHT_ANKLE,
  };
}

/**
 * Exponential Moving Average smoother for 33 pose landmarks to stabilize jitter.
 */
export class PoseSmoother {
  private prev: NormalizedLandmark[] | null = null;
  private readonly alpha: number;

  constructor(alpha = 0.42) {
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
