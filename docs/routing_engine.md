# Electrical Viewer Orthogonal Routing Contract

Status: M0.2 routing contract. This document is the source of truth for 90-degree wire routing behavior.

## 1. Scope

The routing engine is a layout-only subsystem. It must never change electrical topology, wire identity, splice membership, connector identity, or persistence semantics. Its only output is a visual route for an already-existing wire.

The router receives:

- wire terminals (pin or splice, including allowed departure side/handle),
- connector and splice geometry,
- persistent viewer positions/rotations,
- wire-label keepout rectangles,
- already-reserved wire geometry.

The router returns a deterministic orthogonal polyline or `UNROUTED`.

## 2. Hard constraints

A route is invalid if any of these rules are violated. Hard constraints are never traded against route length or crossing count.

### R1 Orthogonal geometry

Every segment is horizontal or vertical.

### R2 Terminal departure

The first segment leaves the source terminal outward, normal to its connector/splice side. The final segment approaches the target terminal from its outward side. A route may not immediately turn back across its source or target element.

### R3 Bend angle

After straight-line simplification, every internal route vertex is a 90-degree turn. A 180-degree U-turn is forbidden.

A legitimate obstacle detour such as `right -> down -> left` remains allowed: each individual bend is 90 degrees. Global monotonicity is intentionally not required because it would make valid routes around obstacles impossible.

### R4 No self-intersection

A wire may not cross, touch longitudinally, or overlap itself except at adjacent segment endpoints.

### R5 Minimum distance between bends

Two consecutive bends must be separated by at least `MIN_BEND_SPACING = 28 px` at viewer scale 1.0.

The fixed source/target terminal stub is not considered a bend-to-bend run, but it must satisfy its own breakout distance.

### R6 Element keepout

Connector and splice bodies are hard obstacles. The route centerline must remain at least `NODE_CLEARANCE = 14 px` outside the measured element rectangle, except for the owning terminal stub that exits/enters that element.

### R7 Wire-label keepout

Every visible endpoint wire label owns a rectangular keepout zone derived from the rendered label text plus padding. No wire centerline, including the wire owning the label, may enter that rectangle.

The label must be positioned beside the terminal stub so its own wire can satisfy this constraint naturally.

Default label padding: `LABEL_CLEARANCE = 4 px`.

### R8 Wire-to-wire longitudinal overlap

Two different wires may never share a collinear segment for positive length.

### R9 Minimum parallel wire spacing

Parallel wire segments whose projected extents overlap must have at least `MIN_WIRE_SPACING = 18 px` centerline distance, except for deliberately shared electrical junction geometry at the same splice endpoint.

### R10 No invalid fallback

If no valid route exists, the engine returns `UNROUTED`. The viewer must not draw an older/local fallback route that bypasses routing constraints.

## 3. Soft objectives

Only valid routes are scored. In descending priority:

1. minimize crossings with other wires,
2. minimize number of bends,
3. minimize total Manhattan length,
4. prefer the natural main axis implied by terminal sides,
5. prefer stable/bundled corridor placement when this does not violate minimum spacing.

The result must be deterministic for identical geometry.

## 4. Label geometry

Endpoint labels are part of routing geometry, not decoration applied after routing.

For each visible pin-end label the viewer computes a label rectangle from:

- text (`W# · gauge · color`),
- font metrics or a deterministic conservative width estimate,
- endpoint side,
- label offset,
- `LABEL_CLEARANCE`.

These rectangles are supplied to the router before any wire is planned. This prevents later wires from passing through text and makes rerouting stable when labels are shown.

## 5. Planner architecture

The target architecture is a Manhattan visibility/grid router rather than a fixed one-corridor template.

1. Inflate element obstacles by node clearance.
2. Add label keepouts.
3. Create candidate X/Y routing coordinates from terminals, breakout points, obstacle boundaries and reserved wire corridors.
4. Build axis-aligned traversable segments between visible coordinates.
5. Search route states with incoming direction and current run length so 180-degree turns and too-short bend spacing are impossible by construction.
6. Reject self-intersections, wire overlaps and spacing violations as hard constraints.
7. Score only valid routes using the soft objectives.
8. Route all wires deterministically; use bounded alternative ordering/backtracking when an early route blocks later wires.
9. Return explicit `UNROUTED` entries rather than unsafe geometry.

## 6. Rendering contract

The renderer renders the exact polyline returned by the router. It must not independently regenerate a different 90-degree path from `axis/lane` hints.

Smooth routing is a separate visualization mode and does not define the orthogonal-routing contract.

Ghost splice preview uses the same routing engine and the same constraints as committed wires.

## 7. Required regression tests

The routing test suite must cover at minimum:

- no route through connector/splice keepouts,
- no route through any visible wire-label keepout,
- no longitudinal overlap between wires,
- minimum parallel wire spacing,
- no 180-degree U-turn,
- no self-intersection/self-overlap,
- minimum 28 px bend-to-bend run,
- deterministic output for identical geometry,
- connector-near splice fan-out,
- rotated connectors (0/90/180/270 degrees),
- ghost preview using identical routing constraints,
- explicit `UNROUTED` result when no valid route exists.

## 8. Non-goals for M0.2

- physical harness length estimation,
- bend-radius / wire-diameter mechanics,
- automatic twisted-pair bundle topology,
- 3D routing,
- changing electrical connectivity to make visual routing easier.
