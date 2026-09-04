# 826 iPhone SMS Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `826-iPhone-SMS-Control` private child service that relays iOS 18 Messages through Cloudflare to a localhost Windows Node/TypeScript service, with durable storage, realtime events, contacts/search APIs, attachment handling, and Windows-built Shortcut releases.

**Architecture:** Windows is the authoritative control plane and local query store; Cloudflare Worker + D1 + R2 + Durable Objects is the always-online relay/backup; iOS 18 Shortcuts are execution nodes. The UI is not implemented, only REST/WebSocket contracts. Shortcut silent updating is best-effort with manual Replace fallback and never blocks messaging delivery.

**Tech Stack:** Node.js >=22, TypeScript, npm workspaces, Zod, Fastify, WebSocket, SQLite, Vitest, Cloudflare Workers, Hono, D1, R2, Durable Objects, Wrangler, Cherri, RoutineHub HubSign/shortcut-signer.

**Spec:** `docs/superpowers/specs/2026-09-04-iphone-sms-control-design.md`

## Global Constraints

- Target iOS is **18.x**; do not require iOS 26-only Shortcut actions.
- Do not require Apple ID, iCloud, or APNs.
- Windows HTTP/WebSocket must bind only to `127.0.0.1`.
- Command poll interval defaults to **10 seconds** and is remotely configurable.
- A device is offline after **30 seconds** without authenticated activity.
- Offline outbound sends fail immediately and are not queued for later automatic send.
- Inbound iPhone events remain in local iPhone retry storage until Cloudflare ACK; no expiry.
- Cloudflare and Windows permanently retain messages and attachments.
- No secrets, phone-message datasets, SQLite databases, or runtime attachments are committed to Git.
- Every mutating command uses an idempotency key and readback result.
- UI implementation is out of scope.

---

### Task 1: Create the child repository and TypeScript workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`
- Create: `packages/contracts/package.json`
- Create: `apps/local-service/package.json`
- Create: `cloudflare/package.json`
- Test: root workspace scripts

**Interfaces:**
- Produces npm workspaces `packages/contracts`, `apps/local-service`, `cloudflare`.
- Produces root scripts `build`, `test`, `typecheck`, `lint`.

- [ ] **Step 1: Create private GitHub repository `dali420857-dotcom/826-iPhone-SMS-Control`**

Use private visibility. Do not initialize secrets or sample phone numbers.

- [ ] **Step 2: Add workspace package manifest**

```json
{
  "name": "826-iphone-sms-control",
  "private": true,
  "engines": { "node": ">=22" },
  "workspaces": ["packages/*", "apps/*", "cloudflare"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present"
  }
}
```

- [ ] **Step 3: Add gitignore and environment template**

`.gitignore` must include:

```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
runtime/
*.sqlite
*.sqlite3
attachments/
shortcuts/build/*.shortcut
.wrangler/
.dev.vars
```

`.env.example` contains variable names only:

```dotenv
LOCAL_HOST=127.0.0.1
LOCAL_PORT=8261
CLOUDFLARE_WORKER_URL=
WINDOWS_RELAY_TOKEN=
LOCAL_DB_PATH=runtime/826-sms.sqlite3
LOCAL_ATTACHMENT_DIR=runtime/attachments
```

- [ ] **Step 4: Install baseline dependencies and run workspace typecheck**

