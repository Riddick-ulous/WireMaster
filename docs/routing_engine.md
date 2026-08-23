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

Connector and splice bodies are hard obstacles. The normal route centerline clearance is `NODE_CLEARANCE = 14 px` outside their measured rectangles, except for the owning straight terminal run entering/leaving that element.

A connector-near splice that is represented by an active junction envelope uses `CONNECTOR_NEAR_SPLICE_BODY_CLEARANCE = 6 px` around its small physical 12 px marker. This local reduction exists only to keep adjacent staggered junction markers from consuming the transverse approach corridors. The physical marker itself remains a hard obstacle, as do its label and its complete junction envelope. Connector bodies, free splices and connector-near splices without such a junction envelope retain the normal 14 px rule.

### R7 Fixed connector-pin wire labels

A visible endpoint label (`W# · gauge · color`) is fixed at its connector pin rather than being placed by the router.

For a normal right-facing pin the label sits directly above the outgoing wire, close to the connector, so label and wire visually form the small corner area at the connector. Equivalent orientation-specific placement is used for left/top/bottom-facing pins.

The label owns a padded hard keepout rectangle with `LABEL_CLEARANCE = 4 px`. Foreign wires may not enter this rectangle. The owning wire remains on its designated straight baseline and may not bend until it has fully cleared the label keepout.

Therefore the first/last straight requirement is:

`max(MIN_BEND_SPACING, distance required to clear the endpoint label)`.

The label never migrates to a later segment to make routing easier. If the required straight exit cannot fit, that is a layout conflict and may make the wire `UNROUTED`.

### R8 Splice labels are keepouts

The visible splice annotation (`S# · nW`) is deterministic annotation geometry and owns a padded hard keepout. Routed wires may not pass through splice text.

For a connector-near splice, the annotation is placed on the connector-facing/anchor side, in the corridor already reserved for the straight anchor lead. It must not consume an external fan-out side. The visible tag and its routing keepout use `SPLICE_LABEL_GAP = 10 px`; this keeps the annotation close enough to its own splice that a staggered neighbouring splice retains its transverse departure corridor. Free-splice labels follow their normal deterministic placement.

### R9 No longitudinal overlap between wires

Two different wires may never share a collinear segment for positive length outside the controlled internal junction geometry of the same splice.

### R10 Minimum parallel wire spacing

Parallel wire segments whose projected extents overlap must have at least `MIN_WIRE_SPACING = 18 px` centerline distance, except for deliberate common electrical junction geometry inside the fan-in/approach envelope of the same splice.

Being on the same net alone does not enable this exception. Two distinct physical splice instances on the same net remain distinct routing objects and obey normal spacing with respect to one another.

### R11 Wire crossings

Different wires may cross only as a true 90-degree crossing. T-junction touching, endpoint touching between unrelated wires, collinear touching/overlap, or ambiguous electrical-looking contact is forbidden.

A valid crossing must also be at least `MIN_CROSSING_TO_BEND = 28 px` away from the nearest bend, connector terminal, splice/junction landing port or route endpoint on both crossing wires.

Crossings are permitted only when necessary and remain strongly discouraged by the global objective function.

### R12 No unsafe fallback

If no valid route exists, the routing result is `UNROUTED`. The viewer must not substitute an older local Manhattan path, Bézier path, or any other geometry that violates the contract.

An electrically `ACTIVE` wire may therefore be graphically `UNROUTED` without changing `WireInstance.status`.

### R13 Scalable splice fan-in / fan-out and connector-near junction zones

A splice remains exactly one logical electrical junction regardless of branch count. The viewer must not create additional electrical splice points merely to gain graphical routing capacity.

The router may derive a scalable routing envelope with virtual landing ports. The envelope is layout-only derived state and is not persisted.

Initial constants at viewer scale 1.0:

