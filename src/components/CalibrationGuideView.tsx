import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  Camera,
  CheckCircle2,
  Download,
  Loader2,
  Ruler,
  Sun,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';

interface CalibrationGuideViewProps {
  onLaunchCoach: () => void;
}

interface DiagnosticResult {
  cameraStatus: 'ok' | 'error';
  cameraMessage: string;
  modelStatus: 'ok' | 'error';
  modelMessage: string;
}

export function CalibrationGuideView({ onLaunchCoach }: CalibrationGuideViewProps) {
  const [testing, setTesting] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [iconNotice, setIconNotice] = useState<string | null>(null);

  const handleDownloadIcon = async (format: 'png-512' | 'original') => {
    setIconNotice(null);
    try {
      const resp = await fetch('/favicon.ico');
      if (!resp.ok) {
        throw new Error('App icon asset could not be loaded.');
      }
      const blob = await resp.blob();

      if (format === 'original') {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'formlab-icon-1024.jpg';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setIconNotice('Downloaded 1024×1024 icon.');
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Could not decode app icon image.'));
        img.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable.');
      ctx.drawImage(img, 0, 0, 512, 512);
      URL.revokeObjectURL(objectUrl);

      const pngBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!pngBlob) throw new Error('PNG export failed.');
      const pngUrl = URL.createObjectURL(pngBlob);
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = 'formlab-icon-512.png';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(pngUrl);
      setIconNotice('Downloaded 512×512 PNG icon (ready for Android APK).');
    } catch (err) {
      setIconNotice(
        err instanceof Error ? err.message : 'Unable to download icon.'
      );
    }
  };

  const runSensorDiagnostic = async () => {
    setTesting(true);
    let cameraStatus: 'ok' | 'error' = 'error';
    let cameraMessage = 'Camera unavailable.';
    let modelStatus: 'ok' | 'error' = 'error';
    let modelMessage = 'Pose model could not load.';

    // 1. Check real camera access
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        cameraStatus = 'ok';
        cameraMessage = `Camera connected (${settings.width ?? '?'}×${settings.height ?? '?'}px · ${track.label || 'Default Webcam'}).`;
        stream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        cameraStatus = 'error';
        cameraMessage =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera permission denied by browser. Grant access or use Video Upload mode.'
            : 'No accessible camera detected in this environment.';
      }
    } else {
      cameraMessage = 'navigator.mediaDevices.getUserMedia is not supported here.';
    }

    // 2. Verify local MediaPipe WASM + PoseLandmarker model
    try {
      const vision = await FilesetResolver.forVisionTasks('/wasm');
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/pose_landmarker_lite.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      landmarker.close();
      modelStatus = 'ok';
      modelMessage = 'Pose Landmarker engine verified locally (33 skeletal landmarks ready).';
    } catch (err) {
      modelStatus = 'error';
      modelMessage =
        err instanceof Error ? err.message : 'Pose engine failed to initialize.';
    }

    setDiagnostic({
      cameraStatus,
      cameraMessage,
      modelStatus,
      modelMessage,
    });
    setTesting(false);
  };

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">
            Camera Setup & Sensor Calibration
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            Accurate joint-angle detection depends on clean framing and unobstructed landmarks. Follow these four steps for reliable rep counting.
          </p>
        </div>

        <button
          type="button"
          onClick={onLaunchCoach}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Camera className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Open Live Coach</span>
        </button>
      </div>

      {/* 4 Setup Guidelines */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded-xl p-5 flex gap-4">
          <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <Ruler className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              01. Distance & Full-Body Framing
            </h2>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              Step 6–8 feet (2–2.5 meters) back so your head, shoulders, hips, knees, and ankles stay inside the frame throughout the entire rep—including overhead lockouts and deep squats.
            </p>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 flex gap-4">
          <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <Camera className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              02. Match Camera Angle to the Movement
            </h2>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              Use a <strong>Side Profile (90°)</strong> or 45° angle for squats, push-ups, bicep curls, lunges, and planks. Use a <strong>Front View (0°)</strong> for overhead shoulder presses so symmetry is measured.
            </p>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 flex gap-4">
          <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <Sun className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              03. Even Front or Side Lighting
            </h2>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              Avoid standing directly in front of a bright window (backlighting turns your silhouette dark and lowers joint tracking confidence). Face toward your light source.
            </p>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 flex gap-4">
          <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <UserCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              04. Fitted Clothing & Clear Floor
            </h2>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              Clothing that contrasts with your background helps the sensor lock onto hip and knee creases precisely. Keep pets or other people out of frame so only one athlete is tracked.
            </p>
          </div>
        </section>
      </div>

      {/* Live Hardware & Pose Model Diagnostic */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Sensor Readiness Check
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Test your browser camera permission and verify the local 33-landmark pose engine loads properly.
            </p>
          </div>
          <button
            type="button"
            onClick={runSensorDiagnostic}
            disabled={testing}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Testing Sensor...</span>
              </>
            ) : (
              <span>Run Diagnostic Check</span>
            )}
          </button>
        </div>

        {diagnostic && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div className="flex items-start gap-2.5 rounded-lg bg-slate-50 border border-slate-200 p-3.5">
              {diagnostic.cameraStatus === 'ok' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Camera Hardware {diagnostic.cameraStatus === 'ok' ? '· Ready' : '· Unavailable'}
                </div>
                <p className="mt-0.5 text-xs text-slate-600">
                  {diagnostic.cameraMessage}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg bg-slate-50 border border-slate-200 p-3.5">
              {diagnostic.modelStatus === 'ok' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Pose Detection Engine {diagnostic.modelStatus === 'ok' ? '· Verified' : '· Error'}
                </div>
                <p className="mt-0.5 text-xs text-slate-600">
                  {diagnostic.modelMessage}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Downloadable App Icon Asset (for Android APK / Launcher) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <img
            src="/favicon.ico"
            alt="FormLab app icon preview"
            className="h-14 w-14 rounded-xl border border-slate-200 object-cover shrink-0 bg-slate-100"
          />
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              FormLab App Icon
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Download the icon as a 512×512 PNG for Android APK / launcher setup or the full 1024×1024 original.
            </p>
            {iconNotice && (
              <p className="mt-1 text-xs font-medium text-emerald-700">
                {iconNotice}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => handleDownloadIcon('png-512')}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Download 512×512 PNG</span>
          </button>
          <button
            type="button"
            onClick={() => handleDownloadIcon('original')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Original 1024×1024</span>
          </button>
        </div>
      </section>
    </div>
  );
}
