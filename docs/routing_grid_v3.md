# Electrical Viewer Grid Router V3 Contract

Status: router-rework contract on `m0.2-grid-router-rework`. This document refines the M0.2 routing contract without changing electrical/domain semantics. The 2026-08-22 checkpoint uses the tolerant bundle-first router as the candidate main path; the rigid pure-bundle router remains experimental.

## 1. Purpose

V3 replaces the continuous global corridor search between already-resolved terminals / splice landing ports with a deterministic orthogonal grid router.

The existing good M0.2 behavior is retained:
- connector-near splice anchor leads,
- 2G / 4G splice staggering,
- scalable splice fan-in / fan-out envelopes,
- free-splice layout,
- fixed connector-pin wire labels,
- explicit `UNROUTED`,
- one logical splice identity regardless of graphical fan-in capacity.

The router remains layout-only. It never changes pin, wire, net or splice identity/topology.

## 2. Routing grid

`GRID_SIZE = PIN_PITCH = 28 px` at viewer scale 1.0.

Connector and free-splice positions snap to this grid when a drag is committed. During drag, free movement and simplified ghost routing are allowed.

Connector-near splice positions remain derived state and use the existing stagger expressed directly in grid units:
- first radial lane: `2G = 56 px`,
- staggered radial lane: `4G = 112 px`.

A routed wire between terminal breakout / landing points follows grid edges only.

### 2.1 Edge capacity

Capacity is defined per finite grid edge, not per infinite grid line.

- one horizontal grid edge may be occupied by at most one normal wire,
- one vertical grid edge may be occupied by at most one normal wire,
- two disjoint wires may use different finite edges on the same X/Y grid line,
- same-splice convergence inside the owning splice junction envelope is the only normal capacity exception.

Longitudinal overlap therefore becomes impossible by construction outside splice junction geometry.

### 2.2 Grid nodes and crossings

A horizontal and vertical wire may cross at one grid node if both continue straight through that node.

At a normal crossing node:
- no wire may bend,
- no unrelated wire may end,
- no unrelated junction may exist,
- no T connection is implied.

A wire may not reuse one of its own grid edges or non-adjacent grid nodes and may not perform a 180-degree U-turn.

## 3. Continuous overlays and keepouts

Wire labels are intentionally **not** grid objects.

The existing connector-pin label behavior remains:
- label directly above / beside the owning outgoing wire according to connector orientation,
- close to the connector,
- owning wire remains straight until the complete label keepout is cleared,
- label rectangle plus padding is a hard obstacle for foreign wires.

For grid routing, a continuous label rectangle simply blocks every foreign grid node/edge whose geometry intersects that rectangle. The label itself is never snapped to the grid and consumes no routing track merely by existing between tracks.

Connector bodies, splice bodies, splice labels and foreign splice envelopes similarly map to blocked grid nodes/edges.

## 4. Wire bundles are the preferred planning unit

Before path planning, all normal wires are grouped by their unordered pair of physical routing elements.

Examples:
- `C1 <-> C2`,
- `C1 <-> S3`,
- `S2 <-> S8`.

Direction does not split a group. `C1 -> C2` and `C2 -> C1` belong to the same bundle.

Electrical identities remain individual `WireInstance`s; a bundle is derived layout state only. Bundle membership influences planning order and cost, but does not impose a permanent full-route band constraint.

### 4.1 Bundle priority

Bundles are routed in this deterministic order:
1. descending number of wires in the bundle,
2. first endpoint display ID ascending using numeric comparison (`C2` before `C10`),
3. second endpoint display ID ascending using numeric comparison,
4. stable internal ID only as a final tie-break.

Large bundles therefore reserve useful corridors before sparse one- or two-wire connections can fragment them.

### 4.2 Bundle corridor preference

A bundle of `N` wires first attempts a corridor with `N` adjacent unit-capacity tracks where geometry permits.

The candidate main planner conceptually performs:
1. connector / splice endpoint layout,
2. bundle corridor search,
3. assignment of individual wires to tracks inside a successful strip,
4. tolerant individual-wire fallback when the complete strip does not fit.

The corridor is therefore a preference, not an all-or-nothing global requirement. A bundle may locally widen, cross another group through legal 90-degree crossings, and converge again later. Failed corridor members do not reserve unused parallel tracks. The rigid full-route N-track spine remains available only through `gridGlobalBundleRouterV3` as an experiment.

## 5. Connector cavity viewer layout and bundle breakout

Physical cavity identity and viewer row position are separate concepts in V3.

A pin always keeps its real electrical identity, for example `C1 cavity 4`, but the viewer may place that cavity on a different visual row to group related wires into clean physical bundles. Moving a cavity row in the viewer never changes the pin ID, cavity number, net, wire endpoint or editor data.

Example electrical cavities may be displayed as:

```text
2
6   bundle C1<->C2
7
4

    one empty visual slot

1
5   bundle C1<->C3
3
8

    one empty visual slot

9
10  one-wire groups packed together
11
```

The rules are:
1. connected cavities are grouped by their physical endpoint-pair bundle,
2. every multi-wire bundle occupies one contiguous visual block,
3. complete bundle blocks may be moved relative to one another as viewer-only layout state,
4. for left/right-facing connector exits, automatic block order should normally follow the Y position of the remote routing element; for top/bottom exits the equivalent X position is used,
5. geometry-driven block order is independent of bundle routing priority: the global router still plans larger bundles first,
6. when no useful geometry hint exists, deterministic fallback ordering uses group size and numeric remote element ID,
7. the wire order inside a group is deterministic and may be permuted as layout state to reduce breakout crossings,
8. multi-wire groups are separated from neighboring groups by `1G = 28 px` blank visual space by default,
9. one-wire groups are packed together without one blank row per wire,
10. unused cavities remain visible and retain their cavity IDs; they are placed as a compact trailing block unless later user layout rules override this.

