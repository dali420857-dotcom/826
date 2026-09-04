# 826 iPhone SMS Control Design

## Status

Approved design for the first real iPhone/cloud-control capability under **826 Device and Cloud Control**.

Target child repository: `826-iPhone-SMS-Control` (private). The parent `826` repository remains the coordinator/capability registry.

## Goal

Provide a Windows-local control service that can manage initially one, then up to five iPhones running iOS 18.x, send and receive messages through the built-in iOS **Messages** app using Shortcuts, preserve message history and attachments in both Cloudflare and Windows storage, and expose UI-ready REST/WebSocket contracts without implementing the UI itself.

## Fixed product decisions

- iOS baseline: **iOS 18.x**. Avoid features requiring iOS 26.
- Device baseline: iPhone XR / iPhone 11 class or newer where iOS 18 runs reliably.
- Apple ID: **not required**. Do not depend on iCloud, iCloud Shortcut sharing, Apple Push Notification service, or other Apple cloud services.
- Each iPhone has one US SIM / one phone number, using Wi-Fi Calling as available.
- iPhones are long-term powered, manually configured to **Auto-Lock: Never**, with the polling shortcut kept running in the foreground.
- Initial device count: one test iPhone; after acceptance, expand to five.
- Command poll interval: **10 seconds** for the free-tier test phase; make it server-configurable for later reduction.
- Device offline threshold: **30 seconds** without a fresh heartbeat/poll observation.
- Windows surface: local HTTP service bound only to `127.0.0.1`; no LAN or Internet UI access.
- No UI implementation in this scope. Build data models, REST API, WebSocket events, and UI-facing documentation.
- First version is manual messaging only. No bulk send, scheduled campaigns, sequences, or automatic reply logic.
- Historical messages already on the iPhone are not imported. Recording starts after deployment.
- Messages and attachments are retained permanently unless explicitly deleted later by a future feature.
- Cloudflare and Windows each retain a complete durable copy.
- Windows local SQLite/attachment storage is not additionally encrypted in v1.
- Cloudflare has one environment only for now; test records are distinguished by device/test metadata.

## Supported Messages capabilities

The implementation should expose what iOS 18 + the carrier + the built-in Messages Shortcuts actions actually support, without pretending unsupported states are available.

### Required

- Single-recipient text send.
- Incoming text capture via `Message` personal automation.
- Outbound status through the point where the Shortcuts send action succeeds/fails and reports back.
- Manual retry after a failed send; each retry gets a new `command_id` and links to the original message/command.
- Multiple recipients/group send where the iOS Messages action supports it.
- Outbound image/video/file attachment send where the iOS action accepts that attachment.
- SMS/MMS/RCS transport choice is left to iOS/carrier configuration.

### Capability-gated

- Incoming attachment binary capture: save it when Shortcut Input exposes the actual file; otherwise persist metadata/status indicating the attachment could not be extracted.
- RCS delivery/read state: expose it only if an iOS 18 Shortcut/automation path can read it reliably in real-device testing. Otherwise state remains `unknown`.

### Out of scope

- iMessage dependence.
- WhatsApp, Telegram, LINE, Messenger, or other third-party apps.
- Importing the iPhone Contacts database.
- Importing old Messages history.

## Architecture

```text
Browser UI (future, not part of this scope)
        |
        | REST + local WebSocket
        v
826 Local Service (Windows, Node.js + TypeScript)
        |\
        | \-- SQLite + local attachment files
        |
        | outbound HTTPS + persistent WebSocket
        v
Cloudflare Worker
   |        |          |
   |        |          +-- R2: attachments + signed Shortcut artifacts
   |        +------------- D1: devices/messages/commands/sync/version data
   +---------------------- Durable Object: Windows realtime WebSocket fanout
        ^
        |
        | HTTPS polling/events
        |
iPhone Shortcuts (iOS 18)
```

The Windows service is the control-plane authority. Cloudflare is the always-online relay, durable mailbox/backup, attachment store, and realtime bridge. The iPhone is an execution node.

## Repository boundaries

### Parent `826`

Keep only:

