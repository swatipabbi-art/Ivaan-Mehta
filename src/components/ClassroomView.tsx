import {
  AlertCircle,
  BookOpen,
  Calendar,
  Camera,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EXERCISE_LIST, EXERCISES } from '../data/exercises';
import {
  getWorkspaceAccessToken,
  signInWithGoogleClassroom,
} from '../firebase';
import { ExerciseId, WorkoutSessionRecord } from '../types/exercise';
import {
  ClassroomAnnouncement,
  ClassroomAuthError,
  ClassroomCourse,
  ClassroomCourseWork,
  ClassroomRosterMember,
  createWorkoutAssignment,
  deleteAnnouncementItem,
  deleteCourseWorkItem,
  listCourseDetails,
  listMyCourses,
  postCourseAnnouncement,
} from '../utils/classroomApi';

interface ClassroomViewProps {
  selectedExerciseId: ExerciseId;
  sessions: WorkoutSessionRecord[];
  onPracticeExercise: (id: ExerciseId, startCamera: boolean) => void;
}

type PendingMutation =
  | {
      type: 'create_assignment';
      courseId: string;
      courseName: string;
      title: string;
      description: string;
      maxPoints: number;
      dueDateStr: string;
    }
  | {
      type: 'post_announcement';
      courseId: string;
      courseName: string;
      text: string;
    }
  | {
      type: 'delete_assignment';
      courseId: string;
      courseName: string;
      courseWorkId: string;
      title: string;
    }
  | {
      type: 'delete_announcement';
      courseId: string;
      courseName: string;
      announcementId: string;
      preview: string;
    };

function safeExternalUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function inferExerciseFromText(text: string, fallback: ExerciseId): ExerciseId {
  const lower = text.toLowerCase();
  const match = EXERCISE_LIST.find(
    (ex) =>
      lower.includes(ex.name.toLowerCase()) ||
      lower.includes(ex.id.replace('_', ' '))
  );
  return match ? match.id : fallback;
}

function GoogleSignInButton({
  onClick,
  loading,
  label = 'Sign in with Google',
}: {
  onClick: () => void;
  loading: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-xs hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 48 48"
        className="h-5 w-5 shrink-0"
        aria-hidden="true"
      >
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
        <path fill="none" d="M0 0h48v48H0z" />
      </svg>
      <span>{loading ? 'Connecting...' : label}</span>
    </button>
  );
}

