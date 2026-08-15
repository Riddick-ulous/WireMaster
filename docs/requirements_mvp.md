# MVP Requirements – Compact Specification

## Goal
Desktop-first logical harness editor with connector-centric spreadsheet editing and a live electrical viewer. Projects contain multiple sub-harnesses; nets are project-wide. Normal wire objects are created automatically from resolved connectivity and persist thereafter.

## Core principles
- structured domain model is the source of truth
- stable UUID != user-facing display ID
- field-wise inheritance with explicit null support
- library-first object creation
- non-destructive reconciliation for persistent derived objects
- atomic bulk transactions, max 30 undo/redo actions
- electrical violations become ERC/DRC findings rather than hard UI blocks

## UI
Left: long connector-block list for the active sub-harness. Each connector has metadata followed by a spreadsheet-like pin table. Right: live electrical viewer. Viewer supports zoom/pan, saved layout positions, net highlight and navigation back to the relevant editor connector. It cannot alter connectivity.

Viewer wire labels support:
```text
Compact:  W017
Standard: W017 · 0.22 · VT/RD
Full:     W017 · CAN1_H · SPEC55 · 0.22 · VT/RD
```

## Project model
Project-wide: Nets, NetClasses, WireClasses, Devices, MatingConnections, DRC suppressions. Sub-harness-local: connector instances, wire instances, splice instances, cable instances and viewer layout.

## Nets / wires
Pins are assigned to nets; users do not type destinations. Two endpoints in one sub-harness resolve to a wire. Multi-endpoint nets are unresolved until splice topology is defined. Wires are resolver-created but persistent, with stable IDs and field-wise manual overrides.

Connectivity review states: `UNRESOLVED`, `RESOLVED`, `CONFIRMED`. Relevant changes invalidate confirmation.

## Reconciliation
Persistent objects are reused whenever identity/relationship remains clear. Wires use `ACTIVE`, `BROKEN`, `DANGLING`, `ORPHANED`, `NEEDS_REVIEW`; no automatic permanent deletion. Ambiguous rebinding is never guessed.

## Splices
Connector-near splice is the default and conceptually resides in the connector boot; free splice is an independent harness object. Multiple connector-near splices may exist on one net, enabling CAN daisy chains. Additional-splice UX selects anchor, upstream splice, and branches moved to the new splice.

## Inheritance
Effective wire properties resolve field-by-field:
```text
Wire override > Net override > WireClass > WireFamily/Variant default
```
A local secondary-color override must survive a class-level gauge or primary-color change.

## Contacts
Connector cavities define cavity types and allowed contacts. Contact resolver uses cavity type + effective wire gauge + optional override, preferring the library-defined default (e.g. nickel) while allowing explicit alternatives (e.g. gold). Real orderable part numbers are required.

## Wire library
`WireFamilyDefinition` contains real orderable variants by gauge/color/construction and PN. WireClass chooses family + desired properties; resolver selects the concrete variant.

## Devices
Device definitions contain one or more connectors. Pins provide semantic `PinName/Function` and `Expected NetClass`; project nets provide the actual signal name (e.g. `SE01_IN`, `ANALOG_SIGNAL`, `pBrakeF`). Mismatches are ERC/DRC findings.

## Mating
MatingConnection connects connector pairs across sub-harnesses. Library pin mapping is preferred. Empty mate-side net propagates automatically; conflicting populated nets generate ERC. Mating continuity is not a wire/BOM item.

## Twist/cable/shield
Wire remains the electrical conductor. Net-wide TwistRules create segment-local TwistGroups. Multi-core CableInstance composes multiple wires according to CableDefinition, with sheath and optional ShieldInstance. Shield is not a signal wire and can have electrical termination points.

## Libraries
Built-in/User/Project layers. Library definitions have stable ID + revision. Updates are offered as diff; accept upgrades, reject keeps old revision and adds an old-version marker.

Built-in seed baseline: official manufacturer data for relevant BEDIA wire/cable families, complete harness-relevant Amphenol DuraMate AHDP family, and Molex Mizu-P25 housings/terminals. Store real PNs, compatibility relationships and source/revision; never invent unverified orderable combinations.

## Not MVP
3D/FreeCAD routing, real lengths, resistance/weight, physical branch/bundle routing, full manufacturing drawings, 1:1 nailboard, BOM/cutlist outputs and manufacturing DRC.