Expected: all empty packages compile with zero errors.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: bootstrap iPhone SMS control workspace"
```

---

### Task 2: Define shared contracts and state machines

**Files:**
- Create: `packages/contracts/src/device.ts`
- Create: `packages/contracts/src/message.ts`
- Create: `packages/contracts/src/command.ts`
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/api.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces Zod schemas and inferred TS types consumed by Cloudflare and local-service.
- Produces `CommandStatus`, `MessageStatus`, `RealtimeEvent` unions.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import { CommandSchema, DeviceSchema, InboundMessageSchema } from "../src/index.js";

describe("shared contracts", () => {
  it("rejects a send command without an idempotency key", () => {
    expect(CommandSchema.safeParse({ command_id: "cmd_1", action: "send_sms" }).success).toBe(false);
  });

  it("accepts an online iOS 18 device snapshot", () => {
    expect(DeviceSchema.safeParse({
      device_id: "iphone-001",
      name: "iPhone-001",
      phone_number: "+15555550100",
      ios_version: "18.7",
      last_seen_at: "2026-09-04T08:00:00.000Z"
    }).success).toBe(true);
  });

  it("requires event_id for inbound idempotency", () => {
    expect(InboundMessageSchema.safeParse({ device_id: "iphone-001", body: "hi" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test and verify failure due to missing schemas**

Run: `npm test -w packages/contracts`

- [ ] **Step 3: Implement exact schemas**

Required command states:

```ts
export const CommandStatusSchema = z.enum([
  "pending", "claimed", "executing", "success", "failed", "failed_timeout"
]);
```

Required delivery states:

```ts
export const DeliveryStateSchema = z.enum([
  "unknown", "sent", "delivered", "read", "failed"
]);
```

`CommandSchema` must include `command_id`, `device_id`, `action`, `payload`, `idempotency_key`, `created_at`, `expires_at`, `status`, nullable claim/completion/retry linkage timestamps/IDs.

- [ ] **Step 4: Run contract tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat: define SMS control contracts"
```

---

### Task 3: Provision Cloudflare Worker, D1, R2, and Durable Object

**Files:**
- Create: `cloudflare/wrangler.toml`
- Create: `cloudflare/migrations/0001_initial.sql`
- Create: `cloudflare/src/env.ts`
- Create: `cloudflare/src/index.ts`
- Create: `cloudflare/src/durable-objects/windows-relay.ts`
- Test: `cloudflare/test/bindings.test.ts`

**Interfaces:**
- Produces bindings `DB`, `ATTACHMENTS`, `WINDOWS_RELAY`.
- Produces `/v1/health` and WebSocket upgrade `/v1/windows/events`.

- [ ] **Step 1: Write failing binding/health test**

```ts
it("returns the Cloudflare service contract", async () => {
  const res = await app.request("http://test/v1/health", {}, env);
  expect(await res.json()).toMatchObject({ status: "ok", service: "826-iphone-sms-control" });
});
```

- [ ] **Step 2: Create D1 schema**

`0001_initial.sql` creates:

```sql
CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  ios_version TEXT,
  shortcut_versions_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE pairing_sessions (
  pairing_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  desired_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  event_id TEXT UNIQUE,
  device_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  transport TEXT NOT NULL,
  sender TEXT,
  body TEXT,
  status TEXT NOT NULL,
  delivery_state TEXT NOT NULL,
  retry_of_message_id TEXT,
  created_at TEXT NOT NULL,
  received_at TEXT,
  sent_at TEXT
);

CREATE TABLE message_recipients (
  message_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  PRIMARY KEY(message_id, phone_number)
);

CREATE TABLE attachments (
  attachment_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  object_key TEXT,
  file_name TEXT,
  media_type TEXT,
  byte_size INTEGER,
  capture_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE commands (
  command_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  retry_of_command_id TEXT
);

CREATE TABLE command_results (
  command_id TEXT PRIMARY KEY,
  success INTEGER NOT NULL,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE shortcut_versions (
  shortcut_name TEXT NOT NULL,
  version TEXT NOT NULL,
  ios_min TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(shortcut_name, version)
);

CREATE TABLE sync_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  device_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 3: Implement Hono health route and Durable Object socket holder**

`WindowsRelay` must accept authenticated WebSocket upgrades and expose a method to broadcast an already-persisted event. It must not be the durable source of truth.

- [ ] **Step 4: Run tests and `wrangler types`/typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudflare
git commit -m "feat: provision Cloudflare relay storage"
```

---

### Task 4: Implement device authentication, pairing, and heartbeat

**Files:**
- Create: `cloudflare/src/auth/device-auth.ts`
- Create: `cloudflare/src/routes/pairing.ts`
- Create: `cloudflare/src/routes/devices.ts`
- Create: `cloudflare/src/repositories/devices.ts`
- Test: `cloudflare/test/pairing.test.ts`
- Test: `cloudflare/test/device-auth.test.ts`

