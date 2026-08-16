# Architecture

## Layers
```text
React UI
├─ editor (Tabulator spike)
├─ viewer (React Flow)
└─ application hooks/adapters
        ↓ commands/events
Domain Core (plain TypeScript)
├─ model
├─ inheritance
├─ commands
├─ resolver/reconciliation
├─ transactions
├─ persistence
└─ later DRC/library resolvers
        ↓
JSON project persistence
        ↓
Tauri shell / native file integration
```

## Dependency rule
Domain core imports no React, Tabulator, React Flow or Tauri APIs. UI consumes domain APIs and renders derived state. Viewer layout is stored separately from electrical state.

## Resolver pipeline target
```text
User transaction
→ mating propagation
→ net topology resolution
→ splice topology resolution
→ desired wires
→ wire/splice reconciliation
→ twist/cable/contact resolution
→ ERC/DRC
→ viewer render
```
M0.1 implements the minimal 2-pin wire part of this pipeline.

## Transactions
All domain edits go through the transaction layer. One paste/bulk action is one transaction. History cap: 30. Widget-native histories are not authoritative.

## Persistence
JSON project folder initially; schema-versioned and git/diff-friendly. SQLite is deliberately deferred.

## UI spike decision gate
Before committing deeply to Tabulator, verify connector blocks, 20+ pins, multi-cell paste, color dropdown, inheritance markers and splice child rows. If the component fights the connector-centric UX, change the grid early while keeping the domain core unchanged.
