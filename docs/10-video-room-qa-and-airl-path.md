# 10 · Video room, Q&A, Orzu Medical lesson, and airl.kz/lms

## Video room (own meeting room, no Google Meet)

Google Meet cannot run inside our pages: Google blocks it in iframes, and the
Meet SDK only works the other way round (our app inside Meet). So live
lessons get their own room, «Видеосвязь», built on WebRTC.

- **Topology:** a mesh. Each pair of people shares one `RTCPeerConnection` and media
  goes browser-to-browser. The API only relays SDP/ICE over the existing
  Socket.IO `/live` namespace (`rtc:*` events in `packages/shared/src/ws-events.ts`).
- **Server:** `apps/api/src/realtime/video-room.service.ts` holds the roster and the ICE config.
  `session.gateway.ts` has the handlers and authorization: a participant token
  for this session, or a user from the session's org. Staff roles are hosts.
- **Client:** `apps/web/src/lib/rtc/useVideoRoom.ts` uses perfect negotiation. The UI
  is `components/live/VideoRoom.tsx`: stage, thumbnails, mic/camera/screen/hand,
  host "mute everyone", and a floating mini-player.
- **Capacity:** camera ≤450 kbps and screen ≤1.2 Mbps per receiver. That suits a
  lecture of ~25–30 people with a few cameras on. `RTC_MAX_PEERS` (default 40)
  is the hard cap. For bigger rooms, move to an SFU (e.g. LiveKit) behind the
  same UI.
- **TURN:** needed behind strict NAT or corporate Wi-Fi. Start coturn with
  `docker compose -f docker-compose.prod.yml --profile turn up -d coturn`, open
  3478/udp+tcp and 49160–49200/udp, and set `TURN_URLS=turn:<host>:3478` and
  `TURN_SECRET` on the api service. Credentials are short-lived (HMAC) and
  never stored in the client bundle.

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