**Interfaces:**
- Produces `POST /v1/pairing-sessions` for Windows relay auth.
- Produces `POST /v1/pair/complete` for one-time iPhone pairing.
- Produces `POST /v1/devices/:deviceId/heartbeat`.

- [ ] **Step 1: Write tests for single-use pairing**

Assert: first completion returns a device token; second use of same pairing secret returns 409/invalid; expired secret returns 410.

- [ ] **Step 2: Implement token hashing with Web Crypto SHA-256/HMAC-safe comparison**

Never store raw long-lived device token in D1.

- [ ] **Step 3: Implement heartbeat**

Heartbeat input:

```json
{
  "ios_version": "18.7",
  "shortcut_versions": { "826-Command-Poller": "1.0.0" }
}
```

Update `last_seen_at` server-side.

- [ ] **Step 4: Run tests**

Expected: pairing is atomic and device token scope cannot access another device.

- [ ] **Step 5: Commit**

```bash
git add cloudflare/src cloudflare/test
git commit -m "feat: add iPhone pairing and device auth"
```

---

### Task 5: Implement command creation, claim, expiry, and result readback

**Files:**
- Create: `cloudflare/src/routes/commands.ts`
- Create: `cloudflare/src/repositories/commands.ts`
- Create: `cloudflare/src/services/events.ts`
- Test: `cloudflare/test/commands.test.ts`

**Interfaces:**
- Produces `POST /v1/commands` (Windows only).
- Produces `POST /v1/devices/:deviceId/commands/claim-next` (device only).
- Produces `POST /v1/devices/:deviceId/commands/:commandId/result`.

- [ ] **Step 1: Write concurrency/idempotency tests**

Two claims for the same device must not both return the same pending command. Repeating `POST /v1/commands` with the same idempotency key returns the existing command rather than a duplicate.

- [ ] **Step 2: Implement atomic claim**

Claim only commands where `status='pending'`, `device_id` matches, and `expires_at > now`.

- [ ] **Step 3: Implement result persistence before realtime broadcast**

Transaction order:

```text
write command result -> update command -> insert sync_event -> broadcast event
```

- [ ] **Step 4: Implement timeout sweeper on access**

Any stale pending command past `expires_at` is transitioned to `failed_timeout`; it is never requeued.

- [ ] **Step 5: Run tests and commit**

```bash
git add cloudflare
git commit -m "feat: add durable iPhone command lifecycle"
```

---

### Task 6: Implement inbound message ingestion and sync cursor

**Files:**
- Create: `cloudflare/src/routes/messages.ts`
- Create: `cloudflare/src/routes/sync.ts`
- Create: `cloudflare/src/repositories/messages.ts`
- Test: `cloudflare/test/messages.test.ts`
- Test: `cloudflare/test/sync.test.ts`

**Interfaces:**
- Produces `POST /v1/devices/:deviceId/messages/inbound`.
- Produces `GET /v1/windows/sync?after=<sequence>&limit=<n>`.

- [ ] **Step 1: Write duplicate inbound test**

Post the same `event_id` twice and assert exactly one message and one durable sync event are created.

- [ ] **Step 2: Implement normalized conversation key**

For v1 single-recipient inbound, derive stable conversation identity from `device_id + normalized peer number`; group identity uses sorted participant numbers when provided.

- [ ] **Step 3: Insert message and sync event transactionally**

ACK only after D1 persistence succeeds.

- [ ] **Step 4: Implement cursor recovery endpoint**

`sequence` is monotonic and returned with every event.

- [ ] **Step 5: Run tests and commit**

```bash
git add cloudflare
git commit -m "feat: add idempotent inbound message sync"
```

---

### Task 7: Implement R2 attachment APIs

**Files:**
- Create: `cloudflare/src/routes/attachments.ts`
- Create: `cloudflare/src/services/r2.ts`
- Test: `cloudflare/test/attachments.test.ts`

**Interfaces:**
- Produces authenticated upload/download routes scoped to message/command/device.
- Produces R2 object keys that never contain bearer tokens.

- [ ] **Step 1: Write authorization tests**

A device token for `iphone-001` must not download an attachment assigned to `iphone-002`.

- [ ] **Step 2: Implement object key format**