This connector-level rearrangement replaces the earlier experimental approach of borrowing another wire's terminal coordinate. A wire always starts at the viewer location of **its own physical cavity**.

The connector body expands as required for inserted visual gap slots. Therefore connector body keepouts and terminal coordinates are derived from the same visual-slot layout before routing begins.

### 5.1 Bundle track order

After connector-level grouping, the bundle may still choose the ordering of its tracks inside the bounded breakout region.

The preferred case is that both connector ends expose the same wire order, allowing a parallel `N`-track corridor with zero internal crossings. If a permutation is still required, it must happen in a bounded breakout / permutation region near the endpoint, not as repeated crossings throughout the main corridor.

This remains layout only:
- cavity numbers never change,
- wire endpoints never change,
- wire IDs never change,
- electrical topology never changes,
- editor ordering never changes merely because the viewer chooses another cavity row or track order.

## 6. Splices

Existing M0.2 splice semantics are retained.

A splice remains one logical junction. Its fan-in/fan-out envelope exposes virtual landing ports on grid-aligned tracks. Normal edge-capacity rules apply from every external wire to its landing port.

Inside the owning junction envelope, wires belonging to that same splice may merge according to the existing controlled convergence exception. Merely sharing a net never enables this exception.

Connector-near 3W paired fan-out and higher-degree scalable envelopes remain derived geometry and are converted to grid-aligned landing ports before global bundle routing.

## 7. Search and repair

The base search state is `(gridX, gridY, direction)` so continuing straight, bending 90 degrees and an illegal 180-degree reversal are explicit transitions.

A* (or an equivalent deterministic shortest-path search) may be used for one bundle corridor.

Routing is two-phase during the initial pass:
1. every multi-wire bundle receives a corridor attempt in bundle-priority order,
2. unresolved members are routed individually against the shared global reservation after the corridor attempts.

The individual fallback is allowed to produce a partially routed bundle when that increases the globally routed wire count. It must remain deterministic and obey every normal edge-capacity, crossing and keepout rule.

If a later bundle is `UNROUTED`, bounded rip-up / reroute may remove a small number of lower-priority bundles and retry. A lower-priority bundle must never permanently displace a higher-priority larger bundle unless the alternative improves the global number of routed wires without violating hard rules.

Terminal portal access is protected globally so an earlier bundle cannot consume the mandatory exit geometry of a later connector cavity.

## 8. Objective order

Hard constraints always dominate aesthetics.

Among valid alternatives, optimize lexicographically:
1. minimize number of `UNROUTED` wires,
2. maximize routed wires belonging to higher-priority / larger bundles,
3. minimize bundle-to-bundle crossings,
4. minimize internal bundle permutation crossings,
5. minimize route churn from an already-valid previous layout,
6. minimize bends,
7. minimize total grid-edge length,
8. prefer compact parallel bundle corridors.

## 9. Rendering

The grid router returns explicit wire polylines after bundle corridor and track assignment.

- `90°` draws those polylines exactly.
- `Smooth` uses the same topology and only rounds corners visually.
- no second Bézier / fallback router may invent another path.

## 10. Failure behavior

If neither a legal bundle corridor nor a legal individual fallback path exists, affected wires are `UNROUTED` graphically. Do not connect them with invalid fallback geometry.

The existing top-level routing warning remains and lists affected wire IDs / bundle information.

## 11. Vehicle subharness benchmark

The router-rework branch contains one deterministic representative vehicle-subharness fixture used for both visual acceptance and performance tests.

Target fixture:
- exactly 30 connectors,
- each connector has 4–30 cavities,
- vehicle-like spatial layout rather than isolated test pairs,
- connection bundles spanning 1 wire through large multi-wire groups,
- both nearby and long vehicle-spanning bundles,
- enough crossing pressure to exercise connector cavity grouping and track permutation,
- splice-capable geometry retained for later splice-heavy variants.

Metrics reported at minimum:
- connector count,
- total pins,
- used pins,
- wire count,
- bundle count,
- largest bundle size,
- routed / `UNROUTED` count,
- routing time,
- total bends,
- total grid-edge length,
- crossing count if available,
- deterministic result hash/signature.

The existing 50 × 15 / 375-wire synthetic benchmark remains useful as a raw throughput test; the vehicle fixture is the more representative routability / bundle-planning acceptance case.

Current deterministic 40-splice checkpoint:

- tolerant router + bundle-aware contiguous splice egresses: `175/180` (candidate main path),
- promotion gate for any connector-fanout composition: at least `160/180`,
- tolerant router + connector fanout + bundle-aware splice egresses: `149/180` (rejected as main path),
- pure-bundle router + connector fanout: `120/180` (retained experiment),
- transformed endpoint-pair groups routable in isolation: `73/73`.

The tolerant candidate is the active Electrical Viewer route planner. The
viewer derives bundle-grouped connector slots locally, keeps physical pin IDs
as handle identities, and exposes the 30-connector / 180-wire perimeter harness
as `Router Demo (30C)` for manual regression testing. The visible demo routes
`176/180`, places all connectors on the perimeter, keeps four free grids between
neighbouring body keepouts, and reserves eight grids in both axes at corners.
