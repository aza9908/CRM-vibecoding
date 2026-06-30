import type { UserRole } from '@lms/shared';

/**
 * Where to land a user after login / register, based on role.
 * Teachers/admins manage lessons; students see the syllabus.
 */
export function postAuthPath(role: UserRole): string {
  switch (role) {
    case 'teacher':
    case 'admin':
    case 'team_lead':
      return '/teacher/lessons';
    case 'student':
      return '/syllabus';
    default:
      return '/teacher/lessons';
  }
}
