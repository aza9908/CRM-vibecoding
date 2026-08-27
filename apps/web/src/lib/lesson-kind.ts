import type { LessonKind } from '@lms/shared';

/** i18n key (namespace `lessons`) for each curriculum position. */
export const KIND_LABEL_KEY: Record<LessonKind, string> = {
  intro: 'kindIntro',
  workshop: 'kindWorkshop',
  qa: 'kindQa',
  demo_day: 'kindDemoDay',
};

/** `Badge` variant for each curriculum position — each kind gets a distinct
 * color so a lesson list with mixed kinds (e.g. a QA session next to Demo
 * Day) reads at a glance instead of showing two identical-looking pills. */
export const KIND_BADGE_VARIANT: Record<
  LessonKind,
  'secondary' | 'outline' | 'default' | 'success'
> = {
  intro: 'outline',
  workshop: 'secondary',
  qa: 'default',
  demo_day: 'success',
};
