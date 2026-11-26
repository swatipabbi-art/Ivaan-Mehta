import {
  FilesetResolver,
  HandLandmarker,
  NormalizedLandmark,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Loader2,
  Pause,
  Play,
  Upload,
  VideoOff,
  XCircle,
} from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  ExerciseDefinition,
  FormSeverity,
  PoseAnalysisResult,
  StrictnessLevel,
} from '../types/exercise';
import { ExerciseEvaluator } from '../utils/exerciseEvaluator';
import { HAND_CONNECTIONS, HandEvaluator, HandSmoother } from '../utils/handEvaluator';
import { PoseSmoother, SKELETON_CONNECTIONS } from '../utils/poseGeometry';
import { BiomechanicalGuide } from './BiomechanicalGuide';

interface CameraPoseStageProps {
  exercise: ExerciseDefinition;
  strictness: StrictnessLevel;
  isCameraActive: boolean;
  onCameraStateChange: (active: boolean) => void;
  onAnalysisUpdate: (
    result: PoseAnalysisResult,
    elapsedDeltaSec: number
  ) => void;
}

const SEVERITY_COLORS: Record<FormSeverity, string> = {
  good: '#10B981', // Emerald 500
  warn: '#F59E0B', // Amber 500
  error: '#EF4444', // Rose 500
  waiting: '#38BDF8', // Sky 400
};

const POSE_JOINT_INDICES = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const HAND_JOINT_INDICES = Array.from({ length: 21 }, (_, i) => i);

