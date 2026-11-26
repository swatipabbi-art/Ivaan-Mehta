import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type { ProAccessRequestRecord, ProCurrency, UserProfileRecord } from './types/exercise';

export const OWNER_EMAIL = 'swatipabbi@gmail.com';

export const CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.addons.student',
  'https://www.googleapis.com/auth/classroom.addons.teacher',
  'https://www.googleapis.com/auth/classroom.announcements',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.courses',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.guardianlinks.me.readonly',
  'https://www.googleapis.com/auth/classroom.guardianlinks.students',
  'https://www.googleapis.com/auth/classroom.guardianlinks.students.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/classroom.profile.photos',
  'https://www.googleapis.com/auth/classroom.push-notifications',
  'https://www.googleapis.com/auth/classroom.rosters',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  'https://www.googleapis.com/auth/classroom.topics',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
] as const;

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const baseGoogleProvider = new GoogleAuthProvider();
baseGoogleProvider.setCustomParameters({ prompt: 'select_account' });

const classroomGoogleProvider = new GoogleAuthProvider();
for (const scope of CLASSROOM_SCOPES) {
  classroomGoogleProvider.addScope(scope);
}
classroomGoogleProvider.setCustomParameters({ prompt: 'consent select_account' });

// In-memory cache ONLY for Google OAuth Workspace access token (never localStorage/sessionStorage)
let cachedWorkspaceAccessToken: string | null = null;

export function getWorkspaceAccessToken(): string | null {
  return cachedWorkspaceAccessToken;
}

export function clearWorkspaceAccessToken(): void {
  cachedWorkspaceAccessToken = null;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function isVerifiedOwner(user: User | null): boolean {
  if (!user || !user.emailVerified || !user.email) return false;
  return user.email.trim().toLowerCase() === OWNER_EMAIL;
}

export async function signInWithGoogle(): Promise<User> {
  const credential = await signInWithPopup(auth, baseGoogleProvider);
  const oauthCred = GoogleAuthProvider.credentialFromResult(credential);
  if (oauthCred?.accessToken) {
    cachedWorkspaceAccessToken = oauthCred.accessToken;
  }
  return credential.user;
}

export async function signInWithGoogleClassroom(): Promise<{
  user: User;
  accessToken: string;
}> {
  const result = await signInWithPopup(auth, classroomGoogleProvider);
  const oauthCred = GoogleAuthProvider.credentialFromResult(result);
  if (!oauthCred?.accessToken) {
    throw new Error('Could not obtain Google Classroom permission token.');
  }
  cachedWorkspaceAccessToken = oauthCred.accessToken;
  return { user: result.user, accessToken: oauthCred.accessToken };
}

export async function signOutUser(): Promise<void> {
  cachedWorkspaceAccessToken = null;
  await signOut(auth);
}

function sanitizeDisplayName(user: User): string {
  const raw = (user.displayName || user.email?.split('@')[0] || 'Athlete').trim();
  return raw.slice(0, 120) || 'Athlete';
}

export async function syncUserProfile(
  user: User,
  preferredCurrency: ProCurrency
): Promise<UserProfileRecord> {
  const isOwner = isVerifiedOwner(user);
  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/info`;
  const userRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'info');
  const displayName = sanitizeDisplayName(user);
  const email = (user.email || '').trim().slice(0, 254);

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      const created: UserProfileRecord = {
        uid: user.uid,
        displayName,
        role: isOwner ? 'owner' : 'member',
        proActive: isOwner,
        proCurrency: preferredCurrency,
      };
      await setDoc(userRef, {
        ...created,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existing = snap.data() as Partial<UserProfileRecord>;
      if (isOwner && (existing.role !== 'owner' || existing.proActive !== true)) {
        await updateDoc(userRef, {
          displayName,
          role: 'owner',
          proActive: true,
          updatedAt: serverTimestamp(),
        });
      } else if (existing.displayName !== displayName) {
        await updateDoc(userRef, {
          displayName,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  if (email) {
    try {
      const privSnap = await getDoc(privateRef);
      if (!privSnap.exists()) {
        await setDoc(privateRef, {
          uid: user.uid,
          email,
          updatedAt: serverTimestamp(),
        });
      } else if ((privSnap.data() as { email?: string })?.email !== email) {
        await updateDoc(privateRef, {
          email,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
  }

  try {
    const finalSnap = await getDoc(userRef);
    const data = finalSnap.data() as UserProfileRecord;
    return {
      uid: user.uid,
      displayName: data?.displayName || displayName,
      role: isOwner ? 'owner' : data?.role || 'member',
      proActive: isOwner ? true : Boolean(data?.proActive),
      proCurrency: data?.proCurrency || preferredCurrency,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }
}

export async function updateProfileCurrency(
  uid: string,
  currency: ProCurrency
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      proCurrency: currency,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function submitProAccessRequest(params: {
  user: User;
  currency: ProCurrency;
  paymentReference: string;
}): Promise<void> {
  const { user, currency, paymentReference } = params;
  const cleanRef = paymentReference.trim().slice(0, 120);
  if (cleanRef.length < 2) {
    throw new Error('Please enter a valid payment reference or transaction ID.');
  }
  const requestId = `req_${user.uid.slice(0, 16)}_${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const path = `proRequests/${requestId}`;
  const amountLabel: '$29 USD' | '₹100' = currency === 'USD' ? '$29 USD' : '₹100';

  try {
    await setDoc(doc(db, 'proRequests', requestId), {
      requestId,
      uid: user.uid,
      requesterName: sanitizeDisplayName(user),
      requesterEmail: (user.email || '').trim().slice(0, 254),
      currency,
      amountLabel,
      paymentReference: cleanRef,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeProRequests(
  user: User,
  isOwner: boolean,
  onUpdate: (requests: ProAccessRequestRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'proRequests';
  const q = isOwner
    ? query(collection(db, path))
    : query(collection(db, path), where('uid', '==', user.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as ProAccessRequestRecord);
      onUpdate(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function resolveProRequest(params: {
  requestId: string;
  targetUid: string;
  status: 'approved' | 'rejected';
}): Promise<void> {
  const { requestId, targetUid, status } = params;
  const reqPath = `proRequests/${requestId}`;
  try {
    await updateDoc(doc(db, 'proRequests', requestId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, reqPath);
  }

  if (status === 'approved') {
    const userPath = `users/${targetUid}`;
    try {
      const userRef = doc(db, 'users', targetUid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        await updateDoc(userRef, {
          proActive: true,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, userPath);
    }
  }
}