- capability registration;
- connector registration;
- health/readback/fallback contracts;
- architecture references to child repo;
- acceptance references.

### Child `826-iPhone-SMS-Control`

Own:

- Windows Local Service;
- Cloudflare Worker/D1/R2/Durable Objects;
- SQLite schema and sync engine;
- iPhone Shortcut sources/build/sign/publish scripts;
- REST/WebSocket API contracts;
- contact import/edit logic;
- tests and runbooks.

## Child repository proposed layout

```text
826-iPhone-SMS-Control/
├─ package.json
├─ tsconfig.json
├─ .env.example
├─ .gitignore
├─ README.md
├─ apps/
│  └─ local-service/
│     └─ src/
│        ├─ server.ts
│        ├─ config.ts
│        ├─ api/
│        ├─ realtime/
│        ├─ db/
│        ├─ sync/
│        ├─ contacts/
│        └─ cloudflare/
├─ cloudflare/
│  ├─ wrangler.toml
│  ├─ migrations/
│  └─ src/
│     ├─ index.ts
│     ├─ auth.ts
│     ├─ routes/
│     ├─ durable-objects/
│     └─ repositories/
├─ packages/
│  └─ contracts/
│     └─ src/
├─ shortcuts/
│  ├─ src/
│  ├─ build/
│  ├─ scripts/
│  └─ manifests/
├─ tests/
└─ docs/
```

## iPhone Shortcut modules

Use multiple fixed-name Shortcuts. Version numbers are metadata, never part of the Shortcut name.

- `826-Device-Setup`
  - initial pairing/bootstrap;
  - stores `device_id`, device token, Worker URL and runtime config locally on **On My iPhone** storage;
  - pairing starts from a one-time QR code generated by the Windows service;
  - the QR contains a one-time pairing secret, not the long-lived device token.

- `826-Command-Poller`
  - the only regular cloud command poller;
  - target interval 10 seconds;
  - reads remote runtime config so the interval can be changed later;
  - pulls/claims one command, dispatches to the correct functional Shortcut, reports result;
  - also flushes the local inbound retry queue;
  - periodically produces heartbeat state;
  - uses segmented/self-restart execution rather than one intentionally infinite loop.

- `826-SMS-Send`
  - sends text or multi-recipient text through Messages;
  - receives explicit command input;
  - returns structured success/failure data.

- `826-SMS-Media`
  - downloads R2 attachment(s) using short-lived authenticated URLs;
  - passes attachments to the Messages send action;
  - reports structured result.

- `826-SMS-Receive`
  - invoked by iOS `Message` personal automation;
  - constructs a durable inbound event;
  - writes the event to an iPhone-local pending queue before first upload;
  - uploads to Cloudflare;
  - removes/marks the local queue record only after ACK;
  - does not expire queued inbound data.

- `826-Device-Heartbeat`
  - optional isolated helper invoked by Poller;
  - emits device runtime status/version data.

- `826-Device-Updater`
  - checks Shortcut manifests/version metadata;
  - downloads signed Shortcut artifacts;
  - attempts silent same-name update first;
  - if iOS requires `Replace`, records `manual_confirmation_required` and does not block SMS functionality;
  - later work may improve toward fully unattended replacement.

- `826-Device-Recovery`
  - handles recoverable Shortcut/runtime state and diagnostics;
  - phone reboot/unlock automation is not a v1 requirement.

## Shortcut build/release pipeline

Windows-only workflow:

1. Author Shortcut source in Cherri or another inspectable Windows-capable source format.
2. Compile to an unsigned `.shortcut`.
3. Inspect the unsigned plist:
   - non-empty `WFWorkflowActions`;
   - no `is.workflow.actions.rawaction` placeholders;
   - expected action identifiers present;
   - expected request/body fields present.
4. Sign with RoutineHub HubSign / `shortcut-signer` as approved.
5. Verify the signed output is an AEA1 artifact.
6. Upload signed artifact to R2.
7. Insert/activate a version manifest in D1.
8. Updater checks and installs the latest compatible version.

No secrets, phone numbers, device tokens, or Cloudflare administrator credentials are embedded in Shortcut source/artifacts.

