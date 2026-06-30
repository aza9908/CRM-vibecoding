# 02 — Регистрация участников и авторизация

> Замена Supabase Auth на собственный JWT-механизм в NestJS. Покрывает два сценария: «полноценный пользователь» (учитель/ученик с аккаунтом) и «участник по коду сессии» (быстрый вход без пароля).

## 1. Как сейчас (Supabase)

- Вход через **magic link / OAuth**, Supabase сам хранит `auth.users`.
- Триггер `handle_new_user()` при регистрации создаёт `organization` и `profile` с ролью `teacher`.
- Участник live-сессии — это запись в `students` с привязкой `user_id` к auth-юзеру.
- Роли: `student | teacher | admin | hr | team_lead`, доступ ограничен RLS по организации.

## 2. Две модели «участника» — разводим их

Важно не путать:

| Тип | Кто | Аутентификация | Хранится |
|---|---|---|---|
| **User** | учитель, ученик с аккаунтом, админ | email + пароль (argon2) / OAuth → JWT | `users` |
| **Participant** | вошедший в конкретную live-сессию по коду | короткоживущий participant-токен | `participants` |

Ученик может быть и `User`, и `Participant` одновременно (зашёл в сессию под своим аккаунтом). Но «гость по коду» — только `Participant`, без пароля. Это даёт «доступ через код сессии» из ТЗ без обязательной регистрации.

## 3. JWT-стратегия

- **Access token** — короткий (15 мин), в памяти фронта / httpOnly-cookie.
- **Refresh token** — длинный (30 дней), httpOnly + Secure cookie, ротация при каждом обновлении.
- Payload access-токена:

```jsonc
{
  "sub": "user-uuid",
  "role": "teacher",
  "orgId": "org-uuid",
  "iat": 0, "exp": 0
}
```

- **Participant-токен** — отдельный JWT с другим `aud`:

```jsonc
{ "sub": "participant-uuid", "sessionId": "session-uuid", "aud": "participant" }
```

## 4. Модуль Auth в NestJS

```
apps/api/src/auth/
├── auth.module.ts
├── auth.controller.ts      # /auth/register, /auth/login, /auth/refresh, /auth/me
├── auth.service.ts         # argon2, выдача токенов
├── jwt.strategy.ts         # Passport JWT (user)
├── participant.strategy.ts # Passport JWT (participant, aud=participant)
├── guards/
│   ├── jwt-auth.guard.ts
│   ├── roles.guard.ts      # @Roles('teacher')
│   └── participant.guard.ts
└── decorators/
    ├── current-user.decorator.ts
    └── roles.decorator.ts
```

### Регистрация (создаёт организацию + пользователя)

```ts
// auth.service.ts (фрагмент)
async register(dto: RegisterDto) {
  const exists = await this.db.query.users.findFirst({
    where: eq(users.email, dto.email),
  });
  if (exists) throw new ConflictException('email_taken');

  return this.db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations)
      .values({ name: `${dto.fullName} workspace` }).returning();
    const [user] = await tx.insert(users).values({
      email: dto.email,
      passwordHash: await argon2.hash(dto.password),
      fullName: dto.fullName,
      role: dto.role ?? 'teacher',
      organizationId: org.id,
    }).returning();
    return this.issueTokens(user);
  });
}
```

### Вход

```ts
async login(dto: LoginDto) {
  const user = await this.db.query.users.findFirst({
    where: eq(users.email, dto.email),
  });
  if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, dto.password)))
    throw new UnauthorizedException('bad_credentials');
  return this.issueTokens(user);
}
```

### Гварды и роли

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher')
@Post('lessons')
createLesson(@CurrentUser() user: AuthUser, @Body() dto: CreateLessonDto) {
  return this.lessons.create(user.orgId, user.sub, dto);
}
```

`RolesGuard` читает метаданные `@Roles(...)` и сравнивает с `request.user.role`. `CurrentUser` достаёт payload из `request.user`.

## 5. Вход участника по коду (без регистрации)

Это мост к `04-live-sessions.md`. Эндпоинт:

```ts
// sessions.controller.ts
@Post('sessions/join')
async join(@Body() dto: JoinSessionDto) {   // { code, name, userId? }
  const session = await this.sessions.findLiveByCode(dto.code);
  if (!session) throw new NotFoundException('session_not_found');

  const [p] = await this.db.insert(participants).values({
    sessionId: session.id,
    name: dto.name,
    userId: dto.userId ?? null,
  }).returning();

  const token = this.auth.issueParticipantToken(p.id, session.id);
  return { participantToken: token, sessionId: session.id, participantId: p.id };
}
```

Фронт сохраняет `participantToken` (и `sessionId`) — это аналог `localStorage: univ_student_id` из текущего проекта, но теперь это подписанный токен, который WS-гейтвей проверяет при подключении.

## 6. OAuth (опционально, позже)

Если нужен вход через Google и т.п. — добавляется отдельная Passport-стратегия (`passport-google-oauth20`), callback создаёт/находит `users` и выдаёт те же токены. На старте можно ограничиться email+паролем и кодом сессии.

## 7. Чек-лист безопасности (раз RLS больше нет)

- [ ] Каждый запрос фильтруется по `orgId` из токена (единый scoping-слой).
- [ ] `participant`-токен НЕ даёт доступа к user-эндпоинтам (разделены по `aud`).
- [ ] Refresh-токены в httpOnly+Secure cookie, ротация, хранение хэша в БД/Redis для отзыва.
- [ ] Rate-limit на `/auth/login` и `/sessions/join` (Redis).
- [ ] Пароли — argon2id, не bcrypt-с-дефолтами.
- [ ] Валидация DTO через `class-validator` / zod из `packages/shared`.
