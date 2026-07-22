import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { CreateTaskDto, TaskDto, UpdateTaskDto } from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { tasks, users } from '../db/schema';
import { TelegramService } from '../common/telegram.service';

type TaskRow = typeof tasks.$inferSelect;

/**
 * CRUD for the internal Задачи board (Trello/Jira-style), scoped to the
 * caller's organization. Every mutation posts a best-effort Telegram
 * notification (mirrors the old internal-tasks tool's bridge).
 */
@Injectable()
export class TasksService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly telegram: TelegramService,
  ) {}

  async list(orgId: string): Promise<TaskDto[]> {
    const rows = await this.db
      .select({
        task: tasks,
        assigneeName: users.fullName,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(eq(tasks.organizationId, orgId))
      .orderBy(asc(tasks.createdAt));

    return rows.map((r) => toDto(r.task, r.assigneeName));
  }

  async create(
    orgId: string,
    createdBy: string,
    dto: CreateTaskDto,
  ): Promise<TaskDto> {
    const [row] = await this.db
      .insert(tasks)
      .values({
        organizationId: orgId,
        title: dto.title,
        description: dto.description ?? null,
        assigneeId: dto.assigneeId ?? null,
        deadline: dto.deadline ?? null,
        createdBy,
      })
      .returning();

    const assigneeName = await this.resolveAssigneeName(row.assigneeId);
    void this.telegram.notify(
      `🆕 Новая задача: «${row.title}»` +
        (assigneeName ? ` — ${assigneeName}` : '') +
        (row.deadline ? `, дедлайн ${row.deadline}` : ''),
    );
    return toDto(row, assigneeName);
  }

  async update(
    orgId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    const before = await this.assertTaskInOrg(taskId, orgId);

    const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.assigneeId !== undefined) patch.assigneeId = dto.assigneeId;
    if (dto.deadline !== undefined) patch.deadline = dto.deadline;

    const [row] = await this.db
      .update(tasks)
      .set(patch)
      .where(eq(tasks.id, taskId))
      .returning();

    const assigneeName = await this.resolveAssigneeName(row.assigneeId);
    void this.notifyChanges(before, row, assigneeName);
    return toDto(row, assigneeName);
  }

  async remove(orgId: string, taskId: string): Promise<{ id: string }> {
    const task = await this.assertTaskInOrg(taskId, orgId);
    await this.db.delete(tasks).where(eq(tasks.id, taskId));
    void this.telegram.notify(`🗑 Задача удалена: «${task.title}»`);
    return { id: taskId };
  }

  private async notifyChanges(
    before: TaskRow,
    after: TaskRow,
    assigneeName: string | null,
  ): Promise<void> {
    if (before.status !== after.status) {
      const label = STATUS_LABEL[after.status];
      await this.telegram.notify(
        `📋 «${after.title}»` +
          (assigneeName ? ` (${assigneeName})` : '') +
          ` → ${label}`,
      );
    }
    if (before.deadline !== after.deadline && after.deadline) {
      await this.telegram.notify(
        `⏰ «${after.title}» — новый дедлайн ${after.deadline}`,
      );
    }
  }

  private async resolveAssigneeName(
    assigneeId: string | null,
  ): Promise<string | null> {
    if (!assigneeId) return null;
    const [row] = await this.db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, assigneeId))
      .limit(1);
    return row?.fullName ?? null;
  }

  private async assertTaskInOrg(
    taskId: string,
    orgId: string,
  ): Promise<TaskRow> {
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('task_not_found');
    }
    return row;
  }
}

const STATUS_LABEL: Record<TaskRow['status'], string> = {
  todo: 'Сделать',
  doing: 'В работе',
  done: 'Готово',
};

function toDto(row: TaskRow, assigneeName: string | null): TaskDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneeId: row.assigneeId,
    assigneeName,
    deadline: row.deadline,
    createdBy: row.createdBy,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}