## Pairing flow

```text
Windows POST /api/devices/pairing-sessions
  -> local service requests one-time pairing session from Worker
  -> returns QR payload
  -> iPhone 826-Device-Setup scans/receives QR
  -> POST /v1/pair/complete
  -> Worker validates one-time secret and consumes it
  -> Worker returns device_id + long-lived device token + runtime config
  -> iPhone persists them locally
  -> heartbeat/poll begins
  -> Windows sees device online
```

Pairing secret is single-use and expires quickly. The long-lived device token is never encoded into the QR.

## Device online model

A device is `online` only when its most recent authenticated poll/heartbeat is at most 30 seconds old.

```text
online = now - last_seen_at <= 30 seconds
```

If offline:

- UI-facing send API rejects the send request immediately;
- no delayed outbound command is created;
- user may retry manually after the device returns online.

If a device appeared online and a command was created but not claimed within 30 seconds, the command becomes `failed_timeout`; it is not automatically requeued for later transmission.

## Outbound message flow

### Text

```text
UI/future caller
 -> POST local /api/messages/send
 -> local service checks device freshness
 -> create local outbound message + idempotency key
 -> POST Worker command
 -> D1 command=pending
 -> Poller claims command
 -> command=claimed/executing
 -> 826-SMS-Send
 -> iOS Messages action
 -> result POST Worker
 -> D1 command=success|failed
 -> Durable Object pushes event to Windows
 -> Windows updates SQLite
 -> local WebSocket emits UI event
```

### Attachment

```text
Windows file
 -> local service stores local copy
 -> upload R2
 -> create command referencing attachment object(s)
 -> iPhone downloads attachment(s)
 -> 826-SMS-Media sends them
 -> result returned as above
```

826 itself does not impose an attachment-size limit. Real iOS/carrier/R2 limits are reported as real failures rather than hidden compression or silent mutation.

## Inbound message flow

```text
iOS Message automation
 -> 826-SMS-Receive
 -> create event_id
 -> save pending event locally on iPhone
 -> POST Worker /v1/messages/inbound
 -> D1 upsert by event_id
 -> upload binary attachments to R2 when exposed by iOS
 -> ACK to iPhone
 -> iPhone removes/marks pending event synced
 -> Durable Object pushes event to Windows if connected
 -> Windows writes SQLite and downloads attachment copy
 -> local WebSocket emits new_message
```

If Cloudflare is unavailable, the iPhone pending record remains indefinitely. `826-Command-Poller` retries unsynced inbound events every cycle/backoff until ACK. `event_id` is unique and Cloudflare insertion is idempotent.

## Cloudflare responsibilities

### Worker

- public HTTPS API for authenticated iPhones and Windows service;
- per-device bearer-token authentication;
- pairing endpoints;
- command creation/claim/result endpoints;
- inbound message ingestion;
- R2 upload/download authorization;
- version manifest endpoints;
- sync cursor endpoints.

### D1

Tables:

- `devices`
- `pairing_sessions`
- `messages`
- `message_recipients`
- `conversations`
- `attachments`
- `commands`
- `command_results`
- `shortcut_versions`
- `sync_events`

Use unique keys for `event_id`, `command_id`, attachment object IDs, and stable device IDs.

### R2

Permanent cloud copy of:

- inbound/outbound attachments;
- signed `.shortcut` release artifacts.

### Durable Object

- owns Windows service realtime WebSocket sessions;
- receives new-message/device/command-result/version events;
- pushes events immediately when Windows is connected;
- persistence is never delegated solely to the socket: D1/R2 remain authoritative for recovery.

## Windows Local Service

Tech stack:

- Node.js >= 22
- TypeScript
- Fastify
- Zod
- SQLite via a maintained Node SQLite driver
- WebSocket server for localhost UI clients
- outbound WebSocket client to Cloudflare

Bind HTTP/WebSocket only to `127.0.0.1`.

Responsibilities:

- UI-facing REST API;
- local WebSocket event fanout;
- local SQLite persistence;
- local attachment persistence;
- Cloudflare command adapter;
- Cloudflare realtime reconnect/resume;
- incremental sync using cursor;
- contact import/edit/search;
- global message search;
- device status derivation;
- manual retry command creation.

