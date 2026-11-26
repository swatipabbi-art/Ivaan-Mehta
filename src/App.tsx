import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiCoachView } from './components/AiCoachView';
import { CalibrationGuideView } from './components/CalibrationGuideView';
import { CameraPoseStage } from './components/CameraPoseStage';
import { ClassroomView } from './components/ClassroomView';
import { CoachingDeck } from './components/CoachingDeck';
import { ExerciseLibraryView } from './components/ExerciseLibraryView';
import { SessionLogView } from './components/SessionLogView';
import { TopBar } from './components/TopBar';
import { EXERCISES } from './data/exercises';
import {
  auth,
  isVerifiedOwner,
  signInWithGoogle,
  signOutUser,
  subscribeProRequests,
  syncUserProfile,
  updateProfileCurrency,
} from './firebase';
import {
  AiCoachEntry,
  AppView,
  ExerciseId,
  PoseAnalysisResult,
  ProAccessRequestRecord,
  ProCurrency,
  StrictnessLevel,
  WorkoutSessionRecord,
} from './types/exercise';
import { audioCoach } from './utils/audioCoach';

const STORAGE_KEY = 'formlab_sessions_v1';
const PRO_KEY_STORAGE = 'formlab_pro_license_v1';
const AI_HISTORY_KEY = 'formlab_ai_history_v1';

