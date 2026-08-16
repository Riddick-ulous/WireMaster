# Electrical Viewer Orthogonal Routing Contract

Status: M0.2 routing contract. This document is the source of truth for 90-degree wire routing behavior.

## 1. Scope

The routing engine is a layout-only subsystem. It must never change electrical topology, wire identity, splice membership, connector identity, or persistence semantics. Its only output is a visual route for an already-existing wire.

The router receives:

- wire terminals (pin or splice, including allowed departure side/handle),
- connector and splice geometry,
- persistent viewer positions/rotations,
- fixed endpoint-label keepout rectangles,
- already-reserved wire geometry.

The router returns a deterministic orthogonal polyline or `UNROUTED`.

## 2. Hard constraints

A route is invalid if any of these rules are violated. Hard constraints are never traded against route length, bend count, or crossing count.

### R1 Orthogonal geometry

Every segment is horizontal or vertical.

### R2 Terminal departure

The first segment leaves the source terminal outward, normal to its connector/splice side. The final segment approaches the target terminal from its outward side.

A wire may not bend immediately after a pin or splice. There is no exception for terminal stubs: the first bend must satisfy the same minimum straight-run requirement as any other bend transition, and it must also clear the endpoint label where a label exists.

### R3 Bend angle

After straight-line simplification, every internal route vertex is exactly a 90-degree turn. A 180-degree U-turn is forbidden.

A legitimate obstacle detour such as `right -> down -> left` remains allowed because each individual bend is 90 degrees. Global monotonicity is intentionally not required.

### R4 No self-intersection

A wire may not cross, touch longitudinally, or overlap itself except at adjacent segment endpoints. A route may not later reuse a previously occupied segment of itself.

### R5 Minimum straight run between bends

Every straight run between two bends must be at least `MIN_BEND_SPACING = 28 px` at viewer scale 1.0.

The first run from a terminal to the first bend and the final run from the last bend to a terminal must also be at least 28 px, unless a larger endpoint-label clearance requirement applies.

### R6 Element keepout

Connector and splice bodies are hard obstacles. The route centerline must remain at least `NODE_CLEARANCE = 14 px` outside the measured element rectangle, except for the straight terminal run entering or leaving its owning endpoint.

### R7 Fixed endpoint-label geometry

A visible pin-end wire label is anchored directly at its connector pin, in the same general location used by the current viewer.

For a connector side where the wire leaves horizontally, the label is placed above the outgoing wire, close to the connector, with the wire and label visually forming the corner area immediately outside the pin.

The wire must remain straight from the connector pin until it has fully passed the label keepout plus the required clearance. Therefore the first bend position is constrained by both:

- `MIN_BEND_SPACING`, and
- the far edge of the endpoint-label keepout.

The label does not float to another segment and is not selected by the router. Its placement is deterministic from the terminal geometry.

The label rectangle is derived from:

- text (`W# · gauge · color`),
- rendered font metrics or a deterministic conservative width estimate,
- endpoint orientation,
- fixed label offset from the pin/wire,
- `LABEL_CLEARANCE = 4 px` padding.

No foreign wire may enter a label keepout. The owning wire may only occupy its designated straight baseline immediately below/alongside the label according to the endpoint orientation; it may not bend into or through the label rectangle.

### R8 Wire-to-wire longitudinal overlap

Two different wires may never share a collinear segment for positive length.

### R9 Minimum parallel wire spacing

Parallel wire segments whose projected extents overlap must have at least `MIN_WIRE_SPACING = 18 px` centerline distance, except for deliberate common electrical junction geometry at the same splice endpoint.

### R10 Wire crossings

Different wires may cross only as a true 90-degree crossing. T-junction touching, collinear touching/overlap, or ambiguous contact between electrically unrelated wires is forbidden.

Crossings are valid but strongly discouraged by the soft objective function.

### R11 No invalid fallback

If no valid route exists, the engine returns `UNROUTED`. The viewer must not draw an older/local fallback route that bypasses routing constraints.

An electrically active wire may therefore be graphically `UNROUTED` without changing its domain-level `WireInstance.status`.

## 3. Soft objectives

Only valid routes are scored. In descending priority:

1. minimize crossings with other wires,
2. minimize route churn relative to an already-valid previous route,
3. minimize number of bends,
4. minimize total Manhattan length,
5. prefer the natural main axis implied by terminal sides,
6. prefer clean parallel/bundled corridor placement when this does not violate minimum spacing.

The result must be deterministic for identical geometry.

Wire display ID is only a deterministic final tie-breaker; it must not give low-numbered wires permanent routing priority.

## 4. Endpoint label contract

Endpoint labels are part of routing geometry, not decoration applied after routing.

