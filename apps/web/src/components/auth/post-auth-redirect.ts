import type { UserRole } from '@lms/shared';

/**
 * Where to land a user after login / register: everyone goes to their
 * Кабинет (personal dashboard) first — role-specific work (lessons,
 * syllabus, admin) lives one click away in the nav rail.
 */
export function postAuthPath(_role: UserRole): string {
  return '/cabinet';
}
