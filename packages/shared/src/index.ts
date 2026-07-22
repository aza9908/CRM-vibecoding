/**
 * `@lms/shared` — the single source of truth for DTOs, enums, zod schemas,
 * and the WebSocket event contract shared by `@lms/web` and `@lms/api`.
 *
 * Never duplicate these types in web or api; always import from here.
 */

export * from './enums.js';
export * from './dto/auth.dto.js';
export * from './dto/lesson.dto.js';
export * from './dto/session.dto.js';
export * from './dto/ai.dto.js';
export * from './dto/material.dto.js';
export * from './dto/progress.dto.js';
export * from './dto/notes.dto.js';
export * from './dto/analytics.dto.js';
export * from './dto/program.dto.js';
export * from './dto/admin.dto.js';
export * from './dto/task.dto.js';
export * from './ws-events.js';
