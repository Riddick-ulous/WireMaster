# WireMaster – Project Context

## Current stage
M0.1 bootstrap / vertical slice.

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
- 30-step transactional undo/redo
- JSON serialize/deserialize
- automated core tests

## Read before each stage
1. `docs/requirements_mvp.md`
2. `docs/data_model.md`
3. `docs/architecture.md`
4. `DEVELOPMENT.md`
5. current code + tests

Update this file after every completed milestone.
