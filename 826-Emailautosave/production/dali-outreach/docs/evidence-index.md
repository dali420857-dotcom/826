# Phase-0 evidence index

Status: verified for local synthetic fixtures, fake adapters, monitoring-only, and no-send. Provider and live operation remain blocked and unverified.

| Layer | Evidence |
| --- | --- |
| Source | GitHub revision `82141617f15e8921be471f44804da1c2a0683c34`; per-file SHAs in `manifests/source-baseline.json` |
| Contracts and runtime | `npm run verify`: 16 test files, 231 tests, typecheck and Vite build, exit 0 |
| UI to backend | Render/click Email and Telegram integration through opaque typed mutation port, dispatcher, backend audit and queue readback |
| Domain allowlist | Exactly Email 6 plus Telegram 6 operations; snapshot/pause/resume remain a separate typed control seam |
| Browser | Self-started loopback matrix at 1920×1080, 1366×768, and 390×844; activation-off, source states, Email success/failure/unknown/double-trigger, Telegram full no-send queue |
| Browser safety | Zero console warnings/errors, non-loopback HTTP/WebSocket requests, horizontal overflow, unnamed controls, or heading-level skips |
| Runtime safety | Explicit `runtime:monitor`, `127.0.0.1` only, process fetch/raw socket no-egress, capability absent from JSON/DOM/HTML |
| Dependencies | 121 verified registry signatures, 50 attestations, 0 production vulnerabilities |
| Independent review | DA-010 and DA-011 final PASS; no unresolved high/critical finding |
| Baseline exception | `Verify-Baseline.ps1` exits 1 only for two pre-existing credential-like strings in read-only historical reference documents |

The shared upper-project capability and generated Graphify files were already dirty before closeout, so this delivery does not overwrite them. The scoped capability map and architecture graph are stored in this production tree and must be merged into the upper registries only in a separately reconciled change.