export function CameraPoseStage({
  exercise,
  strictness,
  isCameraActive,
  onCameraStateChange,
  onAnalysisUpdate,
}: CameraPoseStageProps) {
  const isHandExercise = exercise.trackingMode === 'hand';
  const trackingMode: 'pose' | 'hand' = isHandExercise ? 'hand' : 'pose';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const visionRef = useRef<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const evaluatorRef = useRef<ExerciseEvaluator>(
    new ExerciseEvaluator(exercise.id, strictness)
  );
  const handEvaluatorRef = useRef<HandEvaluator>(
    new HandEvaluator(exercise.id, strictness)
  );
  const smootherRef = useRef<PoseSmoother>(new PoseSmoother(0.42));
  const handSmootherRef = useRef<HandSmoother>(new HandSmoother(0.48));
  const trackingModeRef = useRef<'pose' | 'hand'>(trackingMode);
  const isHoldRef = useRef<boolean>(exercise.isHold);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const lastFramePerfRef = useRef<number>(0);

  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [modelError, setModelError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [sourceMode, setSourceMode] = useState<'idle' | 'camera' | 'video'>('idle');
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  const [isMirrored, setIsMirrored] = useState(true);
  const [showRefGuidePip, setShowRefGuidePip] = useState(false);
  const [videoRatio, setVideoRatio] = useState<number>(16 / 9);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [latestAnalysis, setLatestAnalysis] = useState<PoseAnalysisResult | null>(null);

  // Keep evaluators and mode refs synced with props
  useEffect(() => {
    trackingModeRef.current = trackingMode;
    isHoldRef.current = exercise.isHold;
    evaluatorRef.current.setExercise(exercise.id);
    handEvaluatorRef.current.setExercise(exercise.id);
    smootherRef.current.reset();
    handSmootherRef.current.reset();
    setLatestAnalysis(null);
  }, [exercise.id, exercise.isHold, trackingMode]);

  useEffect(() => {
    evaluatorRef.current.setStrictness(strictness);
    handEvaluatorRef.current.setStrictness(strictness);
  }, [strictness]);

  const initLandmarker = useCallback(async (mode: 'pose' | 'hand') => {
    if (mode === 'hand' && handLandmarkerRef.current) {
      setModelState('ready');
      return handLandmarkerRef.current;
    }
    if (mode === 'pose' && landmarkerRef.current) {
      setModelState('ready');
      return landmarkerRef.current;
    }

    setModelState('loading');
    setModelError(null);

    try {
      if (!visionRef.current) {
        visionRef.current = await FilesetResolver.forVisionTasks('/wasm');
      }
      const vision = visionRef.current;

      if (mode === 'hand') {
        let handInstance: HandLandmarker;
        try {
          handInstance = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/models/hand_landmarker.task',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch {
          handInstance = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/models/hand_landmarker.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        }
        handLandmarkerRef.current = handInstance;
        setModelState('ready');
        return handInstance;
      }

      let instance: PoseLandmarker;
      try {
        instance = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.55,
          minPosePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
      } catch {
        // Fallback to CPU delegate when WebGL GPU delegate is unavailable
        instance = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/pose_landmarker_lite.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.55,
          minPosePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
      }
      landmarkerRef.current = instance;
      setModelState('ready');
      return instance;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : mode === 'hand'
          ? 'Failed to load hand tracking model.'
          : 'Failed to load pose detection model.';
      setModelState('error');
      setModelError(message);
      return null;
    }
  }, []);

  // Ensure switching between full-body and hand exercises while live loads the needed model
  useEffect(() => {
    if (sourceMode === 'camera' || sourceMode === 'video') {
      void initLandmarker(trackingMode);
    }
  }, [initLandmarker, sourceMode, trackingMode]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const drawOverlay = useCallback(
    (
      landmarks: NormalizedLandmark[] | null,
      analysis: PoseAnalysisResult | null,
      mirror: boolean,
      mode: 'pose' | 'hand'
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (!landmarks || landmarks.length === 0) return;

      const mapX = (nx: number) => (mirror ? (1 - nx) * w : nx * w);
      const mapY = (ny: number) => ny * h;

      // Build segment status lookup from evaluator highlights
      const segmentStatusMap = new Map<string, FormSeverity>();
      if (analysis) {
        for (const seg of analysis.highlightSegments) {
          segmentStatusMap.set(`${seg.from}-${seg.to}`, seg.status);
          segmentStatusMap.set(`${seg.to}-${seg.from}`, seg.status);
        }
      }

      const connections = mode === 'hand' ? HAND_CONNECTIONS : SKELETON_CONNECTIONS;
      const jointIndices = mode === 'hand' ? HAND_JOINT_INDICES : POSE_JOINT_INDICES;

      // Draw skeleton / hand edges
      ctx.lineCap = 'round';
      for (const [aIdx, bIdx] of connections) {
        const a = landmarks[aIdx];
        const b = landmarks[bIdx];
        if (!a || !b) continue;
        if (mode === 'pose') {
          const visA = a.visibility ?? 1;
          const visB = b.visibility ?? 1;
          if (visA < 0.35 || visB < 0.35) continue;
        }

        const segStatus = segmentStatusMap.get(`${aIdx}-${bIdx}`);
        const color = segStatus
          ? SEVERITY_COLORS[segStatus]
          : 'rgba(226, 232, 240, 0.72)';

        ctx.beginPath();
        ctx.moveTo(mapX(a.x), mapY(a.y));
        ctx.lineTo(mapX(b.x), mapY(b.y));
        ctx.lineWidth = segStatus ? (mode === 'hand' ? 4 : 5) : mode === 'hand' ? 2.5 : 3;
        ctx.strokeStyle = color;
        ctx.stroke();
      }

      // Draw joint dots
      jointIndices.forEach((idx) => {
        const lm = landmarks[idx];
        if (!lm) return;
        if (mode === 'pose' && (lm.visibility ?? 1) < 0.35) return;
        const cx = mapX(lm.x);
        const cy = mapY(lm.y);

        ctx.beginPath();
        ctx.arc(cx, cy, mode === 'hand' ? 4.2 : 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.lineWidth = mode === 'hand' ? 2 : 2.5;
        ctx.strokeStyle = '#0F172A';
        ctx.stroke();
      });

      // Draw readable joint angle / metric badges
      if (analysis && analysis.bodyVisible) {
        ctx.font = '600 13px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';

        for (const ja of analysis.jointAngles) {
          const px = mapX(ja.x);
          const py = mapY(ja.y);
          const unit = ja.label === 'Pinch Gap' ? '%' : '°';
          const label = `${ja.label}: ${ja.angle}${unit}`;
          const textWidth = ctx.measureText(label).width;
          const padX = 8;
          const boxW = textWidth + padX * 2;
          const boxH = 24;

          const boxX = Math.min(w - boxW - 8, Math.max(8, px + 12));
          const boxY = Math.min(h - boxH - 8, Math.max(8, py - 14));

          ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
          ctx.beginPath();
          ctx.roundRect(boxX, boxY, boxW, boxH, 6);
          ctx.fill();

          ctx.lineWidth = 1.5;
          ctx.strokeStyle = SEVERITY_COLORS[ja.status];
          ctx.stroke();

          ctx.fillStyle = '#F8FAFC';
          ctx.fillText(label, boxX + padX, boxY + boxH / 2 + 0.5);
        }
      }
    },
    []
  );

  const startDetectionLoop = useCallback(
    (mirrorFlag: boolean) => {
      stopLoop();
      lastVideoTimeRef.current = -1;
      lastFramePerfRef.current = performance.now();

      const processFrame = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const activeMode = trackingModeRef.current;
        const activeLandmarker =
          activeMode === 'hand' ? handLandmarkerRef.current : landmarkerRef.current;

        if (!video || !canvas || !activeLandmarker) {
          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }

        if (
          video.readyState >= 2 &&
          video.videoWidth > 0 &&
          video.videoHeight > 0 &&
          !video.paused &&
          !video.ended
        ) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            setVideoRatio(video.videoWidth / video.videoHeight);
          }

          if (video.currentTime !== lastVideoTimeRef.current) {
            lastVideoTimeRef.current = video.currentTime;
            const nowPerf = performance.now();
            const deltaSec = Math.min(0.25, Math.max(0, (nowPerf - lastFramePerfRef.current) / 1000));
            lastFramePerfRef.current = nowPerf;

            try {
              if (activeMode === 'hand') {
                const result = (activeLandmarker as HandLandmarker).detectForVideo(video, nowPerf);
                if (result.landmarks && result.landmarks.length > 0) {
                  const smoothed = handSmootherRef.current.smooth(result.landmarks[0]);
                  const analysis = handEvaluatorRef.current.evaluate(smoothed);
                  setLatestAnalysis(analysis);
                  onAnalysisUpdate(analysis, deltaSec);
                  drawOverlay(smoothed, analysis, mirrorFlag, 'hand');
                } else {
                  const emptyHandAnalysis: PoseAnalysisResult = {
                    phase: 'No Hand Detected',
                    phaseProgress: 0,
                    repIncrement: false,
                    isHoldExercise: isHoldRef.current,
                    holdActive: false,
                    formScore: 0,
                    primaryStatus: 'waiting',
                    primaryCue: 'Hold one open hand 1–2 ft in front of your camera.',
                    checkpoints: [],
                    jointAngles: [],
                    highlightSegments: [],
                    bodyVisible: false,
                  };
                  setLatestAnalysis(emptyHandAnalysis);
                  onAnalysisUpdate(emptyHandAnalysis, 0);
                  drawOverlay(null, null, mirrorFlag, 'hand');
                }
              } else {
                const result = (activeLandmarker as PoseLandmarker).detectForVideo(video, nowPerf);
                if (result.landmarks && result.landmarks.length > 0) {
                  const smoothed = smootherRef.current.smooth(result.landmarks[0]);
                  const analysis = evaluatorRef.current.evaluate(smoothed);
                  setLatestAnalysis(analysis);
                  onAnalysisUpdate(analysis, deltaSec);
                  drawOverlay(smoothed, analysis, mirrorFlag, 'pose');
                } else {
                  const emptyAnalysis: PoseAnalysisResult = {
                    phase: 'No Person Detected',
                    phaseProgress: 0,
                    repIncrement: false,
                    isHoldExercise: isHoldRef.current,
                    holdActive: false,
                    formScore: 0,
                    primaryStatus: 'waiting',
                    primaryCue: 'Step into frame so the sensor can track your body.',
                    checkpoints: [],
                    jointAngles: [],
                    highlightSegments: [],
                    bodyVisible: false,
                  };
                  setLatestAnalysis(emptyAnalysis);
                  onAnalysisUpdate(emptyAnalysis, 0);
                  drawOverlay(null, null, mirrorFlag, 'pose');
                }
              }
            } catch {
              // Ignore transient timestamp errors on seek/restart
            }
          }
        }

        rafRef.current = requestAnimationFrame(processFrame);
      };

      rafRef.current = requestAnimationFrame(processFrame);
    },
    [drawOverlay, onAnalysisUpdate, stopLoop]
  );

  const sourceModeRef = useRef(sourceMode);
  useEffect(() => {
    sourceModeRef.current = sourceMode;
  }, [sourceMode]);

  // Sync camera activation from parent prop (e.g. TopBar Start/Stop Camera CTA)
  useEffect(() => {
    let cancelled = false;

    const enableCamera = async () => {
      setCameraError(null);
      if (uploadedVideoUrl) {
        URL.revokeObjectURL(uploadedVideoUrl);
        setUploadedVideoUrl(null);
      }

      const landmarker = await initLandmarker(trackingModeRef.current);
      if (!landmarker || cancelled) return;

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'Camera access is unavailable in this browser context. You can upload a workout video below instead.'
        );
        onCameraStateChange(false);
        return;
      }

      try {
        stopCameraStream();
        const constraints: MediaStreamConstraints = {
          video: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        setSourceMode('camera');
        setIsMirrored(true);

        // Enumerate cameras once permission is granted
        try {
          const allDevices = await navigator.mediaDevices.enumerateDevices();
          setDevices(allDevices.filter((d) => d.kind === 'videoinput'));
        } catch {
          // Non-fatal
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        const msg =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in browser settings or upload a video clip to check your form.'
            : 'Could not start camera sensor. Check that no other app is locking your webcam, or upload a video clip.';
        setCameraError(msg);
        setSourceMode('idle');
        onCameraStateChange(false);
      }
    };

    if (isCameraActive) {
      enableCamera();
    } else if (sourceModeRef.current === 'camera') {
      stopLoop();
      stopCameraStream();
      setSourceMode('idle');
      setLatestAnalysis(null);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraActive, selectedDeviceId]);

  // Restart detection loop whenever mirror setting or source mode updates
  useEffect(() => {
    if (sourceMode === 'camera') {
      startDetectionLoop(isMirrored);
    } else if (sourceMode === 'video') {
      startDetectionLoop(false);
    }
    return () => stopLoop();
  }, [sourceMode, isMirrored, startDetectionLoop, stopLoop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLoop();
      stopCameraStream();
      if (uploadedVideoUrl) URL.revokeObjectURL(uploadedVideoUrl);
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUploadVideo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setCameraError(null);
    if (isCameraActive) {
      onCameraStateChange(false);
    }
    stopCameraStream();

    const landmarker = await initLandmarker(trackingModeRef.current);
    if (!landmarker) return;

    if (uploadedVideoUrl) {
      URL.revokeObjectURL(uploadedVideoUrl);
    }
    const url = URL.createObjectURL(file);
    setUploadedVideoUrl(url);
    setSourceMode('video');
    setIsMirrored(false);
    smootherRef.current.reset();
    handSmootherRef.current.reset();
    evaluatorRef.current.resetRepState();
    handEvaluatorRef.current.resetRepState();

    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.loop = true;
        videoRef.current
          .play()
          .then(() => setIsVideoPlaying(true))
          .catch(() => setIsVideoPlaying(false));
      }
    }, 50);
  };

  const handleCloseVideoMode = () => {
    stopLoop();
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    if (uploadedVideoUrl) {
      URL.revokeObjectURL(uploadedVideoUrl);
      setUploadedVideoUrl(null);
    }
    setSourceMode('idle');
    setIsVideoPlaying(false);
    setLatestAnalysis(null);
  };

  const toggleVideoPlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setIsVideoPlaying(true)).catch(() => {});
    } else {
      v.pause();
      setIsVideoPlaying(false);
    }
  };

  const renderStatusBannerIcon = (status: FormSeverity) => {
    switch (status) {
      case 'good':
        return <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden="true" />;
      case 'warn':
        return <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" aria-hidden="true" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-rose-400 shrink-0" aria-hidden="true" />;
      default:
        return <Camera className="h-5 w-5 text-sky-400 shrink-0" aria-hidden="true" />;
    }
  };

  const renderStatusLabel = (status: FormSeverity) => {
    switch (status) {
      case 'good':
        return 'FORM ON TARGET';
      case 'warn':
        return 'ADJUST FORM';
      case 'error':
        return 'FORM CORRECTION';
      default:
        return 'SENSOR READY';
    }
  };

  const isSensorRunning = sourceMode === 'camera' || sourceMode === 'video';

  return (
    <div className="flex flex-col gap-5">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleUploadVideo}
        className="hidden"
      />

      {/* Primary Stage Frame */}
      <div className="relative bg-slate-950 border border-slate-200 rounded-xl overflow-hidden">
        {/* Top Stage Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2.5 text-slate-200">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-white">{exercise.name}</span>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <span className="text-slate-400">
              {sourceMode === 'camera'
                ? isHandExercise
                  ? 'Live Hand Sensor'
                  : 'Live Camera Sensor'
                : sourceMode === 'video'
                ? 'Uploaded Video Analysis'
                : 'Interactive Form Guide'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {sourceMode === 'camera' && devices.length > 1 && (
              <select
                aria-label="Select camera device"
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none cursor-pointer"
              >
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            )}

            {sourceMode === 'camera' && (
              <button
                type="button"
                onClick={() => setIsMirrored((m) => !m)}
                aria-pressed={isMirrored}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  isMirrored
                    ? 'border-blue-500/50 bg-blue-600/20 text-blue-200'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <FlipHorizontal2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mirror</span>
              </button>
            )}

            {isSensorRunning && (
              <button
                type="button"
                onClick={() => setShowRefGuidePip((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap"
              >
                {showRefGuidePip ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Hide Guide</span>
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Show Target Guide</span>
                  </>
                )}
              </button>
            )}

            {sourceMode === 'video' && (
              <>
                <button
                  type="button"
                  onClick={toggleVideoPlay}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap"
                >
                  {isVideoPlaying ? (
                    <>
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Play</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleCloseVideoMode}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap"
                >
                  <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Close Video</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Upload Video</span>
            </button>
          </div>
        </div>

        {/* Video + Canvas Viewport OR Interactive Idle Teaching Stage */}
        <div className="relative flex min-h-[420px] sm:min-h-[490px] w-full items-center justify-center bg-slate-950">
          {/* Active Video & Pose Overlay */}
          <div
            className={`relative flex items-center justify-center w-full h-full ${
              isSensorRunning ? 'flex' : 'hidden'
            }`}
          >
            <div
              className="relative w-full max-h-[540px] mx-auto overflow-hidden"
              style={{ aspectRatio: `${videoRatio}` }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                className={`h-full w-full object-contain ${
                  isMirrored && sourceMode === 'camera' ? '-scale-x-100' : ''
                }`}
              />
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </div>

            {/* Optional Picture-in-Picture Target Form Guide */}
            {showRefGuidePip && (
              <div className="absolute top-3 right-3 z-20 w-56 shadow-lg rounded-xl overflow-hidden border border-slate-700">
                <BiomechanicalGuide exercise={exercise} compact />
              </div>
            )}

            {/* Loading Model Overlay */}
            {modelState === 'loading' && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-slate-950/85 text-white">
                <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                <p className="text-sm font-medium">
                  {isHandExercise
                    ? 'Initializing hand tracking sensor...'
                    : 'Initializing pose tracking sensor...'}
                </p>
              </div>
            )}

            {/* Bottom Live Coaching Scrim */}
            {latestAnalysis && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-slate-950/95 via-slate-950/75 to-transparent px-5 pt-10 pb-4">
                <div className="flex items-center gap-3">
                  {renderStatusBannerIcon(latestAnalysis.primaryStatus)}
                  <div className="min-w-0">
                    <div className="text-[11px] font-mono font-semibold tracking-wider text-slate-300">
                      {renderStatusLabel(latestAnalysis.primaryStatus)}
                    </div>
                    <p className="text-sm sm:text-base font-semibold text-white truncate">
                      {latestAnalysis.primaryCue}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Idle State: Interactive Teaching Stage + Launch Controls */}
          {!isSensorRunning && (
            <div className="w-full p-5 sm:p-7 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center bg-slate-50">
              <div className="lg:col-span-7">
                <BiomechanicalGuide exercise={exercise} />
              </div>

              <div className="lg:col-span-5 flex flex-col gap-4">
                <div>
                  <span className="text-xs font-semibold tracking-wide text-blue-600">
                    {exercise.category} · {exercise.difficulty}
                    {isHandExercise ? ' · Free Hand Sensor' : ''}
                  </span>
                  <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 tracking-tight text-balance">
                    {exercise.name}
                  </h1>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                    {exercise.summary}
                  </p>
                </div>

                {(cameraError || modelError) && (
                  <div
                    role="alert"
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
                  >
                    {cameraError || modelError}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => onCameraStateChange(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Camera className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Enable Camera Sensor</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Check Recorded Video</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Step-by-Step Technique & Common Faults below Stage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Execution Steps
          </h2>
          <ol className="mt-3 space-y-2.5">
            {exercise.steps.map((step, index) => (
              <li key={index} className="flex items-start gap-2.5 text-sm text-slate-600">
                <span className="font-mono text-xs font-semibold text-blue-600 mt-0.5 shrink-0">
                  0{index + 1}.
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Common Form Mistakes & Fixes
          </h2>
          <div className="mt-3 divide-y divide-slate-100">
            {exercise.commonMistakes.map((mistake, index) => (
              <div key={index} className="py-2.5 first:pt-0 last:pb-0">
                <div className="text-sm font-semibold text-slate-800">
                  {mistake.fault}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {mistake.whyItMatters}
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-700">
                  Fix: {mistake.fix}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
