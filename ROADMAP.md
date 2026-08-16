# Roadmap

## M0.1 – Core vertical slice — COMPLETE
- domain model + schema version
- JSON persistence + native Save dialog
- transaction history (30)
- connector-centric editor spike
- project nets
- deterministic rectangular copy/paste + atomic undo
- 2-pin auto-wire resolver + persistent reconciliation
- live React Flow viewer
- wire ID / gauge / color labels
- viewer -> editor selection + net highlighting
- draggable/persisted connector layout
- connector rotation 0/90/180/270°
- Smooth + custom orthogonal wire rendering
- single visual handle per pin
- compact rotated connector presentation
- core regression tests
- Linux + Windows Tauri CI

Merge gate: exact-head CI green plus final local visual confirmation of the last Top/Bottom endpoint-label offset fix in PR #1. After merge, M0.1 is frozen; continue on M0.2 from `main`.

## M0.2 – Splices + deeper reconciliation
- explicit `SpliceInstance` topology
- unresolved multi-point nets represented without guessing topology
- connector-near splice workflow
- free splice objects
- pin↔splice and splice↔splice wire endpoints
- multiple splices per net / branch-moving UX
- persistent splice/wire identity under topology edits
- splice reconciliation and review states
- connector-near splice child rows in the editor
- splice representation in the logical viewer
- focused reconciliation regression tests

## M0.3 – Libraries + inheritance + contacts
- Built-in/User/Project library layering
- Connector/Contact/WireFamily definitions
- WireClass and NetClass inheritance
- contact resolver from cavity type + gauge + preference
- seed schemas; initial AHDP/Mizu/BEDIA subset

## M0.4 – Devices + mating
- DeviceDefinition/Instance
- expected NetClass per device pin
- MatingConnection with library pin mapping
- net propagation across sub-harnesses
- project-wide tracing/highlight

## M0.5 – Twist/Cable/Shield
- net-wide TwistRules -> segment TwistGroups
- CableDefinition/Instance
- ShieldInstance + termination points

## M0.6 – ERC/DRC + library revisions
- rules/suppressions
- library revision diff/accept/reject
- old-revision badges

## M0.7 – Golden Harness + UX hardening
- full acceptance project
- paste stress test
- save/reload identity checks
- performance target ~100 connectors / 2k pins / 2k wires

## Post-MVP
See `docs/post_mvp.md`.
