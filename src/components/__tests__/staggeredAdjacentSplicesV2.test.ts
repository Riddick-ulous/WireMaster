import { describe, expect, it } from 'vitest';
import { connectorNearSplicePosition } from '../connectorNearSpliceLayout';
import { planOrthogonalRoutesV2 } from '../orthogonalRouterV2';
import { spliceLabelObstacle } from '../routingLabels';
import { expandSpliceFanInRouting } from '../spliceFanIn';
import {
  MIN_BEND_SPACING,
  outward,
  routeCrossesObstacle,
  routeSegments,
  segmentCrossesObstacle,
  type CardinalSide,
  type OrthogonalRouteResult,
  type RouteObstacle,
  type RouteRequest,
  type RouteTerminal,
} from '../routingGeometry';
import type { ConnectorInstance, PinInstance, SpliceInstance } from '../../core/model';

function pin(index: number): PinInstance {
  return { id: `P${index + 1}`, cavity: String(index + 1), pinName: `PIN_${index + 1}`, description: '', expectedNetClassId: null, netId: null, contactOverrideId: null };
}

function connector(): ConnectorInstance {
  return { id: 'C3', displayId: 'C3', label: 'New Connector', description: '', notes: '', libraryDefinitionId: null, pins: [pin(0), pin(1), pin(2), pin(3)] };
}

function splice(id: string, anchorPinId: string): SpliceInstance {
  return { id, displayId: id, netId: id === 'S1' ? 'CAN1_H' : 'CAN1_L', placement: 'CONNECTOR', ownerConnectorId: 'C3', anchorPinId, memberEndpoints: [], status: 'ACTIVE' };
}

function spliceTerminal(id: string, position: { x: number; y: number }): RouteTerminal {
  return {
    nodeId: id,
    options: [
      { key: `s-${id}-left`, side: 'left', point: { x: position.x, y: position.y + 6 } },
      { key: `s-${id}-right`, side: 'right', point: { x: position.x + 12, y: position.y + 6 } },
      { key: `s-${id}-top`, side: 'top', point: { x: position.x + 6, y: position.y } },
      { key: `s-${id}-bottom`, side: 'bottom', point: { x: position.x + 6, y: position.y + 12 } },
    ],
  };
}

function terminal(nodeId: string, key: string, side: CardinalSide, x: number, y: number): RouteTerminal {
  return { nodeId, options: [{ key, side, point: { x, y } }] };
}

function expectTargetSide(results: Map<string, OrthogonalRouteResult>, wireId: string, side: CardinalSide): void {
  const result = results.get(wireId);
  expect(result?.status, `${wireId} should route`).toBe('ROUTED');
  if (!result || result.status !== 'ROUTED') return;
  expect(result.targetSide).toBe(side);
}