function loadSessions(): WorkoutSessionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadProLicenseKey(): string {
  try {
    return localStorage.getItem(PRO_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

function loadAiHistory(): AiCoachEntry[] {
  try {
    const raw = localStorage.getItem(AI_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('coach');
  const [selectedExerciseId, setSelectedExerciseId] = useState<ExerciseId>('squat');
  const [strictness, setStrictness] = useState<StrictnessLevel>('standard');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  const [reps, setReps] = useState(0);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [avgFormScore, setAvgFormScore] = useState(0);
  const [latestAnalysis, setLatestAnalysis] = useState<PoseAnalysisResult | null>(null);
  const [sessionSavedNotice, setSessionSavedNotice] = useState(false);

  const [sessions, setSessions] = useState<WorkoutSessionRecord[]>(() =>
    loadSessions()
  );

  // Firebase Auth & Owner/Paid Pro entitlement state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [proLicenseKey, setProLicenseKey] = useState<string>(() => loadProLicenseKey());
  const [paidKeyVerified, setPaidKeyVerified] = useState(false);
  const [proCurrency, setProCurrency] = useState<ProCurrency>('USD');
  const [proRequests, setProRequests] = useState<ProAccessRequestRecord[]>([]);

  const [aiHistory, setAiHistory] = useState<AiCoachEntry[]>(() =>
    loadAiHistory()
  );

  const isOwner = isVerifiedOwner(user);
  const isProActive = isOwner || paidKeyVerified;

  // Refs for accurate frame-by-frame accumulation without excessive React re-renders
  const scoreSumRef = useRef(0);
  const scoreCountRef = useRef(0);
  const issueCountsRef = useRef<Map<string, number>>(new Map());
  const lastUiSyncRef = useRef(0);
  const audioEnabledRef = useRef(audioEnabled);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
    if (!audioEnabled) {
      audioCoach.stopSpeech();
    }
  }, [audioEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // Storage unavailable
    }
  }, [sessions]);

  useEffect(() => {
    try {
      if (proLicenseKey) {
        localStorage.setItem(PRO_KEY_STORAGE, proLicenseKey);
      } else {
        localStorage.removeItem(PRO_KEY_STORAGE);
      }
    } catch {
      // Storage unavailable
    }
  }, [proLicenseKey]);

  useEffect(() => {
    try {
      localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(aiHistory));
    } catch {
      // Storage unavailable
    }
  }, [aiHistory]);

  const verifyServerProStatus = useCallback(
    async (currentUser: User | null, keyToVerify: string): Promise<boolean> => {
      if (!currentUser) {
        setPaidKeyVerified(false);
        return false;
      }
      if (isVerifiedOwner(currentUser)) {
        setPaidKeyVerified(false);
        return true;
      }
      if (!keyToVerify) {
        setPaidKeyVerified(false);
        return false;
      }
      try {
        const idToken = await currentUser.getIdToken();
        const resp = await fetch('/api/pro-status', {
          headers: {
            Authorization: `Bearer ${idToken}`,
            'x-formlab-pro-key': keyToVerify,
          },
        });
        if (!resp.ok) {
          setPaidKeyVerified(false);
          return false;
        }
        const data = (await resp.json()) as { isProActive?: boolean };
        const valid = Boolean(data.isProActive);
        setPaidKeyVerified(valid);
        return valid;
      } catch {
        setPaidKeyVerified(false);
        return false;
      }
    },
    []
  );

  // Firebase Auth listener + Firestore user profile sync
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        setPaidKeyVerified(false);
        setProRequests([]);
        return;
      }

      try {
        const profile = await syncUserProfile(nextUser, proCurrency);
        if (profile?.proCurrency) {
          setProCurrency(profile.proCurrency);
        }
      } catch (err) {
        console.error('Failed to sync profile:', err);
      }

      await verifyServerProStatus(nextUser, proLicenseKey);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Firestore real-time subscription for Pro Requests (owner sees all, member sees own)
  useEffect(() => {
    if (!authReady || !user) return;
    const unsub = subscribeProRequests(
      user,
      isVerifiedOwner(user),
      (reqs) => setProRequests(reqs),
      (err) => console.error('Pro requests listener error:', err.message)
    );
    return () => unsub();
  }, [authReady, user]);

  const handleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Google Sign-In could not be completed. Allow popups and try again.';
      setAuthError(msg);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setAuthError(null);
    try {
      await signOutUser();
    } catch {
      // Ignore sign out error
    }
  }, []);

  const handleChangeCurrency = useCallback(
    async (currency: ProCurrency) => {
      setProCurrency(currency);
      if (user) {
        try {
          await updateProfileCurrency(user.uid, currency);
        } catch {
          // Non-fatal
        }
      }
    },
    [user]
  );

  const handleActivateProKey = useCallback(
    async (candidateKey: string): Promise<boolean> => {
      const valid = await verifyServerProStatus(user, candidateKey);
      if (valid) {
        setProLicenseKey(candidateKey);
      }
      return valid;
    },
    [user, verifyServerProStatus]
  );

  const handleClearProKey = useCallback(() => {
    setProLicenseKey('');
    setPaidKeyVerified(false);
  }, []);

  const exercise = EXERCISES[selectedExerciseId];

  const resetSetCounters = useCallback(() => {
    setReps(0);
    setHoldSeconds(0);
    setAvgFormScore(0);
    setLatestAnalysis(null);
    setSessionSavedNotice(false);
    scoreSumRef.current = 0;
    scoreCountRef.current = 0;
    issueCountsRef.current.clear();
  }, []);

  const handleSelectExercise = useCallback(
    (id: ExerciseId) => {
      setSelectedExerciseId(id);
      resetSetCounters();
    },
    [resetSetCounters]
  );

  const handleAnalysisUpdate = useCallback(
    (result: PoseAnalysisResult, deltaSec: number) => {
      if (result.repIncrement) {
        setReps((r) => r + 1);
        if (audioEnabledRef.current) {
          audioCoach.playRepChime();
        }
      }

      if (result.isHoldExercise && result.holdActive && deltaSec > 0) {
        setHoldSeconds((t) => t + deltaSec);
      }

      if (result.bodyVisible && result.formScore > 0) {
        scoreSumRef.current += result.formScore;
        scoreCountRef.current += 1;

        for (const cp of result.checkpoints) {
          if (cp.status === 'error' || cp.status === 'warn') {
            issueCountsRef.current.set(
              cp.label,
              (issueCountsRef.current.get(cp.label) ?? 0) + 1
            );
          }
        }

        if (audioEnabledRef.current && result.primaryStatus === 'error') {
          audioCoach.speakCue(result.primaryCue);
        }
      }

      // Throttle UI deck state updates to ~10 Hz
      const now = performance.now();
      if (result.repIncrement || now - lastUiSyncRef.current >= 95) {
        lastUiSyncRef.current = now;
        setLatestAnalysis(result);
        if (scoreCountRef.current > 0) {
          setAvgFormScore(Math.round(scoreSumRef.current / scoreCountRef.current));
        }
      }
    },
    []
  );

  const handleSaveSession = useCallback(() => {
    const computedAvg =
      scoreCountRef.current > 0
        ? Math.round(scoreSumRef.current / scoreCountRef.current)
        : avgFormScore || 90;

    const sortedIssues = Array.from(issueCountsRef.current.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([label]) => label);

    const record: WorkoutSessionRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      timestamp: Date.now(),
      reps: exercise.isHold ? 0 : reps,
      holdSeconds: exercise.isHold ? Number(holdSeconds.toFixed(1)) : 0,
      avgFormScore: computedAvg,
      strictness,
      topIssues: sortedIssues,
    };

    setSessions((prev) => [record, ...prev]);
    setSessionSavedNotice(true);
    setTimeout(() => setSessionSavedNotice(false), 2600);
  }, [avgFormScore, exercise.id, exercise.isHold, exercise.name, holdSeconds, reps, strictness]);

  const handlePracticeFromLibrary = useCallback(
    (id: ExerciseId, startCamera: boolean) => {
      handleSelectExercise(id);
      setActiveView('coach');
      if (startCamera) {
        setIsCameraActive(true);
      }
    },
    [handleSelectExercise]
  );

  const handleNavigate = useCallback((view: AppView) => {
    setActiveView(view);
    if (view !== 'coach') {
      // Stop live camera when navigating away from coach view so hardware LED turns off cleanly
      setIsCameraActive(false);
    }
  }, []);

  const handleToggleCamera = useCallback(() => {
    if (activeView !== 'coach') {
      setActiveView('coach');
      setIsCameraActive(true);
    } else {
      setIsCameraActive((prev) => !prev);
    }
  }, [activeView]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        activeView={activeView}
        onNavigate={handleNavigate}
        isCameraActive={isCameraActive}
        onToggleCamera={handleToggleCamera}
        userEmail={user?.email ?? null}
        isOwner={isOwner}
        authReady={authReady}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
      />

      <main className="flex-1">
        {activeView === 'coach' && (
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 py-6">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              <div className="xl:col-span-8">
                <CameraPoseStage
                  exercise={exercise}
                  strictness={strictness}
                  isCameraActive={isCameraActive}
                  onCameraStateChange={setIsCameraActive}
                  onAnalysisUpdate={handleAnalysisUpdate}
                />
              </div>

              <div className="xl:col-span-4">
                <CoachingDeck
                  exercise={exercise}
                  onSelectExercise={handleSelectExercise}
                  strictness={strictness}
                  onChangeStrictness={setStrictness}
                  audioEnabled={audioEnabled}
                  onToggleAudio={() => setAudioEnabled((a) => !a)}
                  reps={reps}
                  holdSeconds={holdSeconds}
                  avgFormScore={avgFormScore}
                  analysis={latestAnalysis}
                  onResetCounter={resetSetCounters}
                  onSaveSession={handleSaveSession}
                  sessionSavedNotice={sessionSavedNotice}
                  isProActive={isProActive}
                  isOwner={isOwner}
                  onOpenAiCoach={() => handleNavigate('ai_coach')}
                />
              </div>
            </div>
          </div>
        )}

        {activeView === 'library' && (
          <ExerciseLibraryView
            selectedExerciseId={selectedExerciseId}
            onPracticeExercise={handlePracticeFromLibrary}
          />
        )}

        {activeView === 'classroom' && (
          <ClassroomView
            selectedExerciseId={selectedExerciseId}
            sessions={sessions}
            onPracticeExercise={handlePracticeFromLibrary}
          />
        )}

        {activeView === 'ai_coach' && (
          <AiCoachView
            user={user}
            authReady={authReady}
            authError={authError}
            isOwner={isOwner}
            isProActive={isProActive}
            proLicenseKey={proLicenseKey}
            proCurrency={proCurrency}
            proRequests={proRequests}
            onSignIn={handleSignIn}
            onChangeCurrency={handleChangeCurrency}
            onActivateProKey={handleActivateProKey}
            onClearProKey={handleClearProKey}
            exercise={exercise}
            strictness={strictness}
            latestAnalysis={latestAnalysis}
            sessions={sessions}
            history={aiHistory}
            onAddEntry={(entry) => setAiHistory((prev) => [entry, ...prev])}
            onClearHistory={() => setAiHistory([])}
            onReturnToLiveCoach={() => setActiveView('coach')}
          />
        )}

        {activeView === 'history' && (
          <SessionLogView
            sessions={sessions}
            onClearSessions={() => setSessions([])}
            onStartWorkout={() => setActiveView('coach')}
          />
        )}

        {activeView === 'calibration' && (
          <CalibrationGuideView
            onLaunchCoach={() => setActiveView('coach')}
          />
        )}
      </main>
    </div>
  );
}
