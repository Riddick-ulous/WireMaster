# Post-MVP Scope

## Physical topology / CAD
Physical graph of nodes, segments and branches; FreeCAD owns device/connector placement, routing geometry, routing constraints and physical branches. Harness tool owns electrical semantics. Exchange uses stable IDs and a structured graph rather than solids.

Roundtrip target:
```text
FreeCAD placement
→ WireMaster initial 3D graph
→ FreeCAD route/bend/merge/split
→ WireMaster final routing graph
```

## Derived geometry and manufacturing
From final routing graph: real wire lengths, service/fabrication allowances, bundle diameter, sleeves, bend radius, resistance, weight and optional final 3D loom sweeps.

## Connector manufacturing sheets
Per-connector generated table/drawing containing cavity, pin name/net, unique Wire ID, origin/destination, wire/cable PN, gauge, colors, contact/crimp PN, notes and connector-near splices. Data is generated from the model, never separately maintained.

## Documentation identity
Wire IDs are real searchable PDF text at both ends (and optionally mid-wire). `Ctrl+F W017` must locate every representation of that wire across generated documentation.

## 2D harness / nailboard
Flatten routing graph while preserving true path lengths; do not simply project 3D coordinates. Output 2D harness drawing and 1:1 nailboard with segment lengths, connector/branch/splice IDs, sleeves, labels, wire counts and breakout data.

## Outputs
BOM, cut list, contact/crimp list, connector population, splice list, sleeve lengths, labels, connector manufacturing sheets, 2D drawing, 1:1 nailboard and manufacturing DRC.