export function ClassroomView({
  selectedExerciseId,
  sessions,
  onPracticeExercise,
}: ClassroomViewProps) {
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    getWorkspaceAccessToken()
  );
  const [needsAuth, setNeedsAuth] = useState<boolean>(
    () => !getWorkspaceAccessToken()
  );
  const [isConnecting, setIsConnecting] = useState(false);

  const [courses, setCourses] = useState<ClassroomCourse[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');

  const [courseWork, setCourseWork] = useState<ClassroomCourseWork[]>([]);
  const [announcements, setAnnouncements] = useState<ClassroomAnnouncement[]>([]);
  const [students, setStudents] = useState<ClassroomRosterMember[]>([]);
  const [teachers, setTeachers] = useState<ClassroomRosterMember[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Assignment composer state
  const [assignExerciseId, setAssignExerciseId] = useState<ExerciseId>(selectedExerciseId);
  const [assignTitle, setAssignTitle] = useState(
    `Practice ${EXERCISES[selectedExerciseId].name} Form`
  );
  const [assignDescription, setAssignDescription] = useState(
    `Use FormLab Live Coach to complete 2 sets with clean joint alignment. Focus: ${EXERCISES[selectedExerciseId].steps[0]}`
  );
  const [assignPoints, setAssignPoints] = useState(10);
  const [assignDueDate, setAssignDueDate] = useState('');

  // Announcement composer state
  const [announcementText, setAnnouncementText] = useState('');

  // Explicit user confirmation modal state (mandatory for all mutations)
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const [executingMutation, setExecutingMutation] = useState(false);

  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === selectedCourseId) || null,
    [courses, selectedCourseId]
  );

  const loadCourses = useCallback(async (token: string) => {
    setLoadingCourses(true);
    setErrorMsg(null);
    try {
      const list = await listMyCourses(token);
      setCourses(list);
      setSelectedCourseId((prev) =>
        prev && list.some((c) => c.id === prev) ? prev : list[0]?.id || ''
      );
      setNeedsAuth(false);
    } catch (err) {
      if (err instanceof ClassroomAuthError) {
        setAccessToken(null);
        setNeedsAuth(true);
      }
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to load Google Classroom courses.'
      );
    } finally {
      setLoadingCourses(false);
    }
  }, []);

  const loadDetails = useCallback(
    async (token: string, course: ClassroomCourse) => {
      setLoadingDetails(true);
      setErrorMsg(null);
      try {
        const details = await listCourseDetails(token, course.id, course.userRole);
        setCourseWork(details.courseWork);
        setAnnouncements(details.announcements);
        setStudents(details.students);
        setTeachers(details.teachers);
      } catch (err) {
        if (err instanceof ClassroomAuthError) {
          setAccessToken(null);
          setNeedsAuth(true);
        }
        setErrorMsg(
          err instanceof Error ? err.message : 'Unable to load classwork details.'
        );
      } finally {
        setLoadingDetails(false);
      }
    },
    []
  );

  useEffect(() => {
    if (accessToken) {
      void loadCourses(accessToken);
    }
  }, [accessToken, loadCourses]);

  useEffect(() => {
    if (accessToken && selectedCourse) {
      void loadDetails(accessToken, selectedCourse);
    } else {
      setCourseWork([]);
      setAnnouncements([]);
      setStudents([]);
      setTeachers([]);
    }
  }, [accessToken, selectedCourse, loadDetails]);

  const handleConnectClassroom = async () => {
    setIsConnecting(true);
    setErrorMsg(null);
    try {
      const { accessToken: freshToken } = await signInWithGoogleClassroom();
      setAccessToken(freshToken);
      setNeedsAuth(false);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Google Classroom sign-in was cancelled or blocked.'
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleExercisePresetChange = (id: ExerciseId) => {
    setAssignExerciseId(id);
    const ex = EXERCISES[id];
    const audienceTag = ex.audience === 'kids' && ex.ageGroup ? ` (${ex.ageGroup})` : '';
    setAssignTitle(`FormLab Practice: ${ex.name}${audienceTag}`);
    setAssignDescription(
      `Open FormLab Live Coach and perform ${ex.isHold ? '2 x 30s clean holds' : '2 sets of 8–10 reps'} of ${ex.name}. ${ex.steps[0]}`
    );
  };

  const handleInsertSessionSummary = () => {
    if (sessions.length === 0) return;
    const latest = sessions[0];
    const volume =
      latest.holdSeconds > 0
        ? `${latest.holdSeconds.toFixed(1)}s hold`
        : `${latest.reps} reps`;
    setAnnouncementText(
      `FormLab Practice Reminder: Try ${latest.exerciseName} today! Recent benchmark: ${volume} at ${latest.avgFormScore}% form accuracy.`
    );
  };

  const confirmAndExecuteMutation = async () => {
    if (!pendingMutation || !accessToken || executingMutation) return;
    setExecutingMutation(true);
    setErrorMsg(null);
    setStatusNotice(null);

    try {
      if (pendingMutation.type === 'create_assignment') {
        const created = await createWorkoutAssignment({
          accessToken,
          courseId: pendingMutation.courseId,
          title: pendingMutation.title,
          description: pendingMutation.description,
          maxPoints: pendingMutation.maxPoints,
          dueDateStr: pendingMutation.dueDateStr,
        });
        setCourseWork((prev) => [created, ...prev]);
        setStatusNotice(`Assigned "${created.title}" to ${pendingMutation.courseName}.`);
      } else if (pendingMutation.type === 'post_announcement') {
        const created = await postCourseAnnouncement({
          accessToken,
          courseId: pendingMutation.courseId,
          text: pendingMutation.text,
        });
        setAnnouncements((prev) => [created, ...prev]);
        setAnnouncementText('');
        setStatusNotice(`Posted announcement to ${pendingMutation.courseName}.`);
      } else if (pendingMutation.type === 'delete_assignment') {
        await deleteCourseWorkItem(
          accessToken,
          pendingMutation.courseId,
          pendingMutation.courseWorkId
        );
        setCourseWork((prev) =>
          prev.filter((w) => w.id !== pendingMutation.courseWorkId)
        );
        setStatusNotice(`Deleted assignment "${pendingMutation.title}".`);
      } else if (pendingMutation.type === 'delete_announcement') {
        await deleteAnnouncementItem(
          accessToken,
          pendingMutation.courseId,
          pendingMutation.announcementId
        );
        setAnnouncements((prev) =>
          prev.filter((a) => a.id !== pendingMutation.announcementId)
        );
        setStatusNotice('Deleted announcement from stream.');
      }
      setPendingMutation(null);
    } catch (err) {
      if (err instanceof ClassroomAuthError) {
        setAccessToken(null);
        setNeedsAuth(true);
      }
      setErrorMsg(
        err instanceof Error ? err.message : 'Google Classroom update failed.'
      );
      setPendingMutation(null);
    } finally {
      setExecutingMutation(false);
    }
  };

  if (needsAuth || !accessToken) {
    return (
      <div className="mx-auto max-w-[1000px] px-4 sm:px-6 lg:px-8 py-10">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-10 flex flex-col gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              <span>Google Classroom Integration</span>
            </div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900">
              Connect Google Classroom for PE & Movement Assignments
            </h1>
            <p className="mt-2.5 text-sm sm:text-base text-slate-600 leading-relaxed">
              Teachers can assign FormLab adult or children’s exercises directly to their Google Classroom courses, post stream reminders, and view class rosters. Students can view active assignments and launch the camera pose coach in one click.
            </p>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
            >
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <GoogleSignInButton
              onClick={handleConnectClassroom}
              loading={isConnecting}
              label="Sign in with Google"
            />
            <span className="text-xs text-slate-500">
              Grants permission to read courses and manage assignments when you confirm.
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">
            Google Classroom
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Sync active courses, assign FormLab exercises (including Kids Ages 5–12), and launch guided practice.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => loadCourses(accessToken)}
            disabled={loadingCourses}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loadingCourses ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Refresh Courses</span>
          </button>
          <GoogleSignInButton
            onClick={handleConnectClassroom}
            loading={isConnecting}
            label="Switch Account"
          />
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
        >
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {statusNotice && (
        <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
          <span>{statusNotice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Sidebar: Courses */}
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Active Courses ({courses.length})
            </h2>
            {loadingCourses && (
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
            )}
          </div>

          {courses.length === 0 && !loadingCourses ? (
            <p className="text-xs text-slate-500 py-4 leading-relaxed">
              No active Google Classroom courses found for this Google account. Create or join a class in Google Classroom and click Refresh Courses.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {courses.map((course) => {
                const isSelected = course.id === selectedCourseId;
                return (
                  <button
                    key={course.id}
                    type="button"
                    onClick={() => setSelectedCourseId(course.id)}
                    className={`w-full text-left rounded-lg border p-3.5 transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/70'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-slate-900 truncate">
                        {course.name}
                      </span>
                      <span
                        className={`text-[11px] font-semibold capitalize shrink-0 ${
                          course.userRole === 'teacher'
                            ? 'text-blue-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {course.userRole}
                      </span>
                    </div>
                    {(course.section || course.room) && (
                      <div className="mt-1 text-xs text-slate-500 truncate">
                        {[course.section, course.room].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Right Workspace: Selected Course Details & Actions */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {!selectedCourse ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              Select a course on the left to view assignments, announcements, and rosters.
            </div>
          ) : (
            <>
              {/* Course Banner */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
                    {selectedCourse.userRole === 'teacher'
                      ? 'Teaching Course'
                      : 'Enrolled Student'}
                  </div>
                  <h2 className="mt-0.5 font-display text-xl font-bold text-slate-900">
                    {selectedCourse.name}
                  </h2>
                  {selectedCourse.section && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Section: {selectedCourse.section}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-xs text-slate-500 flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <span className="tabular-nums">
                      {teachers.length} teacher{teachers.length === 1 ? '' : 's'}
                      {selectedCourse.userRole === 'teacher'
                        ? ` · ${students.length} student${students.length === 1 ? '' : 's'}`
                        : ''}
                    </span>
                  </div>
                  {safeExternalUrl(selectedCourse.alternateLink) && (
                    <a
                      href={safeExternalUrl(selectedCourse.alternateLink)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <span>Open in Classroom</span>
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </section>

              {/* Teacher Assignment & Announcement Composers */}
              {selectedCourse.userRole === 'teacher' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Create Exercise Assignment */}
                  <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3.5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Plus className="h-4 w-4 text-blue-600" aria-hidden="true" />
                      <span>Assign FormLab Exercise</span>
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!assignTitle.trim()) return;
                        setPendingMutation({
                          type: 'create_assignment',
                          courseId: selectedCourse.id,
                          courseName: selectedCourse.name,
                          title: assignTitle.trim(),
                          description: assignDescription.trim(),
                          maxPoints: assignPoints,
                          dueDateStr: assignDueDate,
                        });
                      }}
                      className="flex flex-col gap-3"
                    >
                      <div>
                        <label
                          htmlFor="classroom-ex-select"
                          className="block text-xs font-medium text-slate-600 mb-1"
                        >
                          Exercise Template
                        </label>
                        <select
                          id="classroom-ex-select"
                          value={assignExerciseId}
                          onChange={(e) =>
                            handleExercisePresetChange(e.target.value as ExerciseId)
                          }
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none cursor-pointer"
                        >
                          <optgroup label="Children's Library (Ages 5–12)">
                            {EXERCISE_LIST.filter((e) => e.audience === 'kids').map((ex) => (
                              <option key={ex.id} value={ex.id}>
                                {ex.name} ({ex.ageGroup})
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Adult & General Strength">
                            {EXERCISE_LIST.filter((e) => e.audience === 'general').map((ex) => (
                              <option key={ex.id} value={ex.id}>
                                {ex.name} ({ex.category})
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="classroom-assign-title"
                          className="block text-xs font-medium text-slate-600 mb-1"
                        >
                          Assignment Title
                        </label>
                        <input
                          id="classroom-assign-title"
                          type="text"
                          required
                          value={assignTitle}
                          onChange={(e) => setAssignTitle(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="classroom-assign-desc"
                          className="block text-xs font-medium text-slate-600 mb-1"
                        >
                          Instructions
                        </label>
                        <textarea
                          id="classroom-assign-desc"
                          rows={2}
                          value={assignDescription}
                          onChange={(e) => setAssignDescription(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label
                            htmlFor="classroom-assign-points"
                            className="block text-xs font-medium text-slate-600 mb-1"
                          >
                            Points
                          </label>
                          <input
                            id="classroom-assign-points"
                            type="number"
                            min={0}
                            max={100}
                            value={assignPoints}
                            onChange={(e) => setAssignPoints(Number(e.target.value) || 0)}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 tabular-nums focus:outline-none"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="classroom-assign-due"
                            className="block text-xs font-medium text-slate-600 mb-1"
                          >
                            Due Date (optional)
                          </label>
                          <input
                            id="classroom-assign-due"
                            type="date"
                            value={assignDueDate}
                            onChange={(e) => setAssignDueDate(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={!assignTitle.trim()}
                        className="w-full rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        Publish Assignment to Class
                      </button>
                    </form>
                  </section>

                  {/* Post Class Announcement */}
                  <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3.5">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Megaphone className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                          <span>Post Class Announcement</span>
                        </div>
                        {sessions.length > 0 && (
                          <button
                            type="button"
                            onClick={handleInsertSessionSummary}
                            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                          >
                            Insert Latest Set
                          </button>
                        )}
                      </div>

                      <textarea
                        rows={5}
                        value={announcementText}
                        onChange={(e) => setAnnouncementText(e.target.value)}
                        placeholder="Share warm-up instructions, posture tips, or today's FormLab workout challenge with your class..."
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={!announcementText.trim()}
                      onClick={() =>
                        setPendingMutation({
                          type: 'post_announcement',
                          courseId: selectedCourse.id,
                          courseName: selectedCourse.name,
                          text: announcementText.trim(),
                        })
                      }
                      className="w-full rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      Post to Classroom Stream
                    </button>
                  </section>
                </div>
              )}

              {/* Assignments List */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Assignments ({courseWork.length})
                  </h3>
                  {loadingDetails && (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
                  )}
                </div>

                {courseWork.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No assignments posted in this course yet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {courseWork.map((cw) => {
                      const matchedId = inferExerciseFromText(
                        `${cw.title} ${cw.description || ''}`,
                        selectedExerciseId
                      );
                      const matchedEx = EXERCISES[matchedId];
                      return (
                        <div
                          key={cw.id}
                          className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-slate-900">
                              {cw.title}
                            </div>
                            {cw.description && (
                              <p className="mt-1 text-xs text-slate-600 line-clamp-2">
                                {cw.description}
                              </p>
                            )}
                            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                              {typeof cw.maxPoints === 'number' && (
                                <span className="tabular-nums">{cw.maxPoints} pts</span>
                              )}
                              {cw.dueDate && (
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <Calendar className="h-3 w-3" aria-hidden="true" />
                                  Due {cw.dueDate.year}-{String(cw.dueDate.month).padStart(2, '0')}-
                                  {String(cw.dueDate.day).padStart(2, '0')}
                                </span>
                              )}
                              <span>Suggested: {matchedEx.name}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => onPracticeExercise(matchedId, false)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap"
                            >
                              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Practice in Live Coach</span>
                            </button>
                            {selectedCourse.userRole === 'teacher' && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPendingMutation({
                                    type: 'delete_assignment',
                                    courseId: selectedCourse.id,
                                    courseName: selectedCourse.name,
                                    courseWorkId: cw.id,
                                    title: cw.title,
                                  })
                                }
                                aria-label={`Delete assignment ${cw.title}`}
                                className="inline-flex items-center justify-center rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Stream Announcements */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3.5">
                <h3 className="text-sm font-semibold text-slate-900">
                  Class Announcements ({announcements.length})
                </h3>
                {announcements.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No stream announcements yet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {announcements.map((ann) => (
                      <div
                        key={ann.id}
                        className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                            {ann.text}
                          </p>
                          {ann.creationTime && (
                            <div className="mt-1 text-[11px] text-slate-400">
                              {new Date(ann.creationTime).toLocaleString()}
                            </div>
                          )}
                        </div>
                        {selectedCourse.userRole === 'teacher' && (
                          <button
                            type="button"
                            onClick={() =>
                              setPendingMutation({
                                type: 'delete_announcement',
                                courseId: selectedCourse.id,
                                courseName: selectedCourse.name,
                                announcementId: ann.id,
                                preview: ann.text.slice(0, 80),
                              })
                            }
                            aria-label="Delete announcement"
                            className="inline-flex items-center justify-center rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50 cursor-pointer shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Class Roster */}
              {selectedCourse.userRole === 'teacher' && students.length > 0 && (
                <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Enrolled Students ({students.length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {students.map((stu) => (
                      <div
                        key={stu.userId}
                        className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                      >
                        <div className="font-semibold text-slate-800 truncate">
                          {stu.profile?.name?.fullName || 'Student'}
                        </div>
                        {stu.profile?.emailAddress && (
                          <div className="text-slate-500 truncate mt-0.5">
                            {stu.profile.emailAddress}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mandatory Explicit Confirmation Dialog for Mutating / Destructive Classroom Actions */}
      {pendingMutation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="classroom-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-xl flex flex-col gap-4">
            <h2
              id="classroom-confirm-title"
              className="font-display text-lg font-bold text-slate-900"
            >
              {pendingMutation.type === 'create_assignment' &&
                'Publish Google Classroom Assignment?'}
              {pendingMutation.type === 'post_announcement' &&
                'Post Announcement to Google Classroom?'}
              {pendingMutation.type === 'delete_assignment' &&
                'Delete Google Classroom Assignment?'}
              {pendingMutation.type === 'delete_announcement' &&
                'Delete Google Classroom Announcement?'}
            </h2>

            <div className="text-xs text-slate-600 leading-relaxed space-y-1.5">
              <p>
                <strong>Course:</strong> {pendingMutation.courseName}
              </p>
              {pendingMutation.type === 'create_assignment' && (
                <>
                  <p>
                    <strong>Title:</strong> {pendingMutation.title}
                  </p>
                  <p>
                    This will publish 1 new graded coursework assignment visible to all students in this class.
                  </p>
                </>
              )}
              {pendingMutation.type === 'post_announcement' && (
                <p>
                  This will post an announcement to the class stream: &ldquo;
                  {pendingMutation.text.slice(0, 120)}
                  {pendingMutation.text.length > 120 ? '...' : ''}&rdquo;
                </p>
              )}
              {pendingMutation.type === 'delete_assignment' && (
                <p className="text-rose-700">
                  Are you sure you want to permanently delete the assignment &ldquo;
                  {pendingMutation.title}&rdquo;? This action cannot be undone.
                </p>
              )}
              {pendingMutation.type === 'delete_announcement' && (
                <p className="text-rose-700">
                  Are you sure you want to permanently delete this announcement (&ldquo;
                  {pendingMutation.preview}&rdquo;)? This action cannot be undone.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={executingMutation}
                onClick={() => setPendingMutation(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={executingMutation}
                onClick={confirmAndExecuteMutation}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white cursor-pointer ${
                  pendingMutation.type.startsWith('delete_')
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {executingMutation && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                <span>
                  {pendingMutation.type.startsWith('delete_')
                    ? 'Confirm Delete'
                    : 'Confirm & Publish'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