- `SPLICE_PORT_PITCH = 18 px`,
- `SPLICE_FANIN_MIN_LENGTH = 28 px`,
- `SPLICE_FANIN_PADDING = 14 px`,
- `CONNECTOR_SPLICE_BASE_GAP = 56 px`,
- `CONNECTOR_SPLICE_STAGGER = 56 px`,
- `CONNECTOR_NEAR_SPLICE_BODY_CLEARANCE = 6 px`,
- `SPLICE_LABEL_GAP = 10 px`.

Normal routing hard constraints apply from every external wire up to its assigned landing port. Each landing port has unit capacity: unrelated external branches may not longitudinally overlap on their approach and must maintain normal spacing.

Before landing ports are assigned, all required splice junction envelopes are generated. Port assignment then evaluates each mandatory 28 px terminal stub against connector/splice bodies, labels and every **foreign** junction envelope. A landing port whose mandatory outward stub already enters another splice's envelope is treated as blocked and must not be selected while an unblocked assignment exists. The global path planner therefore receives only locally viable junction approaches.

Inside the fan-in/junction envelope, branches belonging to that same splice may converge in a controlled orthogonal junction fan to the one logical splice point. This internal junction geometry is the only exception to normal wire-wire spacing, longitudinal-overlap and minimum-bend-spacing rules because every coincident segment there represents the same intentional electrical node. It must not be counted as a wire crossing.

The internal convergence exception never applies outside the splice envelope, never applies merely because two wires share a net, and never permits a wire belonging to another splice/electrical junction to enter the envelope.

#### Free splices

A free splice uses its four normal sides while branch count is small. Above four globally routed branches, the router creates the scalable envelope and distributes landing ports over all four sides.

#### Connector-near splices

The connector-facing side belongs to the straight anchor lead and is **never** considered external branch capacity, including low-degree splices that do not require a virtual junction envelope. The physical splice symbol is placed farther away from the connector than in the original M0.2 implementation so top/bottom or left/right branch approaches have usable space.

The anchor lead remains straight. Adjacent anchor cavities alternate between two radial routing lanes:

- even anchor-pin index: radial gap `56 px`,
- odd anchor-pin index: radial gap `112 px`.

The two lanes are therefore separated by two 28 px routing grids. A one-grid radial difference is insufficient because neighbouring mandatory 28 px terminal runs can otherwise intersect before either branch is allowed to bend. The staggering is always radial (away from the connector) and rotates with the connector. It never introduces a bend into the anchor lead.

With **one** globally routed external branch, the three non-connector-facing physical sides remain available directly.

With **exactly two** globally routed external branches (normally a 3-wire splice including its straight anchor lead), an isolated connector-near splice may still use a direct low-degree physical-side assignment. When two such 3-wire splices are adjacent on the same connector side, however, **both** receive a compact `28 px` junction envelope on the radial side away from the connector. Each envelope supplies two unit-capacity landing ports on that same outward side, allowing both external branches to fan from the electrically common splice without forcing one branch through an artificial top/bottom detour.

The two adjacent low-degree envelopes are shifted transversely by half a port pitch (`9 px`) **away from one another** before landing ports are generated. Thus an upper junction moves its fan-out lanes upward and the lower junction moves its lanes downward (with the equivalent rotation for other connector orientations). The shift keeps both mandatory 28 px outward stubs clear of the neighbouring splice body/keepout while retaining the logical splice point and straight anchor lead at their original positions. Same-splice convergence between the physical marker and these two landing ports is controlled internal junction geometry under R13.

From **three external branches onward** (typically a 4-wire splice including its anchor), a connector-near junction envelope is generated even though the total branch count is below the free-splice high-degree threshold.

When two connector-near high-degree junction envelopes are adjacent on the same connector side, each junction additionally reserves the transverse side that points toward the neighbouring junction. For example, if S1 is above S2 on the right side of a connector, S1 blocks `bottom` and S2 blocks `top`. Both high-degree junctions therefore fan away from one another instead of competing for the narrow region between them. The remaining external sides receive as many virtual landing ports as required by branch count.

This means a connector-near splice is not limited to three physical 12 px handles. The visible `S#` remains one point, while the nearby routing zone supplies the external landing capacity when required.

