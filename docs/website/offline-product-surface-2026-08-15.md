# Offline product surface (2026-08-15)

## Delivered

The public selector and login evidence now drive a local, clean-room product surface:

- `/` — system selector for TG Cloud and Customer Service.
- `/login?system=tg` and `/login?system=customer` — terms/免责声明 modal, local-only login form, validation, and route transition.
- `/index?system=tg` and `/index?system=customer` — responsive workbench with metrics, recent tasks, shortcuts, notification drawer, account drawer, task detail drawer, and local draft dialog.
- Existing observed routes remain available through the fixture shell and keep their state/error/permission/dry-run coverage.

## Boundary

This is a behavior reconstruction, not a copy of the target site's executable bundle. Login values are validated in memory and are never persisted or sent. Task creation only changes component-local state and displays a local receipt. No new route performs a request to `konk.cc`.

## Evidence

The implementation was checked against the saved public acquisition and runtime records in `artifacts/authorized-mirror/`, especially the system selector, TG Cloud login shell, Customer Service login shell, and observed route inventory. Missing private API bodies remain gaps and are not invented as real integrations.

## Acceptance commands

```powershell
npm.cmd test
npm.cmd run build
npx.cmd playwright test e2e/product-surface.spec.ts
```
