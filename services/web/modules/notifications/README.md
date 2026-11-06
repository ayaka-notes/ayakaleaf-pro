# Notifications module

Email notifications for project tracked-changes, plus the user-facing
"email notifications" settings UI.

## Features

1. **Project tracked-changes notification** — when a project is modified and
   the change is not acted on for a grace delay, every collaborating user who
   has not muted the notification gets one email ("New tracked changes in
   <project>"). The editor who made the change is never notified.
2. **Per-user grace delay** — on `/user/notification-preferences` each user
   can set the grace delay in minutes (1–10080). Unset → server default
   (`PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS`). Applied per recipient via
   `scheduledAt` (the dispatch already only claims docs with
   `scheduledAt <= now`).
3. **Email preferences** — settings UI (`/user/notification-preferences`
global **on/off checkbox** (opt-in: checked = notifications on) + grace delay
in minutes; IDE project-settings tab per project) to enable/disable email
   notifications, plus an immediate "send test email" endpoint
   (`/user/send-test-email`).

Preferences are stored in `db.notificationsPreferences` (module-owned,
migration `20251110151140`):
- per project: `{ user_id, project_id, <12 preference keys> }`
- global: `{ user_id, project_id: null, muteAllNotifications, notificationDelayMinutes }`

The email type is `trackedChangesNotification`. Recipient resolution
(owner vs invited member, global on/off, per-project off, editor exclusion,
per-user delay) happens in `ScheduleProjectChangeNotifications.mjs`.

## Pipeline

```
meta.tc edit (document-updater records timestamp + editor id in redis)
   → cron (server-ce/cron/project-notification-enqueue.sh, every minute):
       scans stale timestamp keys (older than the grace delay) with
       collaborators, enqueues a Bull job {projectId, timestamp, userId}
       (jobId `<projectId>:<timestamp>`, one per batch) on
       queue "project-notification", deletes both keys
   → Bull queue "project-notification" (redis)
   → web container: ProjectNotificationQueueConsumer.mjs (module-owned worker)
       fires the projectModified hook (with the editor id, timeout-guarded)
   → scheduleProjectChangeNotifications()
       (ScheduleProjectChangeNotifications.mjs: resolves recipients from
        project members + prefs, EXCLUDES the editor of the change, applies
        the per-user delay, upserts one doc per recipient into
        db.emailNotifications with a clean delivery state)
   → cron (server-ce/cron/notification-email-dispatch.sh, every minute):
       ProcessNotifications.mjs claims due docs in sorted order, resolves the
       recipient, resolves their Apprise channel (stored URL or the
       account email) and dispatches through the Apprise REST API
```

The two crons are registered in `server-ce/Dockerfile` into
`/etc/cron.d/crontab-notifications` (both run as root in the web container).

## Files

| Path | Role |
| --- | --- |
| `index.mjs` | Module registration (router + `hooks.promises.projectModified`) — see promisify trap below |
| `app/src/NotificationsPreferencesRouter.mjs` | Settings UI + test-email endpoints; starts the CE queue consumer in `apply()` |
| `app/src/NotificationsPreferencesController.mjs` | Page rendering (global on/off checkbox + delay input) + form/JSON handlers |
| `app/src/NotificationsPreferencesHandler.mjs` | Preference storage (global + per-project docs) |
| `app/src/PreferenceNormalizer.mjs` | Global/project preference normalization (module-side clone of the `@overleaf/notification-preferences` library) |
| `app/src/ScheduleProjectChangeNotifications.mjs` | Debounce, recipient + permission resolution, editor exclusion, per-user delay, `db.emailNotifications` upsert (clean delivery state) |
| `app/src/ProcessNotifications.mjs` | Dispatch: atomic claim → send → delete / retry; dry-run mode |
| `app/src/ProjectNotificationQueueConsumer.mjs` | CE-only Bull worker for the `project-notification` queue (timeout-guarded hook fire) |
| `app/views/user/notification-preferences.pug` | The settings page (checkbox + delay input + Save) |
| `test/unit/src/*.test.mjs` | Vitest unit tests (run from `services/web`) |
| outside module | `services/document-updater/app/js/{RedisManager,UpdateManager,HistoryOTUpdateManager}.js`, `services/document-updater/scripts/project_notifications.mts`, `server-ce/cron/project-notification-enqueue.sh` + `notification-email-dispatch.sh`, `libraries/notification-preferences/index.js` |

## CE-only consumer: why it lives in this module

In SaaS the Bull queues are consumed by `app/infrastructure/QueueWorkers.mjs`,
which requires `hasFeature('saas')` — and in CE
`Settings.overleaf` is `undefined`, so that worker never starts and the
`project-notification` queue would never be consumed. To keep the port
self-contained (no upstream/queue-module edits), this module starts its own
idempotent worker when saas is off (`startProjectNotificationConsumer`),
wired from the router's `apply()` at web startup. In SaaS the function is a
no-op and the upstream worker keeps exclusive ownership of the queue
(`concurrency` stays 1 — a single job can take ~100ms so a second concurrent
consumer would only re-run the debounce, but two consumers are never needed).

## Configuration (environment)

| Variable | Default | Effect |
| --- | --- | --- |
| `PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS` | `120000` | **Server default + floor** for the grace delay (per-user override, whole minutes 1–10080, stored as `notificationDelayMinutes` on the global preferences doc) |
| `PROJECT_NOTIFICATION_HOOK_TIMEOUT_MS` | `30000` | Consumer-side cap for the hook run; on timeout the job fails and Bull retries (default 3 attempts, exponential backoff) |
| `OVERLEAF_NOTIFICATIONS_MAX_ATTEMPTS` | `3` | Dispatch send attempts per doc (then dead-lettered) |
| `OVERLEAF_NOTIFICATION_SILENCE_PERIOD_MS` | `7200000` | Retry backoff base, **exponential**: `base × 2^(n-1)` |
| `PROCESS_NOTIFICATIONS_BATCH_SIZE` | `100` | Docs processed per dispatch run |
| `OVERLEAF_NOTIFICATIONS_DRY_RUN` | unset | Dispatch resolves+counts but sends nothing; docs stay pending |
| `QUEUES_REDIS_HOST/PORT/PASSWORD` | fall back to `REDIS_*` | Redis for the queue (the enqueue cron sets these from the stack's `REDIS_*`) |

> Bull job options (attempts `3`, exponential backoff base `3000ms`,
> `jobId = <projectId>:<timestamp>`) are set by the module-owned enqueue
> script `services/document-updater/scripts/project_notifications.mts`.

> This deployment sets `PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS` to `30000`
> (30 s) via the docker compose `environment` for faster testing.

## Redis & Mongo footprint

- `ProjectNotificationTimestamp:{projectId}` — set by document-updater on
  every history-generating edit; consumed (deleted) by the enqueue cron.
  **TTL 1 h** so solo-project markers self-expire.
- `ProjectNotificationEditor:{projectId}` — the editor who opened the batch
  (same NX semantics); carried into the Bull job and used to exclude the
  author; deleted with the timestamp key on enqueue. **TTL 1 h**.
- `ProjectHasCollaborators:{projectId}` — cached collaborator check,
  randomized **1–2 h** TTL; a stale "0" entry is double-checked against
  mongo for candidates that actually have a pending batch (a stale entry
  must not kill a real notification).
- `ProjectHasCollaborators:{projectId}` — 5-minute cached collaborator check.
- Bull keys for queue `project-notification` (jobs, locks, counters).
- `db.emailNotifications` (created by the module's `apply()`) — one doc per
  recipient per debounce window; fields: `recipient_id`, `project_id`,
  `emailType` (`projectNotification` owner / `trackedChangesNotification`
  collaborator), `opts`, `scheduledAt`, plus claim state
  (`processing` / `attempts` / `nextRetryAt` / `processingStartedAt`).

## Dispatch claim protocol (ProcessNotifications.mjs)

- Claim = atomic `findOneAndUpdate` of the first claimable doc in
  `scheduledAt` order (`processing` unset/false or stale > 1h), setting
  `processing: true` — safe under concurrent dispatchers.
- On success: delete. On failure: `attempts += 1`, exponential backoff
  `base × 2^(n-1)` with `base = OVERLEAF_NOTIFICATION_SILENCE_PERIOD_MS`
  (default 2 h); after `OVERLEAF_NOTIFICATIONS_MAX_ATTEMPTS` attempts
  (default 3) the doc is dead-lettered (`dead: true`, claim released).
- A new change batch **resets the delivery state** of an existing pending
  doc (`attempts: 0`, `processing: false`, `nextRetryAt`/
  `processingError`/`dead` cleared) — a failed or dead-lettered past
  email must not suppress later notifications for the same recipient.
- Claim results come back as a *raw document* (legacy mongodb driver shape)
  in production; the code normalizes both shapes at the single point of
  claim (covered by `ProcessNotifications.test.mjs` — regression F7).
- Dry-run (`OVERLEAF_NOTIFICATIONS_DRY_RUN=true`): claims stay in place for
  the whole run (the loop must not re-claim — regression F8) and are released
  in one batch afterwards; the queue is left un-consumed for inspection.

## Cron environment requirements

Both cron scripts `source /etc/container_environment.sh` **and**
`/etc/overleaf/env.sh` before starting their node processes (the container
environment file provides `REDIS_HOST`, `OVERLEAF_MONGO_URL`,
`CRYPTO_RANDOM`). The enqueue cron must run with
`cwd=/overleaf/services/document-updater` because `@overleaf/settings`
resolves `redis.documentupdater.key_schema` from the CWD's config.

## Testing

```sh
cd services/web
yarn vitest run modules/notifications          # all unit tests (5 files, 34 tests)
npx eslint --cache --cache-location ./.cache/eslint/ --max-warnings 0 --format unix modules/notifications
```

`ProcessNotifications.dry.test.mjs` runs in its own module instance because
`DRY_RUN` is captured at import time.

## Verification on a live stack (dry run, no mail sent)

```sh
# 1. schedule a change (past the grace delay)
docker exec overleafredis redis-cli SET "ProjectNotificationTimestamp:{<projectId>}" \
  "$(date -u -d '-60 seconds' +%s%3N)"
# 2. enqueue
docker exec overleafserver bash /overleaf/cron/project-notification-enqueue.sh
# 3. consumer hook must have upserted pending docs
docker exec overleafmongo mongosh sharelatex --quiet \
  --eval 'print((c=>c===0?"NONE — check consumer logs":c)(db.emailNotifications.countDocuments({})))'
# 4. dry-run dispatch (no send; docs stay pending)
docker exec -e OVERLEAF_NOTIFICATIONS_DRY_RUN=true overleafserver \
  bash /overleaf/cron/notification-email-dispatch.sh
# 5. clean up
docker exec overleafmongo mongosh sharelatex --quiet --eval 'db.emailNotifications.deleteMany({})'
```

## CE-specific upstream patches (re-apply after an upstream merge)

The settings UI entry points are un-gated for CE (upstream only shows them
behind `isOverleaf` / the saas `email-notifications` split-test flag).
Re-apply after any upstream merge — if they are lost, the pipeline keeps working
but the UI entry points disappear in CE:

- `frontend/js/features/settings/components/root.tsx` — the `isOverleaf ? (...) : null`
  block after `<SessionsSection />` has a CE branch rendering
  `<NotificationsSection />` (the "Email preferences" section linking to
  `/user/notification-preferences`).
- `frontend/js/features/settings/context/settings-modal-context.tsx` — the
  `project_notifications` IDE-settings tab has `hidden: false` (upstream:
  `hidden: !hasEmailNotifications`, i.e. the saas `email-notifications` split-test flag).
- `frontend/js/features/settings/components/editor-settings/project-notifications-setting.tsx`
  — the "beta note" block (BetaBadgeIcon + `forms.gle` feedback link) removed;
  `BetaBadgeIcon` import removed.
- `frontend/js/features/settings/components/settings-modal-body.tsx` — the
  `project_notifications` tab β-`OLTooltip` badge removed; now-orphaned
  `BetaBadgeIcon`/`OLTooltip`/`useTranslation` imports + the local `t` removed.
- `frontend/extracted-translations.json` — `back_to_account_settings` added.

**Editor exclusion ("no email for my own changes")** adds four more upstream
patches to re-apply after a merge (they carry the editor id so the module can
skip the author):

- `services/document-updater/app/js/RedisManager.js` —
  `recordProjectNotificationTimestamp(projectId, timestamp, userId)` also sets
  `ProjectNotificationEditor:{projectId}` (NX, same batch semantics); both
  keys carry a 1 h TTL.
- `services/document-updater/app/js/UpdateManager.js` — passes
  `update.meta?.user_id` to the setter.
- `services/document-updater/app/js/HistoryOTUpdateManager.js` — same.
- `services/document-updater/scripts/project_notifications.mts` — reads the
  editor key in the scan batch, puts `userId` into the Bull job data, deletes
  the companion key after a successful enqueue, uses `jobId =
  <projectId>:<timestamp>` (per-batch identity), and double-checks a stale
  "no collaborators" cache against mongo for real candidates.

**Per-user grace delay** adds two more upstream/semi-upstream touch points:

- `libraries/notification-preferences/index.js` —
  `normalizeGlobalPreferences` also returns `notificationDelayMinutes`
  (+ `normalizeGlobalDelayMinutes` helper, 1–10080 minutes). The library is
  shared with the chat service; the addition is additive.
- `locales/en.json` / `frontend/extracted-translations.json` — the three
  `notifications_delay_*` keys (label/description/server-default), plus the
  pre-existing `back_to_account_settings` above.

The `/user/notification-preferences` page's **Save** button and the delay
input are in the module's own pug template, so they survive merges untouched.

All other i18n strings already exist upstream in `services/web/locales/en.json`
(shared by the server-side `translate()` and frontend i18next).

## Operational notes & known quirks

- Debounce is per *change batch*: the redis key is set with `NX` (the FIRST
  change of the batch opens the window; later changes until enqueue do not
  reset it). Accepting/rejecting changes updates `meta.tc` and — once the
  previous batch was consumed — opens a new window.
- **Editor exclusion**: the editor stored with the batch's timestamp is never
  a recipient (module `ScheduleProjectChangeNotifications.mjs` skips them;
  a solo member who edited gets no email at all). If several people edit in
  one batch, the first editor (the one paired with the timestamp) is the one
  excluded; the others are still notified.
- A Bull job left `active` by a killed container generation remains until
  its lock/expiry is cleared (stalled-check); if a ghost job shows up in
  `q.getJobCounts().active`, remove it via its redis keys
  (`bull:project-notification:<id>[:lock]`, LREM from `:active`).
- Dispatch goes through the **Apprise API** (`NOTIFICATIONS_APPRISDE_API_URL`,
  default `http://127.0.0.1:8001`; in the compose stack the `apprise` container
  provides it with the stack's SMTP defaults, so `mailto://` works out of the box
  and `tg://` / `discord://` / `ntfy://` / … URLs work per recipient):
  - `AppriseDispatcher.mjs` — the REST adapter (POST /notify).
  - per-recipient channel: global preference `notificationUrl` (set on
    `/user/notification-preferences` or `/admin/notifications`), fallback
    `mailto://<account email>`.
  - the admin page `/admin/notifications` manages dry-run, per-user channels,
    the queue (retry/clear) and test sends.
- SMTP must be configured for the mailto channel (compose `.env`
  `OVERLEAF_EMAIL_SMTP_*`, consumed by the apprise container); the dev stack
  uses `smtp.uni-bremen.de:465` (secure) as the uni mail gateway.
- SaaS deployments: do nothing — the upstream QueueWorkers owns the queue
  there; the module consumer is a no-op when saas is on.
- **Modules promisify trap (regression found in production):** web's
  `app/src/infrastructure/Modules.mjs` runs every handler in the plain
  `hooks` map through `util.promisify()`, which assumes callback-style
  functions. An *async* handler in that slot executes but never settles the
  promisified promise → `fire()` hangs forever → the Bull job stays `active`
  forever and (with per-project job ids) swallows every later batch for that
  project. Native async handlers **must** be registered under
  `hooks.promises` (as `index.mjs` does, with a comment).
- **Two web node processes** in the CE image both run the module worker
  (observed: two `node app.mjs` pids); Bull's distributed locking keeps job
  processing exclusive, and the scheduler's upsert is idempotent, so double
  registration is harmless (at worst a harmless re-schedule).
- **Stale "no collaborators" cache**: `ProjectHasCollaborators:{id}` has a
  randomized 1–2 h TTL. If a collaborator is added to a project, batches
  recorded before the cache is refreshed are skipped — the enqueue script
  double-checks those candidates directly in mongo; a manual fix is
  `DEL ProjectHasCollaborators:{projectId}`.
- **Orphan batch markers**: solo projects used to leak timestamp keys
  forever; they now expire after 1 h (TTL). Pre-existing orphan keys can be
  swept with `KEYS 'ProjectNotificationTimestamp:*'` + `DEL` (they are
  always ≥ grace-delay old by definition).