## Windows storage

SQLite tables mirror the UI/query model, not necessarily Cloudflare one-to-one:

- `devices`
- `contacts`
- `contact_phone_numbers`
- `conversations`
- `messages`
- `message_recipients`
- `attachments`
- `commands`
- `events`
- `sync_state`

Attachments are copied to a local application data directory using stable content/object IDs. No automatic retention deletion.

## Contacts

Contacts exist only in 826; they do not sync to/from iPhone Contacts.

Required:

- create/edit/delete;
- CSV import;
- vCard import;
- one contact may own multiple numbers;
- normalized phone number is the uniqueness key;
- duplicate number imports merge automatically;
- conflicting names/fields preserve existing data and surface a conflict record for human resolution instead of blind overwrite.

## Search

Global search spans all iPhones and all stored messages.

Searchable fields:

- contact name;
- normalized phone number;
- message text;
- device name;
- device ID;
- attachment filename;
- time range.

API supports optional device/contact/time filters while the default search scope is all devices.

## Local REST API contract

Version base: `/api/v1`.

### Devices

- `GET /api/v1/devices`
- `GET /api/v1/devices/:deviceId`
- `POST /api/v1/devices/pairing-sessions`

### Messages

- `GET /api/v1/messages`
- `GET /api/v1/messages/:messageId`
- `POST /api/v1/messages/send`
- `POST /api/v1/messages/:messageId/retry`
- `POST /api/v1/messages/:messageId/read`

### Conversations

- `GET /api/v1/conversations`
- `GET /api/v1/conversations/:conversationId`
- `GET /api/v1/conversations/:conversationId/messages`
- `POST /api/v1/conversations/:conversationId/pin`
- `DELETE /api/v1/conversations/:conversationId/pin`

### Contacts

- `GET /api/v1/contacts`
- `POST /api/v1/contacts`
- `PUT /api/v1/contacts/:contactId`
- `DELETE /api/v1/contacts/:contactId`
- `POST /api/v1/contacts/import/csv`
- `POST /api/v1/contacts/import/vcard`
- `GET /api/v1/contacts/import/conflicts`

### Search

- `GET /api/v1/search?q=...&device_id=...&contact_id=...&from=...&to=...&limit=...&cursor=...`

### System

- `GET /api/v1/health`
- `GET /api/v1/sync/status`

## Local WebSocket contract

Endpoint: `/api/v1/events`.

Events include:

- `device_online`
- `device_offline`
- `new_message`
- `message_sent`
- `message_failed`
- `message_delivery_updated` (capability-gated)
- `command_started`
- `command_completed`
- `shortcut_update_available`
- `shortcut_updated`
- `shortcut_update_manual_confirmation_required`
- `sync_state_changed`

Each event contains:

```json
{
  "event_id": "evt_...",
  "event": "new_message",
  "occurred_at": "2026-09-04T08:00:00Z",
  "device_id": "iphone-001",
  "data": {}
}
```

## Command model

Command states:

```text
pending -> claimed -> executing -> success
                              \-> failed
pending ----------------------> failed_timeout
```

Core fields:

- `command_id`
- `device_id`
- `action`
- `payload`
- `idempotency_key`
- `created_at`
- `expires_at`
- `claimed_at`
- `completed_at`
- `status`
- `retry_of_command_id`

`send_sms` is a mutating capability and must have health/readback/idempotency evidence consistent with parent 826 policies.

## Message model

Core fields:

- `message_id`
- `event_id` for inbound idempotency
- `device_id`
- `conversation_id`
- `direction`: `inbound | outbound`
- `transport`: `sms | mms | rcs | unknown`
- `body`
- `sender`
- recipient list
- attachment list
- `status`
- `created_at`
- `sent_at`
- `received_at`
- `delivery_state`: `unknown | sent | delivered | read | failed`
- `retry_of_message_id`

## Realtime and recovery

Windows keeps an outbound WebSocket connection to Cloudflare. Cloudflare cannot initiate an inbound connection to localhost.

