const CLASSROOM_BASE = 'https://classroom.googleapis.com/v1';

export interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
  room?: string;
  descriptionHeading?: string;
  courseState?: string;
  alternateLink?: string;
  userRole: 'teacher' | 'student';
}

export interface ClassroomCourseWork {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  state?: string;
  workType?: string;
  maxPoints?: number;
  alternateLink?: string;
  creationTime?: string;
  dueDate?: { year: number; month: number; day: number };
}

export interface ClassroomAnnouncement {
  id: string;
  courseId: string;
  text: string;
  state?: string;
  creationTime?: string;
  alternateLink?: string;
}

export interface ClassroomRosterMember {
  userId: string;
  profile?: {
    id?: string;
    name?: { fullName?: string };
    emailAddress?: string;
    photoUrl?: string;
  };
}

export class ClassroomAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassroomAuthError';
  }
}

async function classroomFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${CLASSROOM_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    let detail = 'Google Classroom permission expired or missing. Please reconnect Google Classroom.';
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      if (errJson?.error?.message) {
        detail = errJson.error.message;
      }
    } catch {
      // Ignore parse error
    }
    throw new ClassroomAuthError(detail);
  }

  if (!res.ok) {
    let detail = `Google Classroom request failed (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      if (errJson?.error?.message) detail = errJson.error.message;
    } catch {
      // Ignore
    }
    throw new Error(detail);
  }

  if (res.status === 204) {
    return {} as T;
  }
  return (await res.json()) as T;
}

export async function listMyCourses(accessToken: string): Promise<ClassroomCourse[]> {
  const [teacherRes, studentRes] = await Promise.all([
    classroomFetch<{ courses?: Omit<ClassroomCourse, 'userRole'>[] }>(
      accessToken,
      '/courses?teacherId=me&courseStates=ACTIVE&pageSize=30'
    ).catch((err) => {
      if (err instanceof ClassroomAuthError) throw err;
      return { courses: [] };
    }),
    classroomFetch<{ courses?: Omit<ClassroomCourse, 'userRole'>[] }>(
      accessToken,
      '/courses?studentId=me&courseStates=ACTIVE&pageSize=30'
    ).catch((err) => {
      if (err instanceof ClassroomAuthError) throw err;
      return { courses: [] };
    }),
  ]);

  const byId = new Map<string, ClassroomCourse>();
  for (const c of studentRes.courses || []) {
    byId.set(c.id, { ...c, userRole: 'student' });
  }
  for (const c of teacherRes.courses || []) {
    byId.set(c.id, { ...c, userRole: 'teacher' });
  }
  return Array.from(byId.values());
}

export async function listCourseDetails(
  accessToken: string,
  courseId: string,
  userRole: 'teacher' | 'student'
): Promise<{
  courseWork: ClassroomCourseWork[];
  announcements: ClassroomAnnouncement[];
  students: ClassroomRosterMember[];
  teachers: ClassroomRosterMember[];
}> {
  const [cwRes, annRes, stuRes, tchRes] = await Promise.all([
    classroomFetch<{ courseWork?: ClassroomCourseWork[] }>(
      accessToken,
      `/courses/${encodeURIComponent(courseId)}/courseWork?pageSize=25`
    ).catch(() => ({ courseWork: [] })),
    classroomFetch<{ announcements?: ClassroomAnnouncement[] }>(
      accessToken,
      `/courses/${encodeURIComponent(courseId)}/announcements?pageSize=15`
    ).catch(() => ({ announcements: [] })),
    userRole === 'teacher'
      ? classroomFetch<{ students?: ClassroomRosterMember[] }>(
          accessToken,
          `/courses/${encodeURIComponent(courseId)}/students?pageSize=50`
        ).catch(() => ({ students: [] }))
      : Promise.resolve({ students: [] }),
    classroomFetch<{ teachers?: ClassroomRosterMember[] }>(
      accessToken,
      `/courses/${encodeURIComponent(courseId)}/teachers?pageSize=20`
    ).catch(() => ({ teachers: [] })),
  ]);

  return {
    courseWork: cwRes.courseWork || [],
    announcements: annRes.announcements || [],
    students: stuRes.students || [],
    teachers: tchRes.teachers || [],
  };
}

export async function createWorkoutAssignment(params: {
  accessToken: string;
  courseId: string;
  title: string;
  description: string;
  maxPoints?: number;
  dueDateStr?: string;
}): Promise<ClassroomCourseWork> {
  const { accessToken, courseId, title, description, maxPoints, dueDateStr } = params;
  const payload: Record<string, unknown> = {
    title: title.trim(),
    description: description.trim(),
    workType: 'ASSIGNMENT',
    state: 'PUBLISHED',
    materials: [
      {
        link: {
          url: window.location.origin,
          title: 'Open FormLab Camera Pose Coach',
        },
      },
    ],
  };

  if (typeof maxPoints === 'number' && maxPoints > 0) {
    payload.maxPoints = maxPoints;
  }

  if (dueDateStr && /^\d{4}-\d{2}-\d{2}$/.test(dueDateStr)) {
    const [year, month, day] = dueDateStr.split('-').map(Number);
    payload.dueDate = { year, month, day };
    payload.dueTime = { hours: 23, minutes: 59, seconds: 0 };
  }

  return classroomFetch<ClassroomCourseWork>(
    accessToken,
    `/courses/${encodeURIComponent(courseId)}/courseWork`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function postCourseAnnouncement(params: {
  accessToken: string;
  courseId: string;
  text: string;
}): Promise<ClassroomAnnouncement> {
  const { accessToken, courseId, text } = params;
  return classroomFetch<ClassroomAnnouncement>(
    accessToken,
    `/courses/${encodeURIComponent(courseId)}/announcements`,
    {
      method: 'POST',
      body: JSON.stringify({
        text: text.trim(),
        state: 'PUBLISHED',
        materials: [
          {
            link: {
              url: window.location.origin,
              title: 'Practice with FormLab Pose Sensor',
            },
          },
        ],
      }),
    }
  );
}

export async function deleteCourseWorkItem(
  accessToken: string,
  courseId: string,
  courseWorkId: string
): Promise<void> {
  await classroomFetch<Record<string, never>>(
    accessToken,
    `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}`,
    { method: 'DELETE' }
  );
}

export async function deleteAnnouncementItem(
  accessToken: string,
  courseId: string,
  announcementId: string
): Promise<void> {
  await classroomFetch<Record<string, never>>(
    accessToken,
    `/courses/${encodeURIComponent(courseId)}/announcements/${encodeURIComponent(announcementId)}`,
    { method: 'DELETE' }
  );
}
