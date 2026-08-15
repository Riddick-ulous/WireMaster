# WireMaster – Project Context

## Current stage
M0.1 bootstrap / vertical slice — CI hardening.

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

## M0.1 implemented target
- create/load demo project
- connector blocks and pin/net editing
- arbitrary net name creates/reuses project Net
- exactly two endpoints in one sub-harness resolve to a persistent Wire
- wire ID/color rendered in viewer
- connector selection viewer -> editor
- net highlighting
- 30-step transactional undo/redo, including Ctrl+Z/Ctrl+Y outside active cell editors
- range paste is committed to the domain as one bulk transaction
- JSON serialize/deserialize
- automated core tests

## Current hardening status
- Locked `package-lock.json` and `src-tauri/Cargo.lock` are committed.
- Web CI is green: `npm ci`, all core tests, and the production Vite/TypeScript build pass.
- Tauri/Rust CI is now part of the permanent read-only workflow.
- First Tauri check exposed the missing required app icon; a provisional `src-tauri/icons/icon.png` is now committed and the check is being rerun.
- M0.1 is not declared review-ready until both web-core and tauri-core are green.

## Read before each stage
1. `docs/requirements_mvp.md`
2. `docs/data_model.md`
3. `docs/architecture.md`
4. `DEVELOPMENT.md`
5. current code + tests

Update this file after every completed milestone.