describe('staggered adjacent connector-near splices', () => {
  it('routes three external branches per splice while both junctions fan away from each other', () => {
    const c3 = connector();
    const connectorPosition = { x: 300, y: 200 };
    const s1Placement = connectorNearSplicePosition(splice('S1', 'P3'), c3, connectorPosition, 0);
    const s2Placement = connectorNearSplicePosition(splice('S2', 'P4'), c3, connectorPosition, 0);
    const s1 = spliceTerminal('S1', s1Placement.position);
    const s2 = spliceTerminal('S2', s2Placement.position);

    const obstacles: RouteObstacle[] = [
      { id: 'C3-body', nodeId: 'C3', kind: 'node', x: 300, y: 200, width: 180, height: 143 },
      { id: 'S1-body', nodeId: 'S1', kind: 'node', x: s1Placement.position.x, y: s1Placement.position.y, width: 12, height: 12 },
      { id: 'S2-body', nodeId: 'S2', kind: 'node', x: s2Placement.position.x, y: s2Placement.position.y, width: 12, height: 12 },
      spliceLabelObstacle('S1-label', s1Placement.position, 12, 12, s1Placement.labelSide, 'S1 · 4W'),
      spliceLabelObstacle('S2-label', s2Placement.position, 12, 12, s2Placement.labelSide, 'S2 · 4W'),
    ];

    const requests: RouteRequest[] = [
      { id: 'W4', source: terminal('C1', 'C1-p3', 'right', 180, 130), target: s1, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W5', source: terminal('C2', 'C2-p3', 'left', 900, 270), target: s1, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W9', source: terminal('C4', 'C4-p3', 'top', 540, 700), target: s1, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W7', source: terminal('C1', 'C1-p4', 'right', 180, 170), target: s2, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W8', source: terminal('C2', 'C2-p4', 'left', 900, 340), target: s2, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W10', source: terminal('C4', 'C4-p4', 'top', 580, 700), target: s2, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
    ];

    const expanded = expandSpliceFanInRouting(requests, obstacles);
    expect(expanded.geometries.get('S1')?.secondaryBlockedSide).toBe('bottom');
    expect(expanded.geometries.get('S2')?.secondaryBlockedSide).toBe('top');

    for (const request of expanded.requests) {
      const geometry = expanded.geometries.get(request.target.nodeId);
      if (!geometry) continue;
      const port = request.target.options[0];
      const stub = routeSegments([port.point, outward(port.point, port.side, MIN_BEND_SPACING)])[0];
      expect(stub).toBeDefined();
      if (!stub) continue;
      for (const other of expanded.geometries.values()) {
        if (other.nodeId === geometry.nodeId) continue;
        expect(segmentCrossesObstacle(stub, other.envelope), `${request.id} landing stub enters ${other.nodeId} junction`).toBe(false);
      }
    }

    const results = planOrthogonalRoutesV2(requests, obstacles);
    for (const request of requests) {
      const result = results.get(request.id);
      expect(result?.status, `${request.id} should route with staggered connector-near junctions`).toBe('ROUTED');
      if (!result || result.status !== 'ROUTED') continue;
      expect(result.targetSide).not.toBe('left');
      expect(routeCrossesObstacle(result.points, obstacles[0]), `${request.id} crosses C3`).toBe(false);
    }
  });

  it('fans both adjacent 3W splices radially outward in the C1-C3-C2 screenshot layout', () => {
    const c3 = connector();
    const connectorPosition = { x: 300, y: 200 };
    const s1Placement = connectorNearSplicePosition(splice('S1', 'P3'), c3, connectorPosition, 0);
    const s2Placement = connectorNearSplicePosition(splice('S2', 'P4'), c3, connectorPosition, 0);
    const s1 = spliceTerminal('S1', s1Placement.position);
    const s2 = spliceTerminal('S2', s2Placement.position);
    const s1Center = { x: s1Placement.position.x + 6, y: s1Placement.position.y + 6 };
    const s2Center = { x: s2Placement.position.x + 6, y: s2Placement.position.y + 6 };

    const obstacles: RouteObstacle[] = [
      { id: 'C3-body', nodeId: 'C3', kind: 'node', x: 300, y: 200, width: 180, height: 143 },
      { id: 'S1-body', nodeId: 'S1', kind: 'node', x: s1Placement.position.x, y: s1Placement.position.y, width: 12, height: 12 },
      { id: 'S2-body', nodeId: 'S2', kind: 'node', x: s2Placement.position.x, y: s2Placement.position.y, width: 12, height: 12 },
      spliceLabelObstacle('S1-label', s1Placement.position, 12, 12, s1Placement.labelSide, 'S1 · 3W'),
      spliceLabelObstacle('S2-label', s2Placement.position, 12, 12, s2Placement.labelSide, 'S2 · 3W'),
    ];

    const requests: RouteRequest[] = [
      { id: 'W4', source: terminal('C1', 'C1-p3', 'right', 180, 130), target: s1, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W5', source: terminal('C2', 'C2-p3', 'left', 900, 270), target: s1, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W7', source: terminal('C1', 'C1-p4', 'right', 180, 170), target: s2, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W8', source: terminal('C2', 'C2-p4', 'left', 900, 340), target: s2, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
    ];

    const expanded = expandSpliceFanInRouting(requests, obstacles);
    expect(expanded.geometries.size).toBe(2);
    const s1Geometry = expanded.geometries.get('S1');
    const s2Geometry = expanded.geometries.get('S2');
    expect(s1Geometry).toBeDefined();
    expect(s2Geometry).toBeDefined();
    for (const geometry of [s1Geometry, s2Geometry]) {
      expect(geometry?.secondaryBlockedSide).toBeNull();
      expect(geometry?.availableSides).toEqual(['right']);
      expect(geometry?.envelope.width).toBe(MIN_BEND_SPACING);
      expect(geometry?.envelope.height).toBe(MIN_BEND_SPACING);
      expect(geometry?.ports).toHaveLength(2);
    }
    expect((s1Geometry?.envelope.y ?? 0) + (s1Geometry?.envelope.height ?? 0) / 2).toBeLessThan(s1Center.y);
    expect((s2Geometry?.envelope.y ?? 0) + (s2Geometry?.envelope.height ?? 0) / 2).toBeGreaterThan(s2Center.y);

    const expandedTargets = new Map(expanded.requests.map((request) => [request.id, request.target.options]));
    for (const wireId of ['W4', 'W5', 'W7', 'W8']) {
      expect(expandedTargets.get(wireId)).toHaveLength(1);
      expect(expandedTargets.get(wireId)?.[0]?.side).toBe('right');
    }

    for (const request of expanded.requests) {
      const geometry = expanded.geometries.get(request.target.nodeId);
      if (!geometry) continue;
      const port = request.target.options[0];
      const stub = routeSegments([port.point, outward(port.point, port.side, MIN_BEND_SPACING)])[0];
      expect(stub).toBeDefined();
      if (!stub) continue;
      for (const other of expanded.geometries.values()) {
        if (other.nodeId === geometry.nodeId) continue;
        expect(segmentCrossesObstacle(stub, other.envelope), `${request.id} landing stub enters ${other.nodeId} 3W fanout`).toBe(false);
      }
    }

    const results = planOrthogonalRoutesV2(requests, obstacles);
    const compactBottomLimit = s2Center.y + 3 * MIN_BEND_SPACING;
    for (const request of requests) {
      const result = results.get(request.id);
      expect(result?.status, `${request.id} should route`).toBe('ROUTED');
      if (!result || result.status !== 'ROUTED') continue;
      expect(result.targetSide).toBe('right');
      expect(Math.max(...result.points.map((point) => point.y)), `${request.id} makes an unnecessary lower outside loop`).toBeLessThanOrEqual(compactBottomLimit);
    }
  });
});
