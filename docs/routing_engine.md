# Electrical Viewer Orthogonal Routing Contract

Status: M0.2 routing contract. This document is the source of truth for Electrical Viewer wire-routing behavior.

## 1. Scope

The routing engine is a layout-only subsystem. It must never change electrical topology, wire identity, splice membership, connector identity, or persistence semantics. Its output for an electrically existing wire is either a deterministic routed polyline or explicit `UNROUTED`.

The router receives terminals, measured connector/splice geometry, persistent viewer positions/rotations, deterministic label/annotation keepouts and already reserved wire geometry.

## 2. Hard geometry constraints

A route is invalid if any rule below is violated. No aesthetic or path-length improvement may trade against a hard constraint.

### R1 Orthogonal geometry

Every routing segment is horizontal or vertical. Every internal vertex after simplification is exactly a 90-degree bend.

### R2 Terminal departure

The first segment leaves a pin or splice outward, normal to the selected terminal side. The final segment approaches the target from its selected outward side.

There is no special short-stub exception: a wire may not bend immediately after a connector pin or splice.

### R3 No U-turns

A 180-degree turn at a vertex is forbidden. A legitimate obstacle detour such as `right -> down -> left` is allowed because each individual bend is 90 degrees; global monotonicity is not required.

### R4 No self-intersection

A wire may not cross, touch longitudinally, overlap, or later reuse its own non-adjacent route geometry.

### R5 Minimum straight run

`MIN_BEND_SPACING = 28 px` at viewer scale 1.0.

Every straight run between two bends must be at least 28 px. The first run from a terminal to the first bend and the final run from the last bend to a terminal must also be at least 28 px, or longer when a label/annotation clearance requires it.

### R6 Element keepout

Connector and splice bodies are hard obstacles. The route centerline must remain at least `NODE_CLEARANCE = 14 px` outside their measured rectangles, except for the owning straight terminal run entering/leaving that element.

### R7 Fixed connector-pin wire labels

A visible endpoint label (`W# · gauge · color`) is fixed at its connector pin rather than being placed by the router.

For a normal right-facing pin the label sits directly above the outgoing wire, close to the connector, so label and wire visually form the small corner area at the connector. Equivalent orientation-specific placement is used for left/top/bottom-facing pins.

The label owns a padded hard keepout rectangle with `LABEL_CLEARANCE = 4 px`. Foreign wires may not enter this rectangle. The owning wire remains on its designated straight baseline and may not bend until it has fully cleared the label keepout.

Therefore the first/last straight requirement is:

`max(MIN_BEND_SPACING, distance required to clear the endpoint label)`.

The label never migrates to a later segment to make routing easier. If the required straight exit cannot fit, that is a layout conflict and may make the wire `UNROUTED`.

### R8 Splice labels are keepouts

The visible splice annotation (`S# · nW`) is deterministic annotation geometry and owns a padded hard keepout. Routed wires may not pass through splice text.

The label must be offset from the splice routing baseline; displaying the label may not consume the only usable terminal direction of the splice.

### R9 No longitudinal overlap between wires

Two different wires may never share a collinear segment for positive length.

### R10 Minimum parallel wire spacing

Parallel wire segments whose projected extents overlap must have at least `MIN_WIRE_SPACING = 18 px` centerline distance, except for deliberate common electrical junction geometry inside the fan-in envelope of the same splice.

### R11 Wire crossings

Different wires may cross only as a true 90-degree crossing. T-junction touching, endpoint touching between unrelated wires, collinear touching/overlap, or ambiguous electrical-looking contact is forbidden.

A valid crossing must also be at least `MIN_CROSSING_TO_BEND = 28 px` away from the nearest bend, connector terminal, splice/junction landing port or route endpoint on both crossing wires.

Crossings are permitted only when necessary and remain strongly discouraged by the global objective function.

### R12 No unsafe fallback

If no valid route exists, the routing result is `UNROUTED`. The viewer must not substitute an older local Manhattan path, Bézier path, or any other geometry that violates the contract.

An electrically `ACTIVE` wire may therefore be graphically `UNROUTED` without changing `WireInstance.status`.

### R13 Scalable splice fan-in / fan-out envelope

A splice remains exactly one logical electrical junction regardless of branch count. The viewer must not create additional electrical splice points merely to gain graphical routing capacity.

For a splice with more than four globally routed branches, the router derives a scalable routing envelope with virtual landing ports. The envelope is layout-only derived state and is not persisted.

Initial constants at viewer scale 1.0:

- `SPLICE_PORT_PITCH = 18 px`,
- `SPLICE_FANIN_MIN_LENGTH = 28 px`,
- `SPLICE_FANIN_PADDING = 14 px`.

Normal routing hard constraints apply from every external wire up to its assigned landing port. Each landing port has unit capacity: unrelated external branches may not longitudinally overlap on their approach and must maintain normal spacing.

Inside the fan-in envelope, branches belonging to that same splice may converge in a controlled orthogonal junction fan to the one logical splice point. This internal junction geometry is the only exception to normal wire-wire spacing, longitudinal-overlap and minimum-bend-spacing rules because every coincident segment there represents the same intentional electrical node. It must not be counted as a wire crossing.

The internal convergence exception never applies outside the splice envelope and never permits a wire belonging to another electrical node to enter the envelope.

