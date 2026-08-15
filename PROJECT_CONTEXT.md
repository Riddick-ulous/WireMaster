# WireMaster – Project Context

## Current stage
M0.1 bootstrap / vertical slice — **review candidate**.

## Non-negotiable invariants
- Domain model is the single source of truth; editor/viewer are views.
- Internal UUIDs are stable and independent from display IDs/names.
- Nets are project-wide; wires belong to a sub-harness.
- Normal wires are resolver-generated, then persistent objects.
- Resolver/reconciliation never destructively rebuilds persistent wires/splices.
- Property inheritance is field-wise: `INHERIT`, `EXPLICIT(value)`, `EXPLICIT(null)`.
- Viewer may change only layout/selection, never electrical connectivity.
- Bulk edits are atomic transactions; undo/redo history is capped at 30 actions.
- UI code must not own resolver, inheritance, DRC, or persistence semantics.

## Target architecture
```text
Tauri
├─ React UI
│  ├─ connector-centric editor
│  └─ electrical viewer
└─ TypeScript domain core
   ├─ model
   ├─ inheritance
   ├─ transactions
   ├─ resolver/reconciliation
   ├─ persistence
   └─ later DRC/library resolvers
```

## M0.1 implemented
- create/load blank or demo project
- connector blocks and pin/net editing
- arbitrary net name creates/reuses project Net
- exactly two endpoints in one sub-harness resolve to a persistent Wire
- wire ID/gauge/color rendered in viewer
- connector selection viewer -> editor
- net highlighting
- draggable viewer connector layout persisted in project state
- 30-step transactional undo/redo, including Ctrl+Z/Ctrl+Y outside active cell editors
- range paste is committed to the domain as one bulk transaction
- JSON serialize/deserialize with `schemaVersion`
- automated core regression tests
- locked npm/Cargo dependencies
- provisional Tauri app icon so the native build is complete

## Automated verification
Current PR CI is green for the M0.1 code candidate:
- `npm ci`
- 6/6 Vitest core tests
- TypeScript + Vite production build
- complete Tauri release build via `npm run tauri build -- --no-bundle` on Ubuntu 22.04

The CI workflow runs once on pull requests and again on `main` after merge; feature-branch push + PR duplicate runs are intentionally avoided.

## Manual review gate before merge
The remaining M0.1 gate is a human desktop/UI smoke test, especially because spreadsheet feel cannot be proven by domain/unit tests alone:
1. open the Demo project
2. edit pin names and net names in connector blocks
3. confirm a 2-pin net creates/displays one Wxxx wire
4. disconnect/reconnect one endpoint and confirm the same wire identity returns
5. highlight a net and click a viewer connector to navigate to its editor block
6. drag connector nodes and confirm layout survives Save JSON / Open
7. paste a rectangular multi-cell block from Excel/Calc and confirm one Ctrl+Z removes the whole paste and Ctrl+Y restores it
8. check that the dark left/right layout remains usable at the intended desktop window size

If this smoke test is acceptable, merge PR #1 and start M0.2 from the merged `main` state.

## Read before each stage
1. `docs/requirements_mvp.md`
2. `docs/data_model.md`
3. `docs/architecture.md`
4. `DEVELOPMENT.md`
5. current code + tests

Update this file after every completed milestone.
