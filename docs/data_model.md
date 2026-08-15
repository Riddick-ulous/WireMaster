# Core Data Model

## Identity
All persistent objects use immutable UUIDs. Display IDs (`C1`, `W17`, `S3`) are user/document identifiers and may change without breaking references. Wire display IDs are project-wide unique.

## Aggregate structure
```text
Project
├─ NetClass[]
├─ WireClass[]
├─ Net[]
├─ DeviceInstance[]
├─ MatingConnection[]
├─ DrcSuppression[]
└─ SubHarness[]
   ├─ ConnectorInstance[]
   │  └─ PinInstance[]
   ├─ SpliceInstance[]
   ├─ WireInstance[]
   ├─ CableInstance[]
   └─ ViewerLayout
```

Libraries are separate definitions: DeviceDefinition, ConnectorDefinition, ContactDefinition, WireFamilyDefinition and CableDefinition.

## Inherited property
```ts
type PropertyValue<T> =
  | { mode: 'inherit' }
  | { mode: 'explicit'; value: T | null };
```
Resolution is per field, not per object.

## Core relations
- `PinInstance.netId -> Net.id | null`
- `Net.netClassId -> NetClass.id | null`
- `NetClass.defaultWireClassId -> WireClass.id | null`
- `WireInstance.netId -> Net.id`
- `WireInstance.endpointA/B -> PinInstance | SpliceInstance`
- `WireInstance.subHarnessId -> SubHarness.id`
- `SpliceInstance.netId -> Net.id`
- connector-near splice additionally references owner connector + anchor pin

## Wire reconciliation state
`ACTIVE | BROKEN | DANGLING | ORPHANED | NEEDS_REVIEW`.

## Connectivity review state
`UNRESOLVED | RESOLVED | CONFIRMED`.

## Project schema
Every serialized project has `schemaVersion`. Any breaking future change requires an explicit migration.
