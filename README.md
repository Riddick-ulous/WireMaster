# WireMaster

WireMaster is a desktop-first harness engineering tool. The MVP focuses on logical harness definition: connector-centric editing, project-wide nets, persistent auto-generated wires, non-destructive reconciliation, and a live electrical viewer.

## Current milestone

`M0.1 bootstrap` – vertical slice from connector/pin editing through net resolution to persistent wires, viewer rendering, JSON persistence, and transaction-based undo/redo.

## Stack

- Tauri 2 shell
- React + TypeScript
- Tabulator for spreadsheet-style connector pin editing
- React Flow for the electrical viewer
- UI-independent TypeScript domain core
- Vitest for domain tests

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

With the Tauri prerequisites installed:

```bash
npm run tauri dev
```

See `PROJECT_CONTEXT.md`, `DEVELOPMENT.md`, `ROADMAP.md`, and `docs/` before making architectural changes.
