# WireMaster – Project Context

## Current stage
M0.1 bootstrap / vertical slice — **implementation complete, PR #1 ready for final merge gate**.

M0.1 feature work is frozen. The only remaining gate before merge is:
1. final local visual confirmation of the last rotated-wire-label offset fix
2. exact-head CI green on web-core, Linux Tauri and Windows Tauri

After that, merge PR #1 and start M0.2 from updated `main`.

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
### Project / persistence
- create/load blank or demo project
- native Tauri Save dialog and JSON project persistence
- schema-versioned JSON persistence with backward-compatible viewer-layout defaults
- persistent connector positions and rotations through Save/Open

### Logical editor
- connector blocks with pin/net editing
- arbitrary net name creates/reuses a project-wide Net
- stable Tabulator lifetime during immutable domain transactions
- direct typing starts editing on the selected editable cell
- rectangular internal/external TSV copy/paste
- deterministic Excel/Calc paste dimensions; no Tabulator paste-to-fill repetition
- bulk paste committed as one domain transaction / one undo unit
- readable range-selection halo without black text/highlight corruption
- 30-step transactional undo/redo, including Ctrl+Z/Ctrl+Y outside active editors

### Resolver / identity
- exactly two endpoints in one sub-harness resolve to a persistent Wire
- non-destructive wire reconciliation reuses stable wire identity after disconnect/reconnect
- unresolved >2-endpoint nets retain pin assignments and do not guess a wire topology
- wire lifecycle states retained for broken/dangling/orphaned review cases

### Electrical viewer
- React Flow logical connector/wire view
- connector click navigates to editor block
- net highlighting and wire click highlighting
- live connector dragging with moving halo and live edge updates
- one bidirectional visual handle per pin using loose connection mode
- connector rotation 0/90/180/270 degrees as viewer-layout state only
- rotated connectors use compact vertical `cavity + pin name` labels and opposite-side header placement
- Smooth and custom 90° wire rendering modes
- wire ID/gauge/color labels kept near connector endpoints rather than wire centers
- custom orthogonal breakout/corridor routing with per-wire connector-local lanes at pin-pitch spacing
- same connector-pair routes may cross at 90° but do not intentionally share longitudinal segments

## Automated verification
Current M0.1 regression suite contains 8 core tests covering:
- field-wise inheritance including explicit null
- persistent wire identity across disconnect/reconnect
- net assignment preservation on newly added connectors
- 30-step undo/redo cap
- failed transaction atomicity
- bulk pin edit as one undo step
- JSON round-trip of IDs/wires/viewer rotation
- backward-compatible loading of schema-v1 projects predating connector rotations

CI verifies:
- `npm ci`
- `npm test`
- TypeScript + Vite production build
- complete Tauri release build (`--no-bundle`) on Linux
- complete Tauri release build on Windows

CI must be checked against the exact final PR head before merge.

## Manual M0.1 acceptance status
Confirmed during desktop testing:
- pin/net editing works
- 2-pin net creates/displays a persistent wire
- disconnect/reconnect preserves wire identity
- connector navigation and net highlighting work
- connector drag/halo and viewer layout work
- native Save/Open works and project data reloads
- rectangular WireMaster↔WireMaster copy/paste works
- Excel/Calc rectangular paste no longer tiles/repeats
- one Ctrl+Z removes a bulk paste and Ctrl+Y restores it
- direct typing starts cell editing
- Smooth/90° switching works
- connector rotation and compact rotated presentation work
- editor selection remains readable

Final local visual check before merge: rotated Top/Bottom endpoint wire labels must sit beside, not on top of, the vertical wire stub.

## M0.2 target
Start from merged `main` on a fresh branch, recommended name:
`m0.2-splices-reconciliation`

Scope:
- explicit `SpliceInstance` topology
- connector-near and free splices
- pin↔splice and splice↔splice wire endpoints
- persistent splice/wire identities under topology edits
- non-destructive reconciliation and review statuses
- connector-near splice child rows in the editor
- logical viewer representation for splices and their wires
- focused regression tests for identity preservation and ambiguous edits

Do not pull M0.3 library/contact work into M0.2 unless required by a hard model dependency.

## Later stages
```text
M0.3 Libraries + inheritance + contacts
M0.4 Devices + mating
M0.5 Twist/Cable/Shield
M0.6 DRC/ERC + revision handling
M0.7 Golden Harness + UX hardening
```

## Read before each stage
1. `docs/requirements_mvp.md`
2. `docs/data_model.md`
3. `docs/architecture.md`
4. `DEVELOPMENT.md`
5. `ROADMAP.md`
6. current code + tests

Update this file after every completed milestone.
