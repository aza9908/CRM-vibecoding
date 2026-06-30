'use client';

import { AssistantPanel } from '@/components/ai/AssistantPanel';

export interface TutorTabProps {
  lessonId?: string;
  /** Content of the block the student is currently working on. */
  blockContent?: string;
  /** The student's current answer, injected as task context for the mentor. */
  taskContext?: string;
}

/**
 * "ИИ" (AI) tab of the live workbook right panel (docs/08).
 *
 * Hosts the Socratic AI mentor chat. This is a thin wrapper around the existing
 * {@link AssistantPanel}, which streams from `/ai/chat`; it fills the tab body
 * so the chat sits flush with the panel chrome. The AssistantPanel already
 * draws its own header/border, so it carries the full tab height here.
 */
export function TutorTab({ lessonId, blockContent, taskContext }: TutorTabProps) {
  return (
    <AssistantPanel
      lessonId={lessonId}
      blockContent={blockContent}
      taskContext={taskContext}
      className="h-full"
    />
  );
}
