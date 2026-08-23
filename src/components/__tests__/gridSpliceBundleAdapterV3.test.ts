import { describe, expect, it } from 'vitest';
import {
  expandGridSplicesBundleV3,
  finalizeGridSpliceBundleRoutesV3,
} from '../gridSpliceBundleAdapterV3';
import {
  expandGridConnectorFanoutV3,
  finalizeGridConnectorFanoutRoutesV3,
} from '../gridConnectorFanoutV3';
import type {
  OrthogonalRouteResult,
  RouteRequest,
  RouteTerminal,
} from '../routingGeometry';

function spliceTerminal(): RouteTerminal {
  return {
    nodeId: 'S1',
    junctionPlacement: 'CONNECTOR',
    connectorFacingSide: 'left',
    options: [
      { key: 'S1-left', side: 'left', point: { x: 94, y: 56 } },
      { key: 'S1-right', side: 'right', point: { x: 106, y: 56 } },
      { key: 'S1-top', side: 'top', point: { x: 100, y: 50 } },
      { key: 'S1-bottom', side: 'bottom', point: { x: 100, y: 62 } },
    ],
  };
}

describe('bundle-aware splice finalization', () => {
  it('keeps virtual splice and connector egress order independent of swapped UUIDs', () => {
    const makeRequests = (ids: [string, string]): RouteRequest[] => ['W1', 'W2'].map((displayId, index) => ({
      id: ids[index],
      displayId,
      source: {
        nodeId: 'C1',
        options: [{ key: `${displayId}-source`, side: 'right', point: { x: 0, y: 56 } }],
      },
      target: spliceTerminal(),
    }));
    const signature = (ids: [string, string]) => {
      const requests = makeRequests(ids);
      const splice = expandGridSplicesBundleV3(
        requests,
        [],
        { originX: 0, originY: 0, gridSize: 28 },
        { C1: 'C1', S1: 'S1' },
      );
      const fanout = expandGridConnectorFanoutV3(
        requests.map((request) => ({ ...request, target: { nodeId: 'C2', options: [{ key: `${request.displayId}-target`, side: 'left', point: { x: 400, y: 56 } }] } })),
        [],
        { originX: 0, originY: 0, gridSize: 28 },
        new Set(['C1']),
        { C1: 'C1', C2: 'C2' },
      );
      return Object.fromEntries(requests.map((request) => {
        const spliceRequest = splice.requests.find((candidate) => candidate.displayId === request.displayId)!;
        const fanoutRequest = fanout.requests.find((candidate) => candidate.displayId === request.displayId)!;
        return [request.displayId!, {
          splice: spliceRequest.target.options[0].point,
          fanout: fanoutRequest.source.options[0].point,
        }];
      }));
    };
    const ids: [string, string] = ['ffffffff-ffff-4fff-8fff-ffffffffffff', '00000000-0000-4000-8000-000000000000'];
    expect(signature(ids)).toEqual(signature([ids[1], ids[0]]));
  });

  it('reconnects a permuted bundle track through the virtual splice slot selected by the router', () => {
    const requests: RouteRequest[] = ['W1', 'W2'].map((id, index) => ({
      id,
      source: {
        nodeId: 'C1',
        options: [{ key: `${id}-source`, side: 'right', point: { x: 0, y: 28 + index * 28 } }],
      },
      target: spliceTerminal(),
    }));
    const expansion = expandGridSplicesBundleV3(
      requests,
      [],
      { originX: 0, originY: 0, gridSize: 28 },
      { C1: 'C1', S1: 'S1' },
    );
    const geometry = expansion.geometries.get('S1')!;
    const assigned = geometry.ports.find((port) => port.requestId === 'W1')!;
    const selected = geometry.ports.find((port) => port.requestId === 'W2')!;
    expect(selected.option.point).not.toEqual(assigned.option.point);

    const approach = { x: selected.option.point.x + 56, y: selected.option.point.y };
    const raw: OrthogonalRouteResult = {
      status: 'ROUTED',
      sourceHandleId: 'W1-source',
      targetHandleId: selected.option.key,
      sourceSide: 'right',
      targetSide: 'right',
      points: [requests[0].source.options[0].point, approach, selected.option.point],
      crossings: 0,
      bends: 0,
      length: 0,
    };

    const result = finalizeGridSpliceBundleRoutesV3(
      new Map([['W1', raw]]),
      expansion.geometries,
    ).get('W1');
    expect(result?.status).toBe('ROUTED');
    if (result?.status !== 'ROUTED') return;

    expect(result.targetHandleId).toBe('S1-right');
    expect(result.points.at(-1)).toEqual(selected.physical.point);
    // simplifyRoute may remove the virtual point itself when the approach is
    // collinear, but the selected slot's transverse junction bend must remain.
    expect(result.points).toContainEqual(selected.internalPath.at(-2));
    for (let index = 1; index < result.points.length; index += 1) {
      const previous = result.points[index - 1];
      const point = result.points[index];
      expect(point.x === previous.x || point.y === previous.y, `segment ${index - 1}->${index}`).toBe(true);
    }

    const invalidHandleResult = finalizeGridSpliceBundleRoutesV3(
      new Map([['W1', { ...raw, targetHandleId: 'unknown-virtual-slot' }]]),
      expansion.geometries,
    ).get('W1');
    expect(invalidHandleResult).toEqual({ status: 'UNROUTED', reason: 'NO_VALID_PATH' });
  });

  it('applies the same selected-slot hand-off to experimental connector fanouts', () => {
    const requests: RouteRequest[] = ['W1', 'W2'].map((id, index) => ({
      id,
      source: {
        nodeId: 'C1',
        options: [{ key: `${id}-source`, side: 'right', point: { x: 0, y: 28 + index * 28 } }],
      },
      target: {
        nodeId: 'C2',
        options: [{ key: `${id}-target`, side: 'left', point: { x: 400, y: 28 + index * 28 } }],
      },
    }));
    const expansion = expandGridConnectorFanoutV3(
      requests,
      [],
      { originX: 0, originY: 0, gridSize: 28 },
      new Set(['C1']),
      { C1: 'C1', C2: 'C2' },
    );
    const geometry = expansion.geometries.get('C1')!;
    const assigned = geometry.ports.find((port) => port.requestId === 'W1')!;
    const selected = geometry.ports.find((port) => port.requestId === 'W2')!;
    expect(selected.egress.point).not.toEqual(assigned.egress.point);

    const departed = selected.egress.side === 'top'
      ? { x: selected.egress.point.x, y: selected.egress.point.y - 56 }
      : { x: selected.egress.point.x, y: selected.egress.point.y + 56 };
    const raw: OrthogonalRouteResult = {
      status: 'ROUTED',
      sourceHandleId: selected.egress.key,
      targetHandleId: 'W1-target',
      sourceSide: selected.egress.side,
      targetSide: 'left',
      points: [selected.egress.point, departed, { x: 400, y: departed.y }],
      crossings: 0,
      bends: 1,
      length: 0,
    };
    const result = finalizeGridConnectorFanoutRoutesV3(
      new Map([['W1', raw]]),
      expansion.geometries,
    ).get('W1');
    expect(result?.status).toBe('ROUTED');
    if (result?.status !== 'ROUTED') return;

    expect(result.sourceHandleId).toBe(selected.physical.key);
    expect(result.points[0]).toEqual(selected.physical.point);
    for (let index = 1; index < result.points.length; index += 1) {
      const previous = result.points[index - 1];
      const point = result.points[index];
      expect(point.x === previous.x || point.y === previous.y, `segment ${index - 1}->${index}`).toBe(true);
    }
  });
});