```text
attachments/<device_id>/<attachment_id>/<sanitized_filename>
```

- [ ] **Step 3: Persist attachment metadata in D1 after successful upload**

No size limit is imposed by 826; provider/platform errors are surfaced.

- [ ] **Step 4: Run tests and commit**

```bash
git add cloudflare
git commit -m "feat: add durable attachment storage"
```

---

### Task 8: Build Windows SQLite store and Cloudflare sync client

**Files:**
- Create: `apps/local-service/src/config.ts`
- Create: `apps/local-service/src/db/schema.sql`
- Create: `apps/local-service/src/db/database.ts`
- Create: `apps/local-service/src/cloudflare/client.ts`
- Create: `apps/local-service/src/sync/sync-engine.ts`
- Test: `apps/local-service/test/sync-engine.test.ts`

**Interfaces:**
- Produces `applySyncEvent(event): void`.
- Produces durable `sync_state.last_sequence`.

- [ ] **Step 1: Write sync transaction test**

Given sequences 1,2,3, apply once, restart database, then reapply 2,3; assert no duplicate message and cursor remains 3.

- [ ] **Step 2: Create local SQLite schema**

Include `devices`, `contacts`, `contact_phone_numbers`, `conversations`, `messages`, `message_recipients`, `attachments`, `commands`, `events`, `sync_state`, `contact_import_conflicts`.

- [ ] **Step 3: Implement incremental sync**

Use transaction per page: apply rows then advance cursor only after all writes commit.

- [ ] **Step 4: Run tests and commit**

```bash
git add apps/local-service
git commit -m "feat: add local durable sync store"
```

---

### Task 9: Implement Windows realtime Cloudflare WebSocket and localhost event fanout

**Files:**
- Create: `apps/local-service/src/realtime/cloudflare-socket.ts`
- Create: `apps/local-service/src/realtime/local-event-hub.ts`
- Test: `apps/local-service/test/realtime.test.ts`

**Interfaces:**
- Produces `CloudflareSocket.start()` with reconnect/resume.
- Produces local `/api/v1/events` WebSocket stream.

- [ ] **Step 1: Write disconnect recovery test**

Simulate socket loss, insert durable events while disconnected, reconnect, invoke sync engine, and assert local subscribers see exactly one event per durable record.

- [ ] **Step 2: Implement exponential reconnect capped to a small safe interval**

Realtime reconnect must not replace cursor sync.

- [ ] **Step 3: Commit**

```bash
git add apps/local-service/src/realtime apps/local-service/test
git commit -m "feat: add realtime relay with durable recovery"
```

---

### Task 10: Implement UI-ready Local REST API

**Files:**
- Create: `apps/local-service/src/server.ts`
- Create: `apps/local-service/src/api/devices.ts`
- Create: `apps/local-service/src/api/messages.ts`
- Create: `apps/local-service/src/api/conversations.ts`
- Create: `apps/local-service/src/api/search.ts`
- Create: `apps/local-service/src/api/system.ts`
- Test: `apps/local-service/test/api.test.ts`

**Interfaces:**
- Produces all `/api/v1` endpoints in the spec.

- [ ] **Step 1: Write bind-host test**

Configuration must reject `0.0.0.0` and non-loopback bind unless a future explicit feature changes the policy.

- [ ] **Step 2: Write offline-send test**

Device with `last_seen_at` older than 30 seconds returns HTTP 409 with stable code `DEVICE_OFFLINE`; no command API call is made.

- [ ] **Step 3: Implement send API**

Request:

```json
{
  "device_id": "iphone-001",
  "recipients": ["+15555550100"],
  "body": "Hello",
  "attachment_ids": []
}
```

Response includes local `message_id`, cloud `command_id`, and current status.

- [ ] **Step 4: Implement manual retry**

`POST /api/v1/messages/:messageId/retry` creates a new command with `retry_of_message_id`/`retry_of_command_id` linkage.

- [ ] **Step 5: Run API tests and commit**

```bash
git add apps/local-service
git commit -m "feat: expose local SMS control API"
```

---

### Task 11: Implement contacts CSV/vCard import, edit, conflict handling

