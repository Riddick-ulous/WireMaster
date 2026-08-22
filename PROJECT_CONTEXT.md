# WireMaster – Project Context

## Current stage
M0.2 splices + deeper reconciliation is based on `m0.2-splices-reconciliation`.
The electrical-viewer grid-router rework is **in progress** on `m0.2-grid-router-rework`.

M0.1 was merged to `main` as PR #1 at commit `e1a297210d8542be2f80c53cccb4264a31785175` and is frozen except for regressions discovered by later work.

M0.2 is extending the existing TypeScript domain core and resolver incrementally. Do not rebuild M0.1 modules from scratch.

## Non-negotiable invariants
- Domain model is the single source of truth; editor/viewer are views.
- Internal UUIDs are stable and independent from display IDs/names.
- Nets are project-wide; wires and splices belong to a sub-harness.
- Electrical net membership is not physical or explicit splice topology.
- Normal wires are resolver-generated, then persistent objects.
- Resolver/reconciliation never destructively rebuilds persistent wires/splices.
- Ambiguous topology changes become `NEEDS_REVIEW`; never guess a replacement topology.
- Property inheritance is field-wise: `INHERIT`, `EXPLICIT(value)`, `EXPLICIT(null)`.
- Viewer may change only layout/selection, never electrical connectivity.
- Bulk edits and splice operations are atomic transactions; undo/redo history is capped at 30 actions.
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

## M0.1 merged baseline
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

## M0.2 implementation target
Implement on top of the M0.1 resolver rather than replacing it:
- explicit persistent `SpliceInstance` topology
- connector-near and free splices
- pin↔splice and splice↔splice desired wire segments
- multiple splices on one net
- non-destructive wire/splice reconciliation with `ACTIVE`, `BROKEN`, `DANGLING`, `ORPHANED`, `NEEDS_REVIEW`
- stable wire/splice IDs where topology matching is unique
- no inferred topology for ambiguous multi-point nets
- connector-near splice child rows in the editor
- splice nodes and splice-connected wires in the electrical viewer
- free-splice viewer positions persisted in `ViewerLayout`
- save/reload + atomic undo/redo coverage

## M0.2 verification target
Regression coverage must include:
- M0.1 pin-pin identity remains stable
- pin-splice-pin produces two persistent wire segments
- disconnect/reconnect preserves IDs where unique
- missing pins/endpoints produce lifecycle/review state rather than deletion
- multiple splices on one net
- splice-splice segments
- ambiguous multi-point changes use `NEEDS_REVIEW`
- save/reload preserves splices, wires and splice layout
- one splice creation is one undo/redo transaction
- all existing M0.1 tests remain green

CI remains:
- `npm ci`
- `npm test`
- TypeScript + Vite production build
- Tauri release build (`--no-bundle`) on Linux
- Tauri release build on Windows

## Grid-router rework checkpoint (2026-08-22)

Accepted V3 candidate path:

```text
physical connector terminals + physical splice terminals
-> bundle-aware contiguous splice egresses on one 28 px grid phase
-> tolerant bundle-first 160/180 global router
-> splice finalization
```

- bundles are a global routing preference, not a mandatory full-route N-track strip;
- the global router may route bundle members independently when an atomic corridor does not fit;
- `gridGlobalBundleRouterV3` remains a named pure-bundle experiment, not the candidate main path;
- connector fanout, per-cavity turn lanes, endpoint/viewer-slot separation and diagnostic SVGs remain preserved experiments/regressions;
- all 73/73 transformed endpoint-pair bundle groups remain independently routable;
- the visible 30-connector demo keeps every connector on the perimeter, at least four free 28 px grids between neighbouring connector bodies, and double (eight-grid) clearance in both axes at every corner;
- the accepted candidate currently routes 176/180 wires on the 30-connector demo and 175/180 wires on the deterministic 40-splice fixture;
- the accepted candidate is now the Electrical Viewer main path; connector cavities are projected into derived bundle-grouped viewer slots without changing electrical endpoint identity;
- the toolbar keeps a directly loadable `Router Demo (30C)` project with the 30-connector / 180-wire perimeter fixture for manual testing;
- connector fanout plus the tolerant router reaches only 149/180, below the hard 160/180 promotion gate, so connector fanout is not in the candidate main path yet;
- connector fanout plus the rigid pure-bundle router remains diagnostic-only at 120/180.

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
