import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { FormEvent, useState } from 'react';
import type { User } from 'firebase/auth';
import { OWNER_EMAIL, resolveProRequest, submitProAccessRequest } from '../firebase';
import {
  AiCoachEntry,
  ExerciseDefinition,
  PoseAnalysisResult,
  ProAccessRequestRecord,
  ProCurrency,
  StrictnessLevel,
  WorkoutSessionRecord,
} from '../types/exercise';

interface AiCoachViewProps {
  user: User | null;
  authReady: boolean;
  authError: string | null;
  isOwner: boolean;
  isProActive: boolean;
  proLicenseKey: string;
  proCurrency: ProCurrency;
  proRequests: ProAccessRequestRecord[];
  onSignIn: () => void;
  onChangeCurrency: (currency: ProCurrency) => void;
  onActivateProKey: (key: string) => Promise<boolean>;
  onClearProKey: () => void;
  exercise: ExerciseDefinition;
  strictness: StrictnessLevel;
  latestAnalysis: PoseAnalysisResult | null;
  sessions: WorkoutSessionRecord[];
  history: AiCoachEntry[];
  onAddEntry: (entry: AiCoachEntry) => void;
  onClearHistory: () => void;
  onReturnToLiveCoach: () => void;
}

const PRO_BENEFITS = [
  'Personalized AI Solutions synced with your live camera joint angles',
  'Age-appropriate movement adaptations for children (Ages 5–12)',
  'Step-by-step biomechanical fixes and mobility drills for form faults',
  'Full Session Log trend analysis with targeted corrective workouts',
];