**Files:**
- Create: `apps/local-service/src/contacts/normalize-phone.ts`
- Create: `apps/local-service/src/contacts/import-csv.ts`
- Create: `apps/local-service/src/contacts/import-vcard.ts`
- Create: `apps/local-service/src/api/contacts.ts`
- Test: `apps/local-service/test/contacts.test.ts`

**Interfaces:**
- Phone uniqueness is normalized E.164-like representation when parseable.
- Produces import result counts and conflict records.

- [ ] **Step 1: Write duplicate merge tests**

CSV and vCard importing the same number twice creates one number row. Conflicting names keep existing contact name and create one unresolved conflict record.

- [ ] **Step 2: Implement imports and CRUD**

Do not sync contacts to iPhone.

- [ ] **Step 3: Run tests and commit**

```bash
git add apps/local-service
git commit -m "feat: add local contact management"
```

---

### Task 12: Implement global search

**Files:**
- Create: `apps/local-service/src/search/search-service.ts`
- Modify: `apps/local-service/src/api/search.ts`
- Test: `apps/local-service/test/search.test.ts`

**Interfaces:**
- Search defaults to all devices.
- Supports `q`, `device_id`, `contact_id`, `from`, `to`, `limit`, `cursor`.

- [ ] **Step 1: Write cross-device search test**

Seed two devices with matching message text and assert unfiltered query returns both while `device_id=iphone-001` returns one.

- [ ] **Step 2: Implement indexed SQLite search**

Use SQLite FTS where appropriate for message/contact text; fall back to normalized exact/LIKE matching for phone/device IDs.

- [ ] **Step 3: Run tests and commit**

```bash
git add apps/local-service
git commit -m "feat: add global SMS search"
```

---

### Task 13: Build Windows Shortcut toolchain and update Spike

**Files:**
- Create: `shortcuts/README.md`
- Create: `shortcuts/manifests/826-Test-Updater.json`
- Create: `shortcuts/src/826-Test-Updater-v1.cherri`
- Create: `shortcuts/src/826-Test-Updater-v2.cherri`
- Create: `shortcuts/scripts/verify_shortcut.py`
- Create: `shortcuts/scripts/build.ps1`
- Create: `shortcuts/scripts/sign.ps1`
- Create: `shortcuts/scripts/publish.ps1`
- Test: `shortcuts/scripts/verify_shortcut.py --self-test`

**Interfaces:**
- Produces verified unsigned artifacts, HubSign-signed AEA1 artifacts, R2 release metadata.

- [ ] **Step 1: Implement verifier self-test**

Verifier must reject zero actions and any `is.workflow.actions.rawaction`, and accept expected action identifiers.

- [ ] **Step 2: Build v1 and v2 with visible version readback**

Use a test action that reports version without requiring message permissions.

- [ ] **Step 3: Sign with approved HubSign path**

Verify first four bytes are `AEA1`; never embed runtime secrets.

- [ ] **Step 4: Publish v2 manifest/R2 artifact**

- [ ] **Step 5: Real-device iOS 18 test**

Install v1 once, attempt updater-driven v2 same-name replacement. Record outcome:

```text
silent_success
manual_replace_required
failed_other
```

`manual_replace_required` is acceptable and does not block subsequent tasks.

- [ ] **Step 6: Commit evidence and scripts**

```bash
git add shortcuts docs
git commit -m "feat: add Windows Shortcut release pipeline"
```

---

### Task 14: Implement production iOS Shortcut sources

**Files:**
- Create: `shortcuts/src/826-Device-Setup.cherri`
- Create: `shortcuts/src/826-Command-Poller.cherri`
- Create: `shortcuts/src/826-SMS-Send.cherri`
- Create: `shortcuts/src/826-SMS-Media.cherri`
- Create: `shortcuts/src/826-SMS-Receive.cherri`
- Create: `shortcuts/src/826-Device-Heartbeat.cherri`
- Create: `shortcuts/src/826-Device-Updater.cherri`
- Create: `shortcuts/src/826-Device-Recovery.cherri`
- Create manifests for each Shortcut.

**Interfaces:**
- All cloud calls use per-device token loaded from On My iPhone runtime storage.
- All action results use shared JSON envelope `{status, action, command_id, result, error}`.