On disconnect:

1. Cloudflare continues persisting events in D1/R2.
2. Windows reconnects with its last durable `sync_cursor`.
3. Windows calls incremental sync for all missing events.
4. SQLite transactionally applies recovered records.
5. Realtime resumes.

No realtime event is considered durable merely because it was written to a WebSocket.

## Shortcut update policy

Desired end state is unattended updates, but **v1 delivery is not blocked if iOS 18 requires manual same-name replacement**.

Update behavior:

1. Updater checks manifest.
2. Download signed artifact.
3. Attempt supported silent/import URL path.
4. Verify installed version through a readback/heartbeat field.
5. If replacement is blocked by iOS confirmation, mark `manual_confirmation_required`.
6. Existing known-good Shortcut remains usable.
7. Continue SMS system development and operations.

The silent-update Spike remains useful research, but failure changes only the update UX, not the architecture or release of SMS cloud control.

## Security

- No secrets committed to Git.
- Administrator Cloudflare credentials stay in Wrangler/environment credential storage, not app config checked into source.
- Every iPhone receives a distinct long-lived device token.
- Tokens are sent only over HTTPS.
- Pairing token is single-use, short-lived, and consumed atomically.
- Device tokens authorize only that device's endpoints/resources.
- Windows UI/API binds only to `127.0.0.1`.
- Logs redact bearer tokens, phone-message payloads when not required for diagnostics, and signed URLs.
- Command operations require idempotency keys.
- Cloudflare and Windows preserve audit/correlation IDs.

## Failure policy

### Device offline

- After 30 seconds stale, reject outbound sends.
- Do not queue a message for eventual send.

### Command claim timeout

- If not claimed before expiry, mark failed.
- Do not silently requeue later.
- User can explicitly retry, generating a new command.

### Cloudflare unavailable during inbound upload

- Keep iPhone local pending event indefinitely.
- Retry until ACK.

### Windows offline

- Cloudflare remains authoritative online storage.
- On startup/reconnect, incremental sync restores everything missed.

### R2 upload/download failure

- Preserve attachment/message metadata with failure state.
- Retry only where operation is idempotent.
- Do not silently drop or mutate attachments.

### Unknown iOS capability

- Represent capability as `unsupported`/`unknown` rather than synthesize data.

## Observability

Minimum structured fields:

- `correlation_id`
- `event_id`
- `command_id`
- `device_id`
- `action`
- `status`
- `attempt`
- `duration_ms`
- `error_code`

Expose health summaries without exposing secrets or message bodies by default.

## Acceptance sequence

### Phase 0: Shortcut updater Spike

- Build/sign v1/v2 on Windows.
- Install v1 manually once.
- Attempt unattended same-name update on iOS 18.
- Record whether silent replacement works.
- If not, validate manual Replace fallback and continue.

### Phase 1: One-device text path

1. Pair one iOS 18 test iPhone.
2. Establish online state using 10-second Poller.
3. Windows creates a manual text send.
4. iPhone sends through Messages.
5. Result returns to Windows.
6. Incoming text triggers automation and appears in Cloudflare + SQLite.
7. Shut Windows down, receive a message, restart Windows, verify incremental recovery.
8. Disable Cloudflare/network briefly, receive a message, restore network, verify iPhone local queue retries without duplication.

### Phase 2: media/group/contacts/search

- Outbound media where iOS supports it.
- Inbound attachment capture where automation exposes binary.
- Multi-recipient/group send.
- Contact CSV/vCard import and conflict rules.
- Search across all device/message fields.

### Phase 3: five devices

- Pair five devices.
- Verify 10-second polling request budget.
- Verify each device/number maintains isolated conversations.
- Verify no cross-device command claim.
- Verify offline/online transitions at 30 seconds.

## Non-goals for v1

- Building the visual UI.
- Remote browser access to Windows control plane.
- Bulk marketing/campaign sending.
- Scheduled sending.
- AI automatic replies.
- Other messaging apps.
- Phone reboot/unlock automation.
- MDM/Appium/WDA device control.
- iCloud/Apple ID based deployment.