Free splices distribute landing ports across all four sides. Connector-near splices detect the connector-facing side and expand the landing envelope away from the connector; the connector-facing side is not required as an external landing side. Sufficient spare landing capacity shall be created so a label or local obstacle does not make a reasonable high-branch-count splice unroutable solely because one candidate port is blocked.

The renderer still shows one splice identity (`S#`) and one logical junction point. Virtual landing ports are not domain objects, are not editable splice members and are regenerated deterministically.

## 3. Global objective order

Routing is optimized lexicographically. A lower-priority objective may never improve by worsening a higher-priority objective.

1. minimize number of `UNROUTED` wires,
2. minimize wire crossings,
3. minimize route churn relative to a still-valid previous route,
4. minimize number of bends,
5. minimize total Manhattan length,
6. prefer the natural main direction implied by terminal sides,
7. prefer clean parallel/bundled corridors while respecting spacing.

The result must be deterministic for identical input geometry. Wire display ID is only a final tie-breaker and must not give low-numbered wires permanent routing priority.

## 4. Rendering contract

The router returns the complete explicit polyline. The renderer does not reconstruct a different route from `axis/lane` hints.

For a high-degree splice, the returned render polyline includes the controlled internal convergence from the selected virtual landing port to the physical/logical splice point. The router reserves and collision-checks the external portion; the internal fan-in portion is governed by R13.

### 4.1 90-degree mode

Draw the routed polyline exactly.

### 4.2 Smooth mode

Use the same routed polyline and only round its corners visually. Smooth mode must not run an independent Bézier routing engine.

### 4.3 Dragging and preview

During continuous connector/splice dragging or splice preview, a simplified temporary ghost route is allowed for responsiveness. On drop/commit, the full router runs and all hard constraints apply.

## 5. UNROUTED behavior

If a wire cannot be routed without violating a hard constraint:

- do not draw a connected route between its endpoints,
- show a visible routing warning at the top of the Electrical Viewer/editor area,
- identify the affected wire IDs,
- leave electrical/domain connectivity unchanged,
- require the user to resolve the layout conflict, normally by moving connectors or splices farther apart and creating routing space.

The router must not invent a visually ugly or geometrically invalid exception merely to keep the line connected.

## 6. Planner architecture

The V2 planner operates on explicit orthogonal candidate polylines rather than the legacy single `axis/lane` representation.

The planner shall:

1. measure connector/splice rectangles,
2. construct deterministic endpoint-label and splice-label keepouts,
3. derive mandatory terminal straight distances,
4. derive scalable splice fan-in envelopes and virtual landing ports for high-degree splices,
5. create useful X/Y corridor candidates from terminals, obstacle boundaries and already reserved wire corridors,
6. reject hard-constraint violations before scoring,
7. retain bounded alternative routes and/or use bounded backtracking/beam search so a locally attractive early wire can be changed when it blocks later wires,
8. optimize globally in the objective order above,
9. append controlled same-junction convergence geometry inside a splice fan-in envelope after external route validation,
10. return a complete explicit polyline or `UNROUTED` for every requested wire.

The candidate/search implementation may evolve toward a fuller Manhattan visibility/grid graph without changing this contract.

## 7. Performance contract

A deterministic automated baseline benchmark is mandatory.

Hard CI/reference baseline:

- 50 connectors,
- 15 pins per connector,
- 750 pin terminals,
- 375 simultaneous two-point wires,
- connector body obstacles and endpoint-label keepouts included,
- cold deterministic full routing,
- zero `UNROUTED` wires in the baseline fixture,
- elapsed routing time `< 1.0 s` on the CI/reference environment.

The test reports route count, unrouted count and elapsed time. A denser splice-heavy fixture with roughly 750 routed segments may be measured separately and promoted to a hard gate once its stable reference budget is known.

Continuous dragging does not need to execute the full stress-case optimizer on every mouse event; simplified ghost routing or throttled updates are allowed.

## 8. Required regression tests

The suite must cover at minimum:

- connector/splice keepouts,
- fixed connector-pin label keepouts,
- splice-label keepouts,
- first bend only after full label clearance,
- no bend closer than 28 px to any normal terminal/landing port,
- no two normal routing bends separated by less than 28 px,
- no 180-degree U-turn,
- no self-intersection/self-overlap,
- no longitudinal overlap between different wires outside a common splice fan-in envelope,
- at least 18 px parallel wire spacing outside a common splice fan-in envelope,
- only true 90-degree crossings,
- at least 28 px crossing-to-bend/terminal distance,
- deterministic output,
- routing stability when a previous valid route still fits,
- connector-near and free-splice fan-out,
- adjacent 3-wire connector-near splices,
- scalable 6-wire splice fan-in,
- scalable 12-wire splice fan-in with one logical junction,
- connector rotations 0/90/180/270 degrees,
- simplified preview followed by contract-valid committed reroute,
- explicit `UNROUTED` with no unsafe rendered fallback,
- top-level warning for one or more `UNROUTED` wires,
- 50 × 15 / 375-wire performance fixture below 1 s.

## 9. Persistence

Connector and free-splice positions are persistent viewer state. Generated route polylines, fan-in envelopes and virtual landing ports are derived state and are regenerated deterministically; they are not persisted in M0.2.

Manual locked waypoints/segments may be added later as explicit persistent routing constraints.

## 10. Non-goals for M0.2

- physical harness length estimation,
- wire bend-radius mechanics,
- automatic twisted-pair topology,
- 3D routing,
- changing electrical connectivity to improve visual routing,
- persistent manual wire waypoints in the first V2 implementation.
