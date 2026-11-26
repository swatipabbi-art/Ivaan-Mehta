import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import type { Request, Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const OWNER_EMAIL = 'swatipabbi@gmail.com';
const PRO_SIGNING_SECRET =
  process.env.PRO_SIGNING_SECRET || crypto.randomBytes(32).toString('hex');

interface FirebaseAppletConfig {
  projectId?: string;
}

function loadFirebaseProjectId(): string | null {
  try {
    const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw) as FirebaseAppletConfig;
    if (
      parsed.projectId &&
      parsed.projectId !== 'remixed-project-id'
    ) {
      return parsed.projectId;
    }
    return null;
  } catch {
    return null;
  }
}

const firebaseProjectId = loadFirebaseProjectId();
const adminAuth = firebaseProjectId
  ? getAuth(
      getApps().length
        ? getApp()
        : initializeApp({ projectId: firebaseProjectId })
    )
  : null;

interface ProLicensePayload {
  email: string;
  currency: 'USD' | 'INR';
  issuedAt: number;
}

function signProLicense(payload: ProLicensePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', PRO_SIGNING_SECRET)
    .update(encoded)
    .digest('base64url');
  return `FLPRO.${encoded}.${sig}`;
}

function verifyProLicense(token: string, expectedEmail?: string | null): ProLicensePayload | null {
  try {
    const parts = token.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'FLPRO') return null;
    const [, encoded, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', PRO_SIGNING_SECRET)
      .update(encoded)
      .digest('base64url');
    const sigBuf = Buffer.from(sig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as ProLicensePayload;
    if (!payload?.email || typeof payload.email !== 'string') return null;
    if (
      expectedEmail &&
      payload.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function verifyCallerAuth(req: Request): Promise<DecodedIdToken | null> {
  if (!adminAuth) return null;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;
  try {
    return await adminAuth.verifyIdToken(idToken);
  } catch {
    return null;
  }
}

function isVerifiedOwnerToken(decoded: DecodedIdToken | null): boolean {
  if (!decoded || !decoded.email_verified || !decoded.email) return false;
  return decoded.email.trim().toLowerCase() === OWNER_EMAIL;
}

interface CoachRequestBody {
  question?: string;
  exerciseName?: string;
  exerciseCategory?: string;
  audience?: string;
  strictness?: string;
  checkpoints?: Array<{
    label: string;
    currentValueText: string;
    targetText: string;
    status: string;
    feedback: string;
  }>;
  recentSessions?: Array<{
    exerciseName: string;
    reps: number;
    holdSeconds: number;
    avgFormScore: number;
    topIssues: string[];
  }>;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseGeminiError(err: unknown): { status: number; message: string; retryable: boolean } {
  const raw = err instanceof Error ? err.message : String(err || 'Unable to reach Gemini AI Coach service.');
  try {
    const parsed = JSON.parse(raw) as {
      error?: { code?: number; message?: string; status?: string };
    };
    const code = parsed?.error?.code ?? 500;
    const statusStr = parsed?.error?.status ?? '';
    const msg = parsed?.error?.message ?? raw;

    if (code === 400 || code === 403 || statusStr === 'PERMISSION_DENIED' || statusStr === 'API_KEY_INVALID') {
      return {
        status: code === 403 ? 403 : 400,
        message: 'Gemini API key is invalid or missing permissions. Please verify GEMINI_API_KEY in Settings > Secrets.',
        retryable: false,
      };
    }
    if (code === 429 || statusStr === 'RESOURCE_EXHAUSTED') {
      return {
        status: 429,
        message: 'AI Coach rate limit reached temporarily. Please wait a few seconds and try again.',
        retryable: true,
      };
    }
    if (code === 503 || code === 502 || code === 504 || statusStr === 'UNAVAILABLE') {
      return {
        status: 503,
        message: 'AI Coach model is experiencing temporary high demand. Please try again in a moment.',
        retryable: true,
      };
    }
    return { status: code >= 400 && code < 600 ? code : 500, message: msg, retryable: code >= 500 };
  } catch {
    const isTransient = /503|UNAVAILABLE|overloaded|high demand|timeout|timed out|ECONNRESET|ETIMEDOUT/i.test(raw);
    return {
      status: isTransient ? 503 : 500,
      message: isTransient
        ? 'AI Coach model is experiencing temporary high demand. Please try again in a moment.'
        : raw,
      retryable: isTransient,
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function generateCoachResponse(
  ai: GoogleGenAI,
  prompt: string
) {
  const buildConfig = (model: string) => ({
    model,
    contents: prompt,
    config: {
      thinkingConfig: {
        thinkingLevel: model === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW,
      },
      systemInstruction:
        'You are FormLab AI Coach, an expert biomechanics specialist, physical-education teacher for children (ages 5-12), and strength & mobility coach for adults. Give concise, practical, safety-first solutions. If the exercise or question involves children, keep cues playful, encouraging, and joint-safe. Never invent medical diagnoses; suggest safe regressions and clear camera alignment cues.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: 'A clear 1-2 sentence direct answer summarizing the solution.',
          },
          rootCause: {
            type: Type.STRING,
            description: 'Why this movement fault or difficulty typically happens biomechanically.',
          },
          stepByStepFix: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '3 to 4 actionable, numbered coaching steps to fix the form immediately.',
          },
          recommendedDrill: {
            type: Type.STRING,
            description: 'One practical regression or warm-up drill (with sets/reps or seconds) to build the pattern.',
          },
          cameraSensorCue: {
            type: Type.STRING,
            description: 'What specific joint angle or checkpoint in FormLab Live Coach to watch next set.',
          },
        },
        required: [
          'summary',
          'rootCause',
          'stepByStepFix',
          'recommendedDrill',
          'cameraSensorCue',
        ],
      },
    },
  });

  const attempts = [
    { model: 'gemini-4-hydrogen', timeoutMs: 12000 },
    { model: 'gemini-3.1-flash-lite', timeoutMs: 12000 },
  ];

  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const { model, timeoutMs } = attempts[i];
    try {
      return await withTimeout(
        ai.models.generateContent(buildConfig(model)),
        timeoutMs,
        `AI Coach (${model})`
      );
    } catch (err) {
      lastErr = err;
      const info = parseGeminiError(err);
      if (!info.retryable || i === attempts.length - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastErr;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get('/favicon.ico', (_req: Request, res: Response) => {
    const publicIcon = path.resolve(__dirname, 'public', 'favicon.ico');
    const distIcon = path.resolve(__dirname, 'dist', 'favicon.ico');
    const rootIcon = path.resolve(__dirname, 'favicon.ico');
    const iconPath = fs.existsSync(publicIcon)
      ? publicIcon
      : fs.existsSync(distIcon)
      ? distIcon
      : rootIcon;
    if (fs.existsSync(iconPath)) {
      res.sendFile(iconPath);
      return;
    }
    res.status(404).end();
  });

  app.get('/api/pro-status', async (req: Request, res: Response) => {
    const decoded = await verifyCallerAuth(req);
    const owner = isVerifiedOwnerToken(decoded);
    const proKeyHeader =
      typeof req.headers['x-formlab-pro-key'] === 'string'
        ? req.headers['x-formlab-pro-key']
        : '';
    const validPaidKey =
      decoded && decoded.email_verified && decoded.email && proKeyHeader
        ? verifyProLicense(proKeyHeader, decoded.email)
        : null;

    res.json({
      authenticated: Boolean(decoded),
      isOwner: owner,
      isProActive: Boolean(owner || validPaidKey),
      accessTier: owner ? 'owner_free' : validPaidKey ? 'paid_pro' : 'free',
    });
  });

  app.post('/api/owner/issue-license', async (req: Request, res: Response) => {
    const decoded = await verifyCallerAuth(req);
    if (!isVerifiedOwnerToken(decoded)) {
      res.status(403).json({
        error: 'Only the verified site owner (swatipabbi@gmail.com) can issue FormLab Pro passes.',
      });
      return;
    }

    const body = (req.body || {}) as { email?: string; currency?: string };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const currency = body.currency === 'INR' ? 'INR' : 'USD';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Please provide a valid customer email address.' });
      return;
    }

    const licenseKey = signProLicense({
      email,
      currency,
      issuedAt: Date.now(),
    });

    res.json({
      licenseKey,
      email,
      currency,
    });
  });

  app.post('/api/ai-coach', async (req: Request, res: Response) => {
    const decoded = await verifyCallerAuth(req);
    if (!decoded || !decoded.email_verified || !decoded.email) {
      res.status(401).json({
        error:
          'Please sign in with Google first. FormLab Pro is free for swatipabbi@gmail.com and paid ($29 USD / ₹100) for other accounts.',
      });
      return;
    }

    const owner = isVerifiedOwnerToken(decoded);
    const proKeyHeader =
      typeof req.headers['x-formlab-pro-key'] === 'string'
        ? req.headers['x-formlab-pro-key']
        : '';
    const validPaidKey = verifyProLicense(proKeyHeader, decoded.email);

    if (!owner && !validPaidKey) {
      res.status(402).json({
        error:
          'FormLab Pro ($29 USD / ₹100) is required for AI Coach Solutions. Free access is limited to the owner account.',
      });
      return;
    }

    const body = (req.body || {}) as CoachRequestBody;
    const question = typeof body.question === 'string' ? body.question.trim() : '';

    if (!question) {
      res.status(400).json({ error: 'Please enter a form question or issue to solve.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured. Add your key in the Settings > Secrets panel to enable AI Coach responses.',
      });
      return;
    }

    const contextLines: string[] = [];
    if (body.exerciseName) {
      contextLines.push(
        `Current Exercise: ${body.exerciseName} (${body.exerciseCategory || 'General'}, Audience: ${body.audience || 'All'}, Strictness: ${body.strictness || 'standard'})`
      );
    }
    if (Array.isArray(body.checkpoints) && body.checkpoints.length > 0) {
      const cpText = body.checkpoints
        .map(
          (cp) =>
            `- ${cp.label}: live=${cp.currentValueText}, target=${cp.targetText}, status=${cp.status} (${cp.feedback})`
        )
        .join('\n');
      contextLines.push(`Live Pose Sensor Checkpoints:\n${cpText}`);
    }
    if (Array.isArray(body.recentSessions) && body.recentSessions.length > 0) {
      const sessText = body.recentSessions
        .slice(0, 5)
        .map(
          (s) =>
            `- ${s.exerciseName}: ${s.holdSeconds > 0 ? `${s.holdSeconds}s hold` : `${s.reps} reps`}, avgForm=${s.avgFormScore}%, issues=[${s.topIssues.join(', ') || 'none'}]`
        )
        .join('\n');
      contextLines.push(`Recent Logged Sets:\n${sessText}`);
    }

    const prompt = [
      contextLines.length > 0 ? contextLines.join('\n\n') : 'No active camera session data provided.',
      `\nUser Question / Problem to Solve:\n${question}`,
    ].join('\n');

    try {
      const response = await generateCoachResponse(ai, prompt);

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'AI Coach returned an empty response. Please try again.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json({ solution: parsed });
    } catch (err) {
      const { status, message } = parseGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FormLab server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