- [ ] **Step 1: Implement Device Setup pairing client**

Persist only runtime config locally after successful pairing.

- [ ] **Step 2: Implement Command Poller segmented loop**

Each segment performs: flush inbound retry queue -> heartbeat if due -> claim command -> dispatch -> result -> wait 10 seconds -> run Poller again.

- [ ] **Step 3: Implement SMS Send and Media dispatch**

Use built-in Messages send action with show-when-run disabled where iOS allows.

- [ ] **Step 4: Implement SMS Receive queue-first behavior**

Automation input becomes a local pending record before network upload. Remove only after Worker ACK.

- [ ] **Step 5: Implement Updater manual fallback**

On blocked same-name import, write update state so Windows can emit `shortcut_update_manual_confirmation_required`.

- [ ] **Step 6: Compile/inspect/sign all artifacts**

No artifact ships if verifier sees zero actions or rawaction placeholders.

- [ ] **Step 7: Commit**

```bash
git add shortcuts
git commit -m "feat: add iOS 18 SMS Shortcuts"
```

---

### Task 15: Add Cloudflare version manifest APIs and runtime configuration

**Files:**
- Create: `cloudflare/src/routes/shortcuts.ts`
- Create: `cloudflare/src/routes/runtime-config.ts`
- Test: `cloudflare/test/shortcuts.test.ts`

**Interfaces:**
- `GET /v1/devices/:deviceId/runtime-config` returns poll interval and feature flags.
- `GET /v1/shortcuts/latest?name=826-SMS-Send&ios=18.7` returns compatible signed release.

- [ ] **Step 1: Write compatibility tests**

An iOS 18 client must never receive a manifest with `ios_min` greater than its version.

- [ ] **Step 2: Implement default config**

```json
{
  "poll_interval_seconds": 10,
  "heartbeat_interval_seconds": 10,
  "offline_threshold_seconds": 30
}
```

- [ ] **Step 3: Commit**

```bash
git add cloudflare
git commit -m "feat: add Shortcut release and runtime config APIs"
```

---

### Task 16: End-to-end one-device acceptance

**Files:**
- Create: `tests/e2e/one-device.md`
- Create: `scripts/doctor.mjs`
- Create: `scripts/smoke.mjs`
- Create: `docs/operations/first-device.md`

**Interfaces:**
- `npm run doctor` checks env, Worker, D1, R2, DO, localhost bind, and SQLite writability without sending a message.
- `npm run smoke` performs read-only health + disposable command lifecycle checks unless explicit real-send flag is provided.

- [ ] **Step 1: Deploy Cloudflare via Wrangler**

Use the user's existing Cloudflare account and one production environment.

- [ ] **Step 2: Pair one iOS 18 test phone**

- [ ] **Step 3: Verify text outbound**

Windows creates command -> iPhone claims -> Messages sends -> result reaches SQLite.

- [ ] **Step 4: Verify text inbound**

Incoming message -> local iPhone queue -> Worker -> D1 -> Windows -> SQLite.

- [ ] **Step 5: Verify Windows-offline recovery**

Turn off local service, receive message, restart service, verify cursor sync.

- [ ] **Step 6: Verify Cloudflare/network interruption**

Force upload failure, confirm iPhone pending queue persists; restore, confirm one cloud record only.

- [ ] **Step 7: Verify offline outbound rejection**

Stop iPhone poller >30 seconds; local send API must fail without creating cloud command.

- [ ] **Step 8: Commit runbook/evidence**

```bash
git add tests scripts docs
git commit -m "test: verify one-device SMS control path"
```

---

### Task 17: Media, group, contacts, search acceptance

**Files:**
- Create: `tests/e2e/media-group-search.md`
- Update: `docs/operations/first-device.md`

- [ ] **Step 1: Test multi-recipient send on the test carrier/iOS 18 device**

Record actual transport and result; do not infer carrier behavior.

- [ ] **Step 2: Test outbound image/video/file flows**

Record which iOS 18 attachment types the Messages action accepts.

- [ ] **Step 3: Test incoming media automation input**

