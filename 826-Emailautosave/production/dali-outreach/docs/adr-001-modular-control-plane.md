# ADR-001 — Modular Email and Telegram control plane

Status: accepted for phase 0 on 2026-08-17.

## Decision

The Dali Outreach control plane is a compile-time modular React/TypeScript assembly. The first assembly installs only Email and Telegram. A module that is not installed contributes no navigation, route, fixture, domain operation, or backend handler.

The production entry is activation-off by default. A synthetic preview must be selected explicitly. A bridge activation receives opaque typed mutation and snapshot/control ports; the UI never receives the loopback endpoint or process capability as serializable configuration.

The domain operation registry contains exactly six Email and six Telegram operations. Runtime snapshot, pause, and resume are a separate typed control seam and do not expand the domain allowlist. The guarded runtime binds only to `127.0.0.1`, installs process-level outbound guards, and never starts by import.

## Consequences

- Email and Telegram can evolve independently behind one contract version.
- Unknown mutations remain locked until authoritative reconciliation.
- Provider adapters, OAuth, account login, schedules, and live-send cannot be enabled by configuration drift in phase 0.
- Adding another channel requires a separately approved module contribution, contract review, negative registration tests, and a fresh browser/security acceptance matrix.

## Rejected alternatives

- Reusing the retired Vue entry or historical reference runtime.
- A generic dynamic plugin loader.
- Arbitrary URL, shell, SQL, or filesystem bridge operations.
- Embedding a loopback capability in DOM, JSON, or the browser bootstrap.