export function AiCoachView({
  user,
  authReady,
  authError,
  isOwner,
  isProActive,
  proLicenseKey,
  proCurrency,
  proRequests,
  onSignIn,
  onChangeCurrency,
  onActivateProKey,
  onClearProKey,
  exercise,
  strictness,
  latestAnalysis,
  sessions,
  history,
  onAddEntry,
  onClearHistory,
  onReturnToLiveCoach,
}: AiCoachViewProps) {
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Paid member checkout / pass key states
  const [paymentRef, setPaymentRef] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  const [licenseInput, setLicenseInput] = useState('');
  const [activatingKey, setActivatingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Owner license issuer states
  const [issueEmail, setIssueEmail] = useState('');
  const [issueCurrency, setIssueCurrency] = useState<ProCurrency>('USD');
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [issuingKey, setIssuingKey] = useState(false);
  const [ownerActionMsg, setOwnerActionMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const priceDisplay = proCurrency === 'USD' ? '$29 USD' : '₹100';

  const quickPrompts =
    exercise.audience === 'kids'
      ? [
          `How can I make ${exercise.name} easier and fun for an 8-year-old who wobbles?`,
          `My child rushes through ${exercise.name}—what playful pacing cues work best?`,
          `What warm-up game prepares kids for ${exercise.name}?`,
        ]
      : [
          `How do I fix my biggest checkpoint issue on ${exercise.name}?`,
          `What mobility drill helps if I feel tightness during ${exercise.name}?`,
          `Analyze my recent Session Log and give 3 focused drills for my next set.`,
        ];

  const handleSubmit = async (e?: FormEvent, overridePrompt?: string) => {
    if (e) e.preventDefault();
    const promptText = (overridePrompt ?? question).trim();
    if (!promptText || isLoading || !user) return;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const idToken = await user.getIdToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      };
      if (proLicenseKey) {
        headers['x-formlab-pro-key'] = proLicenseKey;
      }

      const response = await fetch('/api/ai-coach', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question: promptText,
          exerciseName: exercise.name,
          exerciseCategory: exercise.category,
          audience:
            exercise.audience === 'kids'
              ? `Children (${exercise.ageGroup || 'Ages 5–12'})`
              : 'General / Adult',
          strictness,
          checkpoints: latestAnalysis?.checkpoints ?? [],
          recentSessions: sessions.slice(0, 5),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'AI Coach request failed.');
      }

      const entry: AiCoachEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        question: promptText,
        exerciseName: exercise.name,
        timestamp: Date.now(),
        solution: data.solution,
      };
      onAddEntry(entry);
      if (!overridePrompt) {
        setQuestion('');
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Unable to reach AI Coach service right now.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitPaymentRef = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || submittingRequest) return;
    setSubmittingRequest(true);
    setRequestNotice(null);
    setKeyError(null);
    try {
      await submitProAccessRequest({
        user,
        currency: proCurrency,
        paymentReference: paymentRef,
      });
      setPaymentRef('');
      setRequestNotice(
        'Payment reference submitted. Once the owner approves it, enter your Pro Pass Key below to unlock AI Coach.'
      );
    } catch (err) {
      setKeyError(
        err instanceof Error ? err.message : 'Could not submit payment verification.'
      );
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleVerifyKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!licenseInput.trim() || activatingKey) return;
    setActivatingKey(true);
    setKeyError(null);
    try {
      const ok = await onActivateProKey(licenseInput.trim());
      if (!ok) {
        setKeyError(
          'That Pro Pass Key is invalid or does not match your signed-in Google email.'
        );
      } else {
        setLicenseInput('');
      }
    } finally {
      setActivatingKey(false);
    }
  };

  const handleIssueOwnerLicense = async (
    targetEmail: string,
    currency: ProCurrency,
    pendingReq?: ProAccessRequestRecord
  ) => {
    if (!user || !isOwner || issuingKey) return;
    setIssuingKey(true);
    setOwnerActionMsg(null);
    setIssuedKey(null);
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/owner/issue-license', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email: targetEmail, currency }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to issue Pro Pass Key.');
      }

      if (pendingReq && pendingReq.status === 'pending') {
        await resolveProRequest({
          requestId: pendingReq.requestId,
          targetUid: pendingReq.uid,
          status: 'approved',
        });
      }

      setIssuedKey(data.licenseKey);
      setOwnerActionMsg(`Issued paid Pro Pass Key for ${data.email} (${data.currency}).`);
      setIssueEmail('');
    } catch (err) {
      setOwnerActionMsg(
        err instanceof Error ? err.message : 'Unable to issue Pro Pass Key.'
      );
    } finally {
      setIssuingKey(false);
    }
  };

  const handleCopyIssuedKey = async () => {
    if (!issuedKey) return;
    try {
      await navigator.clipboard.writeText(issuedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  // ===========================================================================
  // Gate View: Unauthenticated OR Non-Owner without Verified Paid Pro Pass
  // ===========================================================================
  if (!isProActive) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Explanation */}
          <div className="lg:col-span-7 flex flex-col justify-between gap-6 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>FormLab Pro Required · Paid for Visitors</span>
              </div>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 text-balance">
                AI Coach For Solutions
              </h1>
              <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
                Unlock personalized movement troubleshooting powered by Gemini. Ask why a joint angle keeps drifting, get playful coaching cues for children’s exercises, or turn your Session Log into a targeted corrective drill plan.
              </p>

              <div className="mt-6 border-t border-slate-100 pt-6">
                <h2 className="text-sm font-semibold text-slate-900">
                  Included with FormLab Pro
                </h2>
                <ul className="mt-3 space-y-3">
                  {PRO_BENEFITS.map((benefit, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600 flex flex-col gap-1">
              <div>
                Currently selected context:{' '}
                <span className="font-semibold text-slate-900">{exercise.name}</span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>{sessions.length} logged sets</span>
              </div>
              <div className="text-slate-500">
                Owner account (<span className="font-mono text-slate-700">{OWNER_EMAIL}</span>) receives automatic free access on Google Sign-In.
              </div>
            </div>
          </div>

          {/* Right Pro Upgrade / Sign-In Card */}
          <div className="lg:col-span-5 bg-slate-900 text-white rounded-xl p-6 sm:p-8 flex flex-col justify-between gap-6">
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-display text-lg font-semibold text-white">
                  FormLab Pro
                </span>
                <div
                  className="inline-flex items-center gap-1 p-1 bg-slate-800 rounded-lg"
                  role="group"
                  aria-label="Select currency"
                >
                  <button
                    type="button"
                    onClick={() => onChangeCurrency('USD')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      proCurrency === 'USD'
                        ? 'bg-white text-slate-900'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    USD ($29)
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeCurrency('INR')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      proCurrency === 'INR'
                        ? 'bg-white text-slate-900'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    INR (₹100)
                  </button>
                </div>
              </div>

              <div className="mt-5 flex items-baseline gap-2.5">
                <span className="font-display text-4xl font-bold tracking-tight tabular-nums">
                  {priceDisplay}
                </span>
                <span className="text-xs text-slate-400">
                  {proCurrency === 'USD' ? 'or ₹100 INR' : 'or $29 USD'} · Paid Access
                </span>
              </div>

              <p className="mt-2.5 text-xs text-slate-300 leading-relaxed">
                Free for the site owner ({OWNER_EMAIL}). Other users require a paid {priceDisplay} Pro pass to run AI Coach Solutions.
              </p>
            </div>

            {authError && (
              <div
                role="alert"
                className="rounded-lg border border-rose-500/40 bg-rose-950/60 px-3 py-2 text-xs text-rose-200"
              >
                {authError}
              </div>
            )}

            {!authReady ? (
              <div className="flex items-center gap-2 text-xs text-slate-300 py-4">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Checking account status...</span>
              </div>
            ) : !user ? (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={onSignIn}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Sign in with Google</span>
                </button>
                <p className="text-[11px] text-slate-400 text-center">
                  Sign in as {OWNER_EMAIL} for free owner access, or sign in with your account to purchase {priceDisplay} Pro.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 border-t border-slate-800 pt-4">
                <div className="text-xs text-slate-300">
                  Signed in as <strong className="text-white">{user.email}</strong> (Paid Plan Required)
                </div>

                {/* Step 1: Submit payment reference */}
                <form onSubmit={handleSubmitPaymentRef} className="flex flex-col gap-2">
                  <label htmlFor="payment-ref" className="text-xs font-medium text-slate-300">
                    1. Submit {priceDisplay} Payment Reference
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="payment-ref"
                      type="text"
                      value={paymentRef}
                      onChange={(e) => setPaymentRef(e.target.value)}
                      placeholder="Transaction / UPI ID"
                      className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={submittingRequest || paymentRef.trim().length < 2}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {submittingRequest ? 'Sending...' : 'Request Pro'}
                    </button>
                  </div>
                </form>

                {/* Step 2: Redeem issued Pro Pass Key */}
                <form onSubmit={handleVerifyKey} className="flex flex-col gap-2">
                  <label htmlFor="pro-key-input" className="text-xs font-medium text-slate-300">
                    2. Activate Paid Pro Pass Key
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="pro-key-input"
                      type="text"
                      value={licenseInput}
                      onChange={(e) => setLicenseInput(e.target.value)}
                      placeholder="Paste FLPRO... pass key"
                      className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-mono text-white placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={activatingKey || !licenseInput.trim()}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{activatingKey ? 'Verifying...' : 'Activate'}</span>
                    </button>
                  </div>
                </form>

                {requestNotice && (
                  <p className="text-xs text-emerald-300 leading-relaxed">{requestNotice}</p>
                )}
                {keyError && (
                  <p className="text-xs text-rose-300 leading-relaxed">{keyError}</p>
                )}

                {proRequests.length > 0 && (
                  <div className="rounded-lg border border-slate-800 bg-slate-800/60 p-3 text-xs">
                    <div className="font-semibold text-slate-200 mb-1.5">
                      Your Access Requests
                    </div>
                    <div className="space-y-1">
                      {proRequests.slice(0, 3).map((r) => (
                        <div key={r.requestId} className="flex items-center justify-between gap-2 text-slate-300">
                          <span className="truncate">{r.amountLabel} · {r.paymentReference}</span>
                          <span className="font-mono uppercase text-[10px] text-amber-300 shrink-0">
                            {r.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // Unlocked View: Verified Owner (Free $0) OR Paid Pro License Holder
  // ===========================================================================
  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
      {/* Header + Pro Status Strip */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {isOwner ? 'Owner Free Access · $0' : `FormLab Pro Active · ${priceDisplay}`}
            </span>
            <span aria-hidden="true">·</span>
            <span>{user?.email}</span>
            <span aria-hidden="true">·</span>
            <span>Synced with {exercise.name}</span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900">
            AI Coach For Solutions
          </h1>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {history.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear Solutions</span>
            </button>
          )}
          {!isOwner && proLicenseKey && (
            <button
              type="button"
              onClick={onClearProKey}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap"
            >
              Remove Pass Key
            </button>
          )}
        </div>
      </div>

      {/* Owner-Only Pro Pass & Payment Requests Manager */}
      {isOwner && (
        <section className="bg-slate-900 text-white rounded-xl p-5 sm:p-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Owner Control Panel</span>
              </div>
              <h2 className="mt-0.5 font-display text-base font-bold text-white">
                Issue Paid Pro Pass Keys ($29 USD / ₹100)
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Your account ({OWNER_EMAIL}) always has free Pro access.
            </span>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleIssueOwnerLicense(issueEmail, issueCurrency);
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <input
              type="email"
              required
              value={issueEmail}
              onChange={(e) => setIssueEmail(e.target.value)}
              placeholder="Paying customer Gmail (e.g. athlete@gmail.com)"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
            <select
              aria-label="Paid plan currency"
              value={issueCurrency}
              onChange={(e) => setIssueCurrency(e.target.value as ProCurrency)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
            >
              <option value="USD">$29 USD</option>
              <option value="INR">₹100 INR</option>
            </select>
            <button
              type="submit"
              disabled={issuingKey || !issueEmail.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{issuingKey ? 'Generating...' : 'Generate Pro Pass Key'}</span>
            </button>
          </form>

          {ownerActionMsg && (
            <div className="text-xs text-emerald-300">{ownerActionMsg}</div>
          )}

          {issuedKey && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-slate-800 px-3.5 py-2.5">
              <code className="text-xs font-mono text-emerald-300 truncate">
                {issuedKey}
              </code>
              <button
                type="button"
                onClick={handleCopyIssuedKey}
                className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-600 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
              </button>
            </div>
          )}

          {proRequests.length > 0 && (
            <div className="border-t border-slate-800 pt-3">
              <div className="text-xs font-semibold text-slate-300 mb-2">
                Visitor Pro Payment Requests ({proRequests.length})
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {proRequests.map((req) => (
                  <div
                    key={req.requestId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-800/70 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-white">{req.requesterEmail}</span>
                      <span className="mx-1.5 text-slate-500">·</span>
                      <span className="text-slate-300">{req.amountLabel}</span>
                      <span className="mx-1.5 text-slate-500">·</span>
                      <span className="font-mono text-slate-400">Ref: {req.paymentReference}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {req.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              handleIssueOwnerLicense(req.requesterEmail, req.currency, req)
                            }
                            className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 cursor-pointer"
                          >
                            Approve & Issue Key
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              resolveProRequest({
                                requestId: req.requestId,
                                targetUid: req.uid,
                                status: 'rejected',
                              })
                            }
                            className="rounded-md border border-slate-600 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer"
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <span className="font-mono uppercase text-[11px] text-emerald-400">
                          {req.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Prompt Composer */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Describe a Form Problem or Ask for a Drill
          </h2>
          <span className="text-xs text-slate-500">
            Context: {exercise.name}
            {exercise.ageGroup ? ` (${exercise.ageGroup})` : ''} · {strictness} mode
          </span>
        </div>

        {/* Quick Solution Chips */}
        <div className="flex flex-wrap gap-2">
          {quickPrompts.map((qp, i) => (
            <button
              key={i}
              type="button"
              disabled={isLoading}
              onClick={() => handleSubmit(undefined, qp)}
              className="text-left rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer disabled:opacity-50"
            >
              {qp}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => handleSubmit(e)} className="flex flex-col gap-3">
          <textarea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={`Ask about ${exercise.name} form, joint discomfort, or how to coach a child through this movement...`}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
          />

          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
            >
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {latestAnalysis?.bodyVisible
                ? `Includes ${latestAnalysis.checkpoints.length} live joint angle checkpoints`
                : `Includes ${sessions.length} logged sets from Session Log`}
            </span>
            <button
              type="submit"
              disabled={isLoading || !question.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Analyzing Form...</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Get AI Solution</span>
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* Solution Cards */}
      {history.length > 0 && (
        <div className="flex flex-col gap-5">
          {history.map((item) => (
            <article
              key={item.id}
              className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="text-xs font-medium text-slate-500">
                    {item.exerciseName}
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span>
                      {new Date(item.timestamp).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <h3 className="mt-1 font-display text-lg font-bold text-slate-900">
                    {item.question}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={onReturnToLiveCoach}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>Test in Live Coach</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              <p className="text-sm text-slate-800 font-medium leading-relaxed">
                {item.solution.summary}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-4">
                  <div className="text-xs font-semibold text-slate-800">
                    Biomechanical Root Cause
                  </div>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                    {item.solution.rootCause}
                  </p>
                </div>

                <div className="rounded-lg bg-emerald-50/60 border border-emerald-200/70 p-4">
                  <div className="text-xs font-semibold text-emerald-900">
                    Recommended Corrective Drill
                  </div>
                  <p className="mt-1.5 text-sm text-emerald-950 leading-relaxed">
                    {item.solution.recommendedDrill}
                  </p>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-800 mb-2">
                  Step-by-Step Fix
                </div>
                <ol className="space-y-2">
                  {item.solution.stepByStepFix.map((step, sIdx) => (
                    <li key={sIdx} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <span className="font-mono text-xs font-semibold text-blue-600 mt-0.5 shrink-0">
                        0{sIdx + 1}.
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="border-t border-slate-100 pt-3 flex items-center gap-2 text-xs text-slate-600">
                <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" aria-hidden="true" />
                <span>
                  <strong className="text-slate-900">Camera Sensor Cue:</strong>{' '}
                  {item.solution.cameraSensorCue}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
