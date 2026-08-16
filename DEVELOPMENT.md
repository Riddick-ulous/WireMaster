# Development Process

## Repository is the memory
Never reconstruct existing modules from chat history. Before a stage, read the current implementation, tests, project context, requirements and architecture documents.

## Change policy
- After bootstrap, modify the existing repository incrementally; do not regenerate the project.
- Rewrites of existing modules must be explicit and justified.
- Keep domain behaviour out of React components.
- Every stage starts from a clean known commit and ends with tests/build/diff review.

## Stage workflow
1. Read `PROJECT_CONTEXT.md` and relevant code/tests.
2. Run/inspect baseline tests.
3. Define the smallest stage delta.
4. Implement through domain commands/APIs, not UI shortcuts.
5. Add regression tests before or with behavioural changes.
6. Run tests/build and inspect diff.
7. Update `PROJECT_CONTEXT.md` / roadmap when behaviour changes.
8. Commit/tag the known-good checkpoint.

## Regression invariants
Tests must protect at least:
- stable internal identity
- field-wise inheritance
- auto-wire creation
- non-destructive wire/splice reconciliation
- save/load round trip
- mating propagation (once implemented)
- transaction undo/redo

## Undo/redo
Domain transactions are the system history. Grid/widget histories must not become authoritative. One paste/bulk edit = one transaction. Keep at most 30 undo and 30 redo states.

## Schema evolution
Every project JSON contains `schemaVersion`. Future model changes require explicit migrations; never silently reinterpret old project data.

## Branching
Feature/milestone branches are preferred. `main` should remain a known-good checkpoint.
