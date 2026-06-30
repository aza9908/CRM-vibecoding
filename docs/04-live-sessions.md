# 04 — Live-сессии: код входа, запуск урока, realtime-тетрадь

> Сердце продукта. Здесь живёт «рабочая тетрадь с доступом по коду сессии» и live-синхронизация. Это часть, ради которой мы и пишем свой бэкенд вместо Supabase Realtime.

## 1. Как сейчас (Supabase)

- Учитель жмёт **«Go Live»** → генерится 6-значный код (`Math.random().toString(36).substring(2,8).toUpperCase()`), создаётся `live_sessions` со `status='live'`.
- Ученик на `/join` вводит код → запрос `live_sessions WHERE code=? AND status='live'` → создаётся `students` → редирект на `/live/{id}`.
- **Realtime через Supabase**:
  - учитель пишет `focused_block_id` → `postgres_changes` рассылает всем ученикам в канале `live_sessions:{id}`;
  - ответы учеников — upsert в `responses`, учитель слушает `postgres_changes` на `responses`.

## 2. Что меняется

Логика та же, но realtime теперь — **наш Socket.IO-гейтвей** с комнатами по сессии. Это снимает зависимость от лимитов Supabase Realtime и даёт полный контроль над событиями и payload'ами.

## 3. REST-часть сессий

```
apps/api/src/sessions/
├── sessions.controller.ts
├── sessions.service.ts
└── dto/{create-session,join-session}.dto.ts
```

| Метод | Эндпоинт | Роль | Назначение |
|---|---|---|---|
| POST | `/sessions` | teacher | запустить урок (создать live-сессию + код) |
| POST | `/sessions/join` | — | вход по коду (см. `02`) |
| GET | `/sessions/:id` | teacher/participant | состояние сессии + блоки урока |
| GET | `/sessions/:id/participants` | teacher | список участников |
| GET | `/sessions/:id/responses` | teacher | сводка ответов |
| POST | `/sessions/:id/end` | teacher | завершить (`status=ended`) |

### Генерация уникального кода

```ts
// sessions.service.ts
private async generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = randomCode(6); // A-Z0-9, без похожих 0/O/1/I
    const clash = await this.db.query.liveSessions.findFirst({
      where: and(eq(liveSessions.code, code), eq(liveSessions.status, 'live')),
    });
    if (!clash) return code;
  }
  throw new InternalServerErrorException('code_gen_failed');
}

async startSession(orgId: string, teacherId: string, lessonId: string) {
  await this.assertLessonInOrg(lessonId, orgId);
  const code = await this.generateUniqueCode();
  const [session] = await this.db.insert(liveSessions).values({
    lessonId, organizationId: orgId, code,
    status: 'live', startTime: new Date(),
  }).returning();
  return session; // фронт показывает code учителю
}
```

> Частичный уникальный индекс из `01` (`code` where `status='live'`) — страховка от гонки: даже если два запроса сгенерят одинаковый код, второй insert упадёт, и мы повторим.

## 4. WebSocket-гейтвей (realtime-ядро)

```ts
// apps/api/src/realtime/session.gateway.ts
@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN }, namespace: '/live' })
export class SessionGateway implements OnGatewayConnection {
  @WebSocketServer() io: Server;

  // проверяем токен при подключении (user ИЛИ participant)
  async handleConnection(socket: Socket) {
    try {
      const payload = await this.auth.verifySocketToken(socket.handshake.auth.token);
      socket.data.identity = payload; // {sub, role|sessionId, aud}
    } catch {
      socket.disconnect();
    }
  }

  @SubscribeMessage('session:join')
  async onJoin(@ConnectedSocket() socket: Socket, @MessageBody() { sessionId }: { sessionId: string }) {
    // participant может зайти только в свою сессию
    if (socket.data.identity.aud === 'participant'
        && socket.data.identity.sessionId !== sessionId) return;
    socket.join(`session:${sessionId}`);

    // отдать текущее состояние фокуса вошедшему
    const s = await this.sessions.get(sessionId);
    socket.emit('focus:changed', { blockId: s.focusedBlockId });

    // уведомить учителя о новом участнике
    this.io.to(`session:${sessionId}`).emit('participant:joined', { /* ... */ });
  }

  // учитель переключает фокус-блок
  @UseGuards(WsRolesGuard) @Roles('teacher')
  @SubscribeMessage('focus:set')
  async onFocus(@ConnectedSocket() socket: Socket,
                @MessageBody() { sessionId, blockId }: { sessionId: string; blockId: string }) {
    await this.sessions.setFocus(sessionId, blockId);                 // persist
    this.io.to(`session:${sessionId}`).emit('focus:changed', { blockId }); // broadcast
  }

  // ученик отправляет/обновляет ответ
  @SubscribeMessage('response:save')
  async onResponse(@ConnectedSocket() socket: Socket,
                   @MessageBody() dto: { sessionId: string; blockId: string; answerText: string }) {
    const participantId = socket.data.identity.sub;
    const saved = await this.responses.upsert(participantId, dto.blockId, dto.answerText);
    // учителю — обновление в реальном времени
    socket.to(`session:${dto.sessionId}`).emit('response:updated', {
      participantId, blockId: dto.blockId, answerText: dto.answerText, at: saved.updatedAt,
    });
  }
}
```

