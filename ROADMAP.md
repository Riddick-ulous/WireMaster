# Roadmap

## M0.1 – Core vertical slice
- domain model + schema version
- JSON persistence
- transaction history (30)
- connector-centric editor spike
- project nets
- 2-pin auto-wire resolver + persistent reconciliation
- live React Flow viewer
- wire ID / gauge / color labels
- viewer -> editor selection
- core tests

## M0.2 – Splices + deeper reconciliation
- unresolved multi-point nets
- connector-near splice workflow
- free splice objects
- multiple splices per net / branch-moving UX
- splice reconciliation and review states

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