If binary is exposed, verify R2 + Windows copy. If not, verify `capture_status=unavailable_from_ios` rather than data loss masquerading as success.

- [ ] **Step 4: Import CSV and vCard with duplicates/conflicts**

Verify merge/conflict rules.

- [ ] **Step 5: Search across seeded device/message/contact data**

- [ ] **Step 6: Commit evidence**

```bash
git add tests docs
git commit -m "test: verify media contacts and search flows"
```

---

### Task 18: Five-device scale validation

**Files:**
- Create: `tests/e2e/five-device-scale.md`
- Create: `docs/operations/five-device-rollout.md`

- [ ] **Step 1: Pair five devices with distinct `device_id` and phone number**

- [ ] **Step 2: Verify 10-second polling budget**

Expected base device polling around 43,200 requests/day for five devices, before other traffic.

- [ ] **Step 3: Verify device isolation**

A command for `iphone-003` must never be claimable by another token/device.

- [ ] **Step 4: Verify independent conversations**

Same peer phone number on two devices produces separate conversations because `device_id` is part of identity.

- [ ] **Step 5: Verify online/offline events at 30 seconds**

- [ ] **Step 6: Commit**

```bash
git add tests docs
git commit -m "test: validate five-device SMS control"
```

---

### Task 19: Register child capability in parent `826`

**Files in parent repository:**
- Modify: `config/capabilities.yaml`
- Modify: `config/connectors.yaml`
- Modify: `graphs/system-context.mmd`
- Modify: `graphs/data-flow.mmd`
- Modify: `graphs/state-machine.mmd`
- Create: `docs/architecture/iphone-sms-control.md`
- Test: existing `scripts/Verify-Baseline.ps1`

**Interfaces:**
- Parent capabilities expose observation + approved `send_sms` mutation through the child connector.

- [ ] **Step 1: Register observation capabilities**

`inspect_sms_devices`, `search_sms_messages`, `inspect_sms_conversation` require readback and no mutation approval.

- [ ] **Step 2: Register `send_sms` mutation**

Require device scope, dry-run/preview where applicable, idempotency key, health check, readback, explicit approved use of owned/authorized devices.

- [ ] **Step 3: Register connector**

Child local endpoint is loopback only; Cloudflare credentials remain external secrets.

- [ ] **Step 4: Update graphs and architecture reference**

- [ ] **Step 5: Run parent verification**

```powershell
pwsh -NoProfile -File .\scripts\Verify-Baseline.ps1
```

- [ ] **Step 6: Commit parent integration**

```bash
git add config graphs docs
git commit -m "feat: register iPhone SMS cloud-control capability"
```

---

### Task 20: Final verification and release readiness

**Files:**
- Update: `README.md`
- Create: `docs/verification/release-checklist.md`

- [ ] **Step 1: Run all static/test gates**

```bash
npm run typecheck
npm test
npm run build
npm run lint
```

- [ ] **Step 2: Run Cloudflare local/integration tests**

```bash
npm test -w cloudflare
npx wrangler deploy --dry-run
```

- [ ] **Step 3: Run secret/runtime-data scan**

Confirm no device token, Worker admin credential, SMS body dataset, SQLite file, or attachment binary is tracked.

- [ ] **Step 4: Run `doctor` against deployed infrastructure**

Expected: Worker/D1/R2/DO reachable, localhost storage writable, realtime socket connected.

- [ ] **Step 5: Document known iOS 18 capability results**

Explicitly list silent update result, inbound attachment capture result, group behavior, and delivery/read-state availability.

- [ ] **Step 6: Commit release documentation**

```bash
git add README.md docs
git commit -m "docs: finalize iPhone SMS control release readiness"
```

## Plan self-review

- Every fixed spec requirement has an owning task.
- Silent Shortcut replacement is no longer a release blocker; manual Replace fallback is an explicit accepted state.
- Offline outbound messages are never silently queued for later send.
- Inbound retry is durable and idempotent.
- UI remains out of scope while its complete REST/WebSocket data surface is specified.
- Cloudflare realtime is backed by D1 cursor recovery rather than treated as durable transport.
- No task requires Apple ID/iCloud/APNs or iOS 26.