### События (контракт)

| Событие | Направление | Payload |
|---|---|---|
| `session:join` | client → server | `{ sessionId }` |
| `focus:set` | teacher → server | `{ sessionId, blockId }` |
| `focus:changed` | server → all | `{ blockId }` |
| `response:save` | student → server | `{ sessionId, blockId, answerText }` |
| `response:updated` | server → teacher | `{ participantId, blockId, answerText, at }` |
| `participant:joined` | server → teacher | `{ participantId, name }` |
| `session:ended` | server → all | `{ sessionId }` |

Положи этот контракт в `packages/shared/src/ws-events.ts` как типы — и фронт, и бэк используют один источник правды.

## 5. Масштаб: Redis-адаптер

Чтобы при нескольких инстансах API события `io.to(room).emit(...)` доходили до сокетов на других инстансах:

```ts
// main.ts
import { createAdapter } from '@socket.io/redis-adapter';
const pub = new Redis(process.env.REDIS_URL);
const sub = pub.duplicate();
io.adapter(createAdapter(pub, sub));
```

С этим адаптером код гейтвея не меняется при росте до 2–4 инстансов. 2000 одновременных коннектов держит и один инстанс — адаптер ставим сразу «на вырост».

### Тонкости под 2000 коннектов

- **Дебаунс ответов на клиенте** (200–400 мс): ученик печатает — не шлём каждое нажатие, шлём по паузе. Снимает основной поток событий.
- **Не широковещать ответ всем** — только учителю (`socket.to(room)` без отправителя; учитель — единственный, кому нужно). Ученикам чужие ответы не нужны.
- **Лёгкие payload'ы** — никаких целых объектов урока в событиях, только id + дельта.
- **Heartbeat/таймауты** Socket.IO оставить дефолтными; следить за памятью инстанса.

## 6. Фронтенд live-страниц (Next.js 16)

- `/[locale]/join` — форма «код + имя» → `POST /sessions/join` → сохранить `participantToken` → редирект на `/[locale]/live/[sessionId]`.
- `/[locale]/live/[sessionId]` (ученик):
  - подключение к `/live` namespace с `participantToken`;
  - `emit('session:join')`, подписка на `focus:changed` → автоскролл/подсветка нужного блока;
  - ввод в блоки → дебаунс → `emit('response:save')`.
- `/[locale]/teacher/live/[sessionId]` (учитель):
  - показывает код (копируемый), список участников (`participant:joined`), сводку ответов (`response:updated`);
  - клик по блоку → `emit('focus:set')`;
  - кнопка «Завершить» → `POST /sessions/:id/end` → сервер шлёт `session:ended`.

Клиент Socket.IO выносим в `apps/web/src/lib/ws/` как один хук `useSessionSocket(sessionId, token)`.

## 7. Завершение сессии

```ts
async endSession(orgId: string, sessionId: string) {
  await this.assertSessionInOrg(sessionId, orgId);
  await this.db.update(liveSessions)
    .set({ status: 'ended', endTime: new Date() })
    .where(eq(liveSessions.id, sessionId));
  this.io.to(`session:${sessionId}`).emit('session:ended', { sessionId });
}
```

После `ended` код освобождается (частичный индекс снимает уникальность), участники отключаются, фронт ученика показывает «урок завершён» и (опционально) проставляет `user_progress`.

## 8. Чек-лист

- [ ] Генерация уникального кода + защита от гонки частичным индексом.
- [ ] `POST /sessions/join` выдаёт participant-токен.
- [ ] WS-гейтвей с комнатами `session:{id}`, проверка токена на connect.
- [ ] События focus/response типизированы в `packages/shared`.
- [ ] Redis-адаптер подключён сразу.
- [ ] Дебаунс ответов и «только учителю» — на клиенте/сервере.
- [ ] Завершение сессии освобождает код и шлёт `session:ended`.