The renderer still shows one splice identity (`S#`) and one logical junction point. Virtual landing ports and low-degree radial fan-out zones are not domain objects, are not editable splice members and are regenerated deterministically.

## 3. Global objective order

Routing is optimized lexicographically. A lower-priority objective may never improve by worsening a higher-priority objective.

1. minimize number of `UNROUTED` wires,
2. minimize wire crossings,
3. minimize route churn relative to a still-valid previous route,
4. minimize number of bends,
5. minimize total Manhattan length,
6. prefer the natural main direction implied by terminal sides,
7. prefer clean parallel/bundled corridors while respecting spacing.

The result must be deterministic for identical input geometry. Electrical UUIDs are never tie-breakers. Wire display ID is only a final tie-breaker and must not give low-numbered wires permanent routing priority; requests without a display ID use terminal geometry and stable input order instead.

## 4. Rendering contract

The router returns the complete explicit polyline. The renderer does not reconstruct a different route from `axis/lane` hints.

For a splice using a junction envelope, the returned render polyline includes the controlled internal convergence from the selected virtual landing port to the physical/logical splice point. The router reserves and collision-checks the external portion; the internal fan-in portion is governed by R13.

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
4. derive connector-near radial stagger placement before routing,
5. reserve the connector-facing side for the straight anchor lead and detect adjacent low-degree connector-near splice pairs,
6. derive compact paired 3-wire radial fan-out zones or scalable high-degree fan-in/junction envelopes and their virtual landing ports where R13 requires them,
7. assign external branches to landing ports deterministically **against all bodies, labels and foreign junction envelopes**, rejecting locally blocked mandatory terminal stubs before expensive path search,
8. create useful X/Y corridor candidates from terminals, obstacle boundaries and already reserved wire corridors,
9. reject hard-constraint violations before scoring,
10. retain bounded alternative routes and/or use bounded backtracking/beam search so a locally attractive early wire can be changed when it blocks later wires,
11. optimize globally in the objective order above,
12. append controlled same-junction convergence geometry inside a splice fan-in/fan-out envelope after external route validation,
13. return a complete explicit polyline or `UNROUTED` for every requested wire.

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
- no longitudinal overlap between different wires outside a common splice junction envelope,
- at least 18 px parallel wire spacing outside a common splice junction envelope,
- only true 90-degree crossings,
- at least 28 px crossing-to-bend/terminal distance,
- deterministic output,
- routing stability when a previous valid route still fits,
- connector-near and free-splice fan-out,
- adjacent connector-near splices with two-grid radial lane separation,
- adjacent 3-wire connector-near splices with two outward landing ports each and transverse fan-out separation,
- connector-facing side excluded from low-degree external routing,
- connector-near splice with three external branches plus straight anchor lead,
- adjacent connector-near 4-wire junctions with three external branches each,
- symmetric transverse neighbour-side reservation for high-degree junction envelopes,
- landing-port assignment that rejects mandatory stubs entering a foreign junction envelope,
- scalable 6-wire splice fan-in,
- scalable 12-wire splice fan-in with one logical junction,
- connector rotations 0/90/180/270 degrees,
- simplified preview followed by contract-valid committed reroute,
- explicit `UNROUTED` with no unsafe rendered fallback,
- top-level warning for one or more `UNROUTED` wires,
- 50 × 15 / 375-wire performance fixture below 1 s.

## 9. Persistence

Connector and free-splice positions are persistent viewer state. Generated route polylines, connector-near radial stagger, low-degree radial fan-out zones, fan-in envelopes and virtual landing ports are derived state and are regenerated deterministically; they are not persisted in M0.2.

Manual locked waypoints/segments may be added later as explicit persistent routing constraints.

## 10. Non-goals for M0.2

- physical harness length estimation,
- wire bend-radius mechanics,
- automatic twisted-pair topology,
- 3D routing,
- changing electrical connectivity to improve visual routing,
- persistent manual wire waypoints in the first V2 implementation.