For each visible pin-end label the viewer computes one fixed label rectangle before routing. The label remains associated with that connector pin and does not migrate to an arbitrary later segment.

For the normal right-facing connector case the intended relationship is approximately:

```text
connector pin
      ●──────────────────────── wire
       W7 · 0.35 · GREEN
       ^ label sits just above the outgoing wire, close to the connector
```

The exact text baseline/offset is a renderer detail, but the router receives the final padded rectangle and must keep the first run straight until the route has cleared that rectangle.

Equivalent orientation-specific placement is used for left/top/bottom-facing connector pins.

## 5. Planner architecture

The target architecture is a Manhattan visibility/grid router rather than a fixed one-corridor template.

1. Measure connector/splice rectangles.
2. Construct deterministic endpoint-label rectangles.
3. Inflate element obstacles by node clearance.
4. Add label keepouts.
5. Create candidate X/Y routing coordinates from terminals, mandatory first-run clearance points, obstacle boundaries, label boundaries and reserved wire corridors.
6. Build axis-aligned traversable segments between visible coordinates.
7. Search route states with incoming direction and current straight-run length so 180-degree turns and too-short bends are impossible by construction.
8. Reject self-intersections, invalid wire contact, wire overlap and spacing violations as hard constraints.
9. Score only valid routes using the soft objectives.
10. Route all wires globally/deterministically with bounded alternatives/backtracking or beam search so an early locally-good route may be replaced when it blocks later wires.
11. Return explicit polylines and explicit `UNROUTED` entries.

The renderer must never regenerate the route from a smaller `axis/lane` representation.

## 6. Rendering and interaction contract

### 6.1 90-degree view

The renderer draws the exact polyline returned by the router.

### 6.2 Smooth view

Smooth view uses the same routed topology/polyline as the 90-degree view and only rounds the corners visually. It must not run an independent Bézier routing algorithm that can violate keepouts.

### 6.3 Dragging

During connector/splice dragging, a simplified/temporary ghost route is acceptable for responsiveness.

On drag stop, the full routing engine runs and all hard constraints apply.

### 6.4 Splice preview

Ghost splice preview uses the same routing constraints as committed topology. A reduced-cost preview solver is allowed during continuous interaction, but the committed result must be validated/rerouted by the full engine.

## 7. UNROUTED behavior

If a wire cannot be routed without violating a hard constraint:

- the wire is not visually connected across the viewer,
- the editor/viewer shows a visible routing warning at the top,
- the warning identifies the affected wire(s),
- electrical/domain connectivity is not changed,
- the user must resolve the layout conflict, typically by moving connectors/splices farther apart or otherwise creating routing space.

Unsafe fallback geometry is forbidden.

## 8. Performance contract

The router must have an automated stress/performance test.

Reference stress case:

- 50 connectors,
- 15 pins per connector,
- 750 pin terminals total,
- representative multi-wire connectivity and obstacle geometry,
- full deterministic routing from a cold route state.

Target on the CI/reference environment: complete full routing in `< 1.0 s`.

The performance test must report route count, unrouted count and elapsed time so regressions are diagnosable. The benchmark fixture must be deterministic.

Interactive dragging does not have to execute the full 750-terminal optimization on every mouse event; simplified ghost routes or throttled partial updates are allowed.

## 9. Required regression tests

The routing test suite must cover at minimum:

- no route through connector/splice keepouts,
- fixed connector-pin label placement creates a hard keepout,
- first bend occurs only after the complete endpoint label plus clearance,
- no bend closer than 28 px to a terminal,
- no two bends with less than 28 px straight run between them,
- no longitudinal overlap between wires,
- minimum parallel wire spacing,
- only true 90-degree wire crossings,
- no 180-degree U-turn,
- no self-intersection/self-overlap,
- deterministic output for identical geometry,
- routing stability where a previous valid route still fits,
- connector-near splice fan-out,
- free-splice fan-out,
- rotated connectors (0/90/180/270 degrees),
- ghost preview obeying the same hard constraints,
- explicit `UNROUTED` result when no valid route exists,
- top-level routing warning for one or more `UNROUTED` wires,
- stress/performance fixture with 50 connectors x 15 pins finishing in <1 s on the reference environment.

## 10. Persistence

Connector and free-splice positions are persistent domain/viewer state.

Generated route polylines are derived layout state and are not persisted for M0.2. They are regenerated deterministically from the persisted layout.

Manual locked waypoints/segments may be added later as explicit persistent routing constraints.

## 11. Non-goals for M0.2

- physical harness length estimation,
- bend-radius / wire-diameter mechanics,
- automatic twisted-pair bundle topology,
- 3D routing,
- changing electrical connectivity to make visual routing easier,
- persistent manual wire waypoints in the first V2 router implementation.
