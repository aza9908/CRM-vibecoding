# 10 · Video room, Q&A, Orzu Medical lesson, and airl.kz/lms

## Video room (own meeting room, no Google Meet)

Built into every live session: `apps/web/src/components/live/VideoRoom.tsx`,
`apps/web/src/lib/rtc/useVideoRoom.ts`, `apps/api/src/realtime/video-room.service.ts`
and the `rtc:*` events in `packages/shared/src/ws-events.ts`.

- **Topology:** an SFU (mediasoup) inside the API process. Everyone sends each
  track once to the server and receives the others from it, so a class of 50+
  costs the teacher one upload. (The first version was a browser-to-browser
  mesh; it froze the teacher's tab at ~20 people.) Signaling rides the existing
  Socket.IO `/live` namespace.
- **Ports:** one UDP+TCP port per media worker — `RTC_PORT` (44444) and up,
  `RTC_WORKERS` (2) of them — announced at `RTC_ANNOUNCED_IP` (the server's
  public IP; the deploy workflow sets it and opens the ports in ufw). TCP on
  the same ports is the fallback for networks that block UDP; no TURN server.
- **Quality:** cameras are sent with simulcast (3 layers). The person on the
  stage is received in the best layer, the film strip in the smallest; at most
  16 remote cameras (6 on phones) are received at once, the rest show avatars.
- **Call lifetime:** a call starts when a host enters and ends only when a host
  presses «Завершить для всех», the session ends, or the room stays empty for
  2 minutes (`RTC_EMPTY_CALL_GRACE_MS`). A host's reload or network blip does
  NOT end it — that was the cause of the "everyone got kicked" incident.
- **Resilience (client):** socket drop or API restart → status `reconnecting`,
  local mic/camera tracks stay alive, the hook re-joins by itself; a flaky
  path → ICE restart first, full re-join after ~10 s; a reloaded tab comes
  back with the mic/camera it had (`sessionStorage`), under the same stable
  peer id, so nobody appears twice.
- **UX:** stage = screen share, else pinned person, else active speaker on
  camera, else the host. The speaker gets a green ring (server-side audio
  levels, `rtc:speakers`). The stage goes full screen (button / double click /
  Esc). Students auto-join a running call listen-only.
- **State is in memory** (single API instance). After an API restart the
  clients re-join and a returning host re-activates the call.
- **Check from the internet:** `deploy-vps.yml` mode `call-smoke` runs
  `.github/scripts/call-smoke.js` (teacher + student in a throw-away lesson).

## Call recording

`apps/web/src/lib/rtc/recorder.ts`, driven from `VideoRoom.tsx` (host only).

- **What:** the host's browser composes the stage (screen share or speaker,
  speaker in a corner) on a 1920×1080 canvas at 30 fps, mixes everyone's audio
  with Web Audio and records it with `MediaRecorder` (4 Mbps video).
- **Where:** the host picks YouTube (unlisted, scope `youtube.upload`), Google
  Drive (folder «Уроки LMS», scope `drive.file`) or a download. Google access
  uses `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (public OAuth client id; the deploy
  workflow input `google_client_id` sets it). The API project must have the
  Drive API and the YouTube Data API v3 enabled.
- **Nothing gets lost:** every 4 s chunk is first written to IndexedDB
  (`lms-recordings`), then streamed through a Google resumable upload session.
  A network drop makes the uploader wait, ask the server how much it has, and
  continue. A crashed tab / power cut leaves the chunks on disk: the next
  visit shows «Найдена незавершённая запись» and finishes the upload or
  downloads the file. If a service refuses a stream of unknown length, the
  finished file is re-sent whole through a new session.
- **YouTube caveat:** videos uploaded through the API by an unaudited Google
  project can be forced to `private` by YouTube; the UI says so when it happens.
- Everyone in the call sees «Идёт запись» (`rtc:recording` → `rtc:room-state`).

## Q&A queue

`qa:*` events let students ask questions and upvote (▲) each other's.
The host gives the floor (the asker sees a banner asking them to turn on the
mic) or marks a question answered. The queue is in-memory per session, like
the chat buffer. The UI is `components/live/QaPanel.tsx`: the «Вопросы» tab for
students, and a card at the top of the teacher's side column.

## Orzu Medical · VibeOps · Week 1

`apps/api/src/db/workbook-orzu-week1.ts` holds 41 blocks, RU with UZ below.
It follows the programme PDF: start (Tilmoch QR), programme, lesson
(progress → demo + quiz → Q&A), exercises, sprint task, then the submission
checklist and feedback. It is seeded on API boot into every organization whose
name contains "Orzu", or on demand:

- `POST /admin/workbook/seed-orzu` (staff of the caller's org), or
- `SEED_LESSON=orzu SEED_ORG_ID=<uuid> npm run seed:workbook --workspace=@lms/api`.

Re-seeding never touches a lesson with a live session.

## Serving at https://airl.kz/lms/

1. Build the web app with `NEXT_PUBLIC_BASE_PATH=/lms`. It is a docker build
   arg in `docker-compose.prod.yml`.
2. On the api, add `https://airl.kz` to `WEB_ORIGIN`, which controls CORS and WS.
3. The landing (`aza9908/landing`, `server.js`) proxies `/lms` and `/lms/*` to
   `LMS_UPSTREAM` (default `https://lms.magauin.kz`).
4. Optional: redirect the old host's root to `https://airl.kz/lms/` in the VPS nginx.

Locales: `ru` (default, `/lms`), `uz`, `kk`, `en` (`/lms/uz`, …).
