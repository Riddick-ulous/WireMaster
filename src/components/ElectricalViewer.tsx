import { useEffect, useMemo } from 'react';
import {
  Background,
  BaseEdge,
  ConnectionMode,
  Controls,
  Handle,
  Position,
  ReactFlow,
  getBezierPath,
  useNodesState,
  useUpdateNodeInternals,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type {
  ConnectorInstance,
  Project,
  SpliceInstance,
  UUID,
  ViewerRotation,
  WireEndpoint,
  WireInstance,
} from '../core/model';
import type { SplicePreview } from './SpliceDialog';
import {
  planOrthogonalRoutes,
  type CardinalSide,
  type OrthogonalRoutePlan,
  type RouteObstacle,
  type RouteRequest,
  type RouteTerminal,
  type RouteTerminalOption,
} from './orthogonalRouter';

interface ConnectorNodeData extends Record<string, unknown> {
  connector: ConnectorInstance;
  rotation: ViewerRotation;
  onRotate: (connectorId: UUID) => void;
}

interface SpliceNodeData extends Record<string, unknown> {
  splice: SpliceInstance;
  netName: string;
  labelSide: 'left' | 'right' | 'top' | 'bottom';
  wireCount: number;
  summary: string;
  preview?: boolean;
}

type ConnectorNode = Node<ConnectorNodeData, 'connector'>;
type SpliceNode = Node<SpliceNodeData, 'splice'>;
type FlowNode = ConnectorNode | SpliceNode;
type ActiveWire = WireInstance & { status: 'ACTIVE' };
export type WireRenderStyle = 'smooth' | 'orthogonal';

const PIN_PITCH_PX = 28;
const CONNECTOR_WIDTH_PX = 180;
const CONNECTOR_TITLE_PX = 31;
const HORIZONTAL_PIN_WIDTH_PX = 32;
const HORIZONTAL_PIN_HEIGHT_PX = 92;
const BREAKOUT_BASE_PX = 34;
const BREAKOUT_STEP_PX = 22;
const SPLICE_SIZE_PX = 12;
const SPLICE_BREAKOUT_PX = 24;
const CONNECTOR_SPLICE_GAP_PX = 22;
const PREVIEW_SPLICE_ID = '__wiremaster_splice_preview__';

type EdgeEnd = 'source' | 'target';

function isActiveWire(wire: WireInstance): wire is ActiveWire {
  return wire.status === 'ACTIVE';
}

function handlePositionForRotation(rotation: ViewerRotation): Position {
  if (rotation === 90) return Position.Bottom;
  if (rotation === 180) return Position.Left;
  if (rotation === 270) return Position.Top;
  return Position.Right;
}

function positionForSide(side: CardinalSide): Position {
  if (side === 'left') return Position.Left;
  if (side === 'right') return Position.Right;
  if (side === 'top') return Position.Top;
  return Position.Bottom;
}

function ConnectorNodeView({ id, data }: NodeProps<ConnectorNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const handlePosition = handlePositionForRotation(data.rotation);
  const horizontal = data.rotation === 90 || data.rotation === 270;
  const titleAtBottom = data.rotation === 270;

  useEffect(() => {
    const frame = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(frame);
  }, [data.rotation, id, updateNodeInternals]);

  const title = (
    <div className={`viewer-connector-title ${titleAtBottom ? 'bottom' : 'top'}`}>
      <span>{data.connector.displayId} · {data.connector.label}</span>
      <button
        type="button"
        className="viewer-rotate nodrag nopan"
        title="Rotate connector 90°"
        aria-label={`Rotate ${data.connector.displayId} 90 degrees`}
        onClick={(event) => {
          event.stopPropagation();
          data.onRotate(data.connector.id);
        }}
      >↻</button>
    </div>
  );

  return (
    <div className={`viewer-connector rotation-${data.rotation} ${horizontal ? 'horizontal' : 'vertical'}`}>
      {!titleAtBottom && title}
      <div className="viewer-pins">
        {data.connector.pins.map((pin) => (
          <div className="viewer-pin" key={pin.id}>
            <Handle id={`p-${pin.id}`} type="source" position={handlePosition} className="pin-handle" />
            <span className="cavity">{pin.cavity}</span>
            <span className="pin-name">{pin.pinName || '—'}</span>
          </div>
        ))}
      </div>
      {titleAtBottom && title}
    </div>
  );
}

function SpliceNodeView({ id, data }: NodeProps<SpliceNode>) {
  return (
    <div
      className={`viewer-splice ${data.splice.placement.toLowerCase()} status-${data.splice.status.toLowerCase()} label-${data.labelSide} ${data.preview ? 'preview' : ''}`}
      title={data.summary}
    >
      {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
        <Handle key={side} id={`s-${id}-${side}`} type="source" position={positionForSide(side)} className="splice-handle" />
      ))}
      <span className="splice-tag">{data.preview ? 'NEW' : data.splice.displayId}{data.wireCount ? ` · ${data.wireCount}W` : ''}</span>
    </div>
  );
}

function outwardPoint(x: number, y: number, position: Position, distance: number): { x: number; y: number } {
  if (position === Position.Left) return { x: x - distance, y };
  if (position === Position.Right) return { x: x + distance, y };
  if (position === Position.Top) return { x, y: y - distance };
  return { x, y: y + distance };
}

function compactPath(points: Array<{ x: number; y: number }>): string {
  const compact: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    const previous = compact[compact.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.01 && Math.abs(previous.y - point.y) < 0.01) continue;
    compact.push(point);
    while (compact.length >= 3) {
      const a = compact[compact.length - 3];
      const b = compact[compact.length - 2];
      const c = compact[compact.length - 1];
      const sameX = Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01;
      const sameY = Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01;
      const sameDirection = sameX
        ? (b.y - a.y) * (c.y - b.y) >= -0.01
        : sameY
          ? (b.x - a.x) * (c.x - b.x) >= -0.01
          : false;
      if (!sameDirection) break;
      compact.splice(compact.length - 2, 1);
    }
  }
  return compact.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}

function orthogonalPath(
  sourceX: number,
  sourceY: number,
  sourcePosition: Position,
  sourceBreakout: number,
  targetX: number,
  targetY: number,
  targetPosition: Position,
  targetBreakout: number,
  axis: 'x' | 'y' | null,
  lane: number | null,
): string {
  const sourceOut = outwardPoint(sourceX, sourceY, sourcePosition, sourceBreakout);
  const targetOut = outwardPoint(targetX, targetY, targetPosition, targetBreakout);
  if (axis === 'x' && lane !== null) return compactPath([{ x: sourceX, y: sourceY }, sourceOut, { x: lane, y: sourceOut.y }, { x: lane, y: targetOut.y }, targetOut, { x: targetX, y: targetY }]);
  if (axis === 'y' && lane !== null) return compactPath([{ x: sourceX, y: sourceY }, sourceOut, { x: sourceOut.x, y: lane }, { x: targetOut.x, y: lane }, targetOut, { x: targetX, y: targetY }]);

  const sourceHorizontal = sourcePosition === Position.Left || sourcePosition === Position.Right;
  const targetHorizontal = targetPosition === Position.Left || targetPosition === Position.Right;
  if (sourceHorizontal && targetHorizontal) {
    const corridorY = (sourceOut.y + targetOut.y) / 2;
    return compactPath([{ x: sourceX, y: sourceY }, sourceOut, { x: sourceOut.x, y: corridorY }, { x: targetOut.x, y: corridorY }, targetOut, { x: targetX, y: targetY }]);
  }
  if (!sourceHorizontal && !targetHorizontal) {
    const corridorX = (sourceOut.x + targetOut.x) / 2;
    return compactPath([{ x: sourceX, y: sourceY }, sourceOut, { x: corridorX, y: sourceOut.y }, { x: corridorX, y: targetOut.y }, targetOut, { x: targetX, y: targetY }]);
  }
  if (sourceHorizontal) return compactPath([{ x: sourceX, y: sourceY }, sourceOut, { x: targetOut.x, y: sourceOut.y }, targetOut, { x: targetX, y: targetY }]);
  return compactPath([{ x: sourceX, y: sourceY }, sourceOut, { x: sourceOut.x, y: targetOut.y }, targetOut, { x: targetX, y: targetY }]);
}

interface EndLabelPosition { x: number; y: number; anchor: 'start' | 'middle' | 'end'; rotation: number }

function endpointLabelPosition(x: number, y: number, position: Position): EndLabelPosition {
  if (position === Position.Left) return { x: x - 10, y: y - 5, anchor: 'end', rotation: 0 };
  if (position === Position.Right) return { x: x + 10, y: y - 5, anchor: 'start', rotation: 0 };
  if (position === Position.Top) return { x: x - 10, y: y - 10, anchor: 'start', rotation: -90 };
  return { x: x + 10, y: y + 10, anchor: 'start', rotation: 90 };
}

function WireEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data, style, markerStart, markerEnd, interactionWidth }: EdgeProps) {
  const routing = data?.routing === 'orthogonal' ? 'orthogonal' : 'smooth';
  const sourceBreakout = typeof data?.sourceBreakout === 'number' ? data.sourceBreakout : BREAKOUT_BASE_PX;
  const targetBreakout = typeof data?.targetBreakout === 'number' ? data.targetBreakout : BREAKOUT_BASE_PX;
  const routeAxis = data?.routeAxis === 'x' || data?.routeAxis === 'y' ? data.routeAxis : null;
  const routeLane = typeof data?.routeLane === 'number' ? data.routeLane : null;
  const wireInfo = typeof data?.wireInfo === 'string' ? data.wireInfo : '';
  const labelFill = typeof data?.labelFill === 'string' ? data.labelFill : '#aeb8c6';
  const labelOpacity = typeof data?.labelOpacity === 'number' ? data.labelOpacity : 1;
  const sourceLabelVisible = data?.sourceLabelVisible !== false;
  const targetLabelVisible = data?.targetLabelVisible !== false;
  const direct = data?.direct === true;

  let path: string;
  if (direct) path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  else if (routing === 'orthogonal') path = orthogonalPath(sourceX, sourceY, sourcePosition, sourceBreakout, targetX, targetY, targetPosition, targetBreakout, routeAxis, routeLane);
  else [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const sourceLabel = endpointLabelPosition(sourceX, sourceY, sourcePosition);
  const targetLabel = endpointLabelPosition(targetX, targetY, targetPosition);
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={interactionWidth} />
      {wireInfo && (sourceLabelVisible || targetLabelVisible) && (
        <g className="wire-end-labels" opacity={labelOpacity} pointerEvents="none">
          {sourceLabelVisible && <text x={sourceLabel.x} y={sourceLabel.y} textAnchor={sourceLabel.anchor} transform={sourceLabel.rotation ? `rotate(${sourceLabel.rotation} ${sourceLabel.x} ${sourceLabel.y})` : undefined} fill={labelFill} className="wire-end-label">{wireInfo}</text>}
          {targetLabelVisible && <text x={targetLabel.x} y={targetLabel.y} textAnchor={targetLabel.anchor} transform={targetLabel.rotation ? `rotate(${targetLabel.rotation} ${targetLabel.x} ${targetLabel.y})` : undefined} fill={labelFill} className="wire-end-label">{wireInfo}</text>}
        </g>
      )}
    </>
  );
}

const nodeTypes = { connector: ConnectorNodeView, splice: SpliceNodeView };
const edgeTypes = { 'wire-edge': WireEdge };
const colorMap: Record<string, string> = {
  VIOLET: '#a970ff', RED: '#ff5b67', GREEN: '#4adf8f', WHITE: '#f4f6fa', BLACK: '#353a46', BLUE: '#52a8ff', YELLOW: '#ffd65c', ORANGE: '#ff9f4a', BROWN: '#a8734a', GREY: '#9aa3b2',
};

function endpointKeyLocal(endpoint: WireEndpoint): string {
  return endpoint.kind === 'pin' ? `pin:${endpoint.connectorId}:${endpoint.pinId}` : `splice:${endpoint.spliceId}`;
}
function nodeIdForEndpoint(endpoint: WireEndpoint): UUID { return endpoint.kind === 'pin' ? endpoint.connectorId : endpoint.spliceId }
function breakoutKey(wireId: UUID, end: EdgeEnd): string { return `${wireId}:${end}` }

function connectorNearAnchorLead(wire: ActiveWire, splices: Map<UUID, SpliceInstance>): boolean {
  const spliceEndpoint = wire.endpointA.kind === 'splice' ? wire.endpointA : wire.endpointB.kind === 'splice' ? wire.endpointB : null;
  const pinEndpoint = wire.endpointA.kind === 'pin' ? wire.endpointA : wire.endpointB.kind === 'pin' ? wire.endpointB : null;
  if (!spliceEndpoint || !pinEndpoint) return false;
  const splice = splices.get(spliceEndpoint.spliceId);
  return splice?.placement === 'CONNECTOR' && splice.anchorPinId === pinEndpoint.pinId && splice.ownerConnectorId === pinEndpoint.connectorId;
}

function connectorBreakouts(wires: ActiveWire[], connectors: ConnectorInstance[]): Map<string, number> {
  const entriesByConnector = new Map<UUID, Array<{ wire: ActiveWire; end: EdgeEnd; pinIndex: number }>>();
  const connectorById = new Map(connectors.map((connector) => [connector.id, connector]));
  for (const wire of wires) {
    for (const item of [{ endpoint: wire.endpointA, end: 'source' as const }, { endpoint: wire.endpointB, end: 'target' as const }]) {
      if (item.endpoint.kind !== 'pin') continue;
      const connector = connectorById.get(item.endpoint.connectorId);
      if (!connector) continue;
      const pinIndex = Math.max(0, connector.pins.findIndex((pin) => pin.id === item.endpoint.pinId));
      const entries = entriesByConnector.get(connector.id) ?? [];
      entries.push({ wire, end: item.end, pinIndex });
      entriesByConnector.set(connector.id, entries);
    }
  }
  const result = new Map<string, number>();
  for (const entries of entriesByConnector.values()) {
    entries.sort((a, b) => a.pinIndex - b.pinIndex || a.wire.displayId.localeCompare(b.wire.displayId, undefined, { numeric: true }));
    entries.forEach((entry, index) => result.set(breakoutKey(entry.wire.id, entry.end), BREAKOUT_BASE_PX + index * BREAKOUT_STEP_PX));
  }
  return result;
}

function connectorNearSplicePosition(splice: SpliceInstance, connector: ConnectorInstance | undefined, connectorPosition: { x: number; y: number }, rotation: ViewerRotation) {
  const pinIndex = Math.max(0, connector?.pins.findIndex((pin) => pin.id === splice.anchorPinId) ?? 0);
  const pinCenterY = connectorPosition.y + CONNECTOR_TITLE_PX + pinIndex * PIN_PITCH_PX + PIN_PITCH_PX / 2;
  const pinCenterX = connectorPosition.x + pinIndex * HORIZONTAL_PIN_WIDTH_PX + HORIZONTAL_PIN_WIDTH_PX / 2;
  if (rotation === 180) return { position: { x: connectorPosition.x - CONNECTOR_SPLICE_GAP_PX - SPLICE_SIZE_PX, y: pinCenterY - SPLICE_SIZE_PX / 2 }, labelSide: 'left' as const };
  if (rotation === 90) return { position: { x: pinCenterX - SPLICE_SIZE_PX / 2, y: connectorPosition.y + CONNECTOR_TITLE_PX + HORIZONTAL_PIN_HEIGHT_PX + CONNECTOR_SPLICE_GAP_PX }, labelSide: 'bottom' as const };
  if (rotation === 270) return { position: { x: pinCenterX - SPLICE_SIZE_PX / 2, y: connectorPosition.y - CONNECTOR_SPLICE_GAP_PX - SPLICE_SIZE_PX }, labelSide: 'top' as const };
  return { position: { x: connectorPosition.x + CONNECTOR_WIDTH_PX + CONNECTOR_SPLICE_GAP_PX, y: pinCenterY - SPLICE_SIZE_PX / 2 }, labelSide: 'right' as const };
}

function defaultFreeSplicePosition(splice: SpliceInstance, connectors: ConnectorInstance[], connectorPositions: Record<UUID, { x: number; y: number }>, index: number) {
  const points = splice.memberEndpoints.flatMap((endpoint) => {
    if (endpoint.kind !== 'pin') return [];
    const connector = connectors.find((item) => item.id === endpoint.connectorId);
    const position = connector ? connectorPositions[connector.id] : undefined;
    return position ? [{ x: position.x + 90, y: position.y + 70 }] : [];
  });
  if (!points.length) return { x: 360 + index * 40, y: 260 + index * 30 };
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
}

function endpointDescription(endpoint: WireEndpoint, connectors: ConnectorInstance[], splices: SpliceInstance[]): string {
  if (endpoint.kind === 'splice') return splices.find((item) => item.id === endpoint.spliceId)?.displayId ?? 'Unknown splice';
  const connector = connectors.find((item) => item.id === endpoint.connectorId);
  const pin = connector?.pins.find((item) => item.id === endpoint.pinId);
  return `${connector?.displayId ?? '?'} · ${connector?.label ?? 'Unknown connector'} · cavity ${pin?.cavity ?? '?'}${pin?.pinName ? ` · ${pin.pinName}` : ''}`;
}

function measuredSize(node: FlowNode): { width: number; height: number } {
  if (node.type === 'splice') return { width: node.measured?.width ?? SPLICE_SIZE_PX, height: node.measured?.height ?? SPLICE_SIZE_PX };
  const horizontal = node.data.rotation === 90 || node.data.rotation === 270;
  return {
    width: node.measured?.width ?? (horizontal ? Math.max(CONNECTOR_WIDTH_PX, node.data.connector.pins.length * HORIZONTAL_PIN_WIDTH_PX) : CONNECTOR_WIDTH_PX),
    height: node.measured?.height ?? (horizontal ? CONNECTOR_TITLE_PX + HORIZONTAL_PIN_HEIGHT_PX : CONNECTOR_TITLE_PX + node.data.connector.pins.length * PIN_PITCH_PX),
  };
}

function terminalForEndpoint(endpoint: WireEndpoint, nodes: FlowNode[]): RouteTerminal | null {
  const node = nodes.find((item) => item.id === nodeIdForEndpoint(endpoint));
  if (!node) return null;
  const size = measuredSize(node);
  if (endpoint.kind === 'pin') {
    if (node.type !== 'connector') return null;
    const pinIndex = node.data.connector.pins.findIndex((pin) => pin.id === endpoint.pinId);
    if (pinIndex < 0) return null;
    const rotation = node.data.rotation;
    let side: CardinalSide;
    let point: { x: number; y: number };
    if (rotation === 180) {
      side = 'left'; point = { x: node.position.x, y: node.position.y + CONNECTOR_TITLE_PX + pinIndex * PIN_PITCH_PX + PIN_PITCH_PX / 2 };
    } else if (rotation === 90) {
      side = 'bottom'; point = { x: node.position.x + pinIndex * HORIZONTAL_PIN_WIDTH_PX + HORIZONTAL_PIN_WIDTH_PX / 2, y: node.position.y + size.height };
    } else if (rotation === 270) {
      side = 'top'; point = { x: node.position.x + pinIndex * HORIZONTAL_PIN_WIDTH_PX + HORIZONTAL_PIN_WIDTH_PX / 2, y: node.position.y };
    } else {
      side = 'right'; point = { x: node.position.x + size.width, y: node.position.y + CONNECTOR_TITLE_PX + pinIndex * PIN_PITCH_PX + PIN_PITCH_PX / 2 };
    }
    return { nodeId: node.id, options: [{ key: `p-${endpoint.pinId}`, side, point }] };
  }
  if (node.type !== 'splice') return null;
  const halfW = size.width / 2;
  const halfH = size.height / 2;
  const options: RouteTerminalOption[] = [
    { key: `s-${endpoint.spliceId}-left`, side: 'left', point: { x: node.position.x, y: node.position.y + halfH } },
    { key: `s-${endpoint.spliceId}-right`, side: 'right', point: { x: node.position.x + size.width, y: node.position.y + halfH } },
    { key: `s-${endpoint.spliceId}-top`, side: 'top', point: { x: node.position.x + halfW, y: node.position.y } },
    { key: `s-${endpoint.spliceId}-bottom`, side: 'bottom', point: { x: node.position.x + halfW, y: node.position.y + size.height } },
  ];
  return { nodeId: node.id, options };
}

function nodeObstacle(node: FlowNode): RouteObstacle | null {
  if (node.type === 'splice' && node.data.preview) return null;
  const size = measuredSize(node);
  return { nodeId: node.id, x: node.position.x, y: node.position.y, width: size.width, height: size.height };
}

function nearestSpliceHandle(endpoint: WireEndpoint, other: WireEndpoint, nodes: FlowNode[]): string {
  if (endpoint.kind === 'pin') return `p-${endpoint.pinId}`;
  const node = nodes.find((item) => item.id === endpoint.spliceId);
  const otherNode = nodes.find((item) => item.id === nodeIdForEndpoint(other));
  if (!node || !otherNode) return `s-${endpoint.spliceId}-right`;
  const size = measuredSize(node);
  const otherSize = measuredSize(otherNode);
  const dx = otherNode.position.x + otherSize.width / 2 - (node.position.x + size.width / 2);
  const dy = otherNode.position.y + otherSize.height / 2 - (node.position.y + size.height / 2);
  const side: CardinalSide = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
  return `s-${endpoint.spliceId}-${side}`;
}

function wireContainsEndpoint(wire: ActiveWire, endpoint: WireEndpoint): EdgeEnd | null {
  const key = endpointKeyLocal(endpoint);
  if (endpointKeyLocal(wire.endpointA) === key) return 'source';
  if (endpointKeyLocal(wire.endpointB) === key) return 'target';
  return null;
}

function previewAffectsWire(wire: ActiveWire, preview: SplicePreview | null): boolean {
  if (!preview) return false;
  if (preview.splitWireId === wire.id) return true;
  return Boolean(preview.spliceId && [wire.endpointA, wire.endpointB].some((endpoint) => endpoint.kind === 'splice' && endpoint.spliceId === preview.spliceId));
}

interface PreviewRouteSpec { id: string; endpoint: WireEndpoint; direct: boolean }

interface Props {
  project: Project;
  harnessId: UUID;
  selectedConnectorId: UUID | null;
  highlightedNetId: UUID | null;
  wireRenderStyle: WireRenderStyle;
  splicePreview: SplicePreview | null;
  onSelectConnector: (id: UUID) => void;
  onHighlightNet: (id: UUID | null) => void;
  onEditSplice: (id: UUID) => void;
  onRotateConnector: (id: UUID) => void;
  onLayoutChange: (connectorId: UUID, x: number, y: number) => void;
  onSpliceLayoutChange: (spliceId: UUID, x: number, y: number) => void;
}

export function ElectricalViewer({ project, harnessId, selectedConnectorId, highlightedNetId, wireRenderStyle, splicePreview, onSelectConnector, onHighlightNet, onEditSplice, onRotateConnector, onLayoutChange, onSpliceLayoutChange }: Props) {
  const harness = project.subHarnesses.find((item) => item.id === harnessId)!;
  const wireClasses = project.wireClasses;

  const desiredNodes = useMemo<FlowNode[]>(() => {
    const connectors: ConnectorNode[] = harness.connectors.map((connector, index) => ({
      id: connector.id,
      type: 'connector',
      position: harness.viewerLayout.connectorPositions[connector.id] ?? { x: 80 + index * 380, y: 120 },
      data: { connector, rotation: harness.viewerLayout.connectorRotations[connector.id] ?? 0, onRotate: onRotateConnector },
      selected: connector.id === selectedConnectorId,
    }));
    const connectorById = new Map(harness.connectors.map((connector) => [connector.id, connector]));
    const connectorPositionById = new Map(connectors.map((node) => [node.id, node.position]));
    const resolvedConnectorPositions = Object.fromEntries(connectors.map((node) => [node.id, node.position])) as Record<UUID, { x: number; y: number }>;

    const splices: SpliceNode[] = harness.splices.filter((splice) => splice.status !== 'ORPHANED').map((splice, index) => {
      let position = harness.viewerLayout.splicePositions[splice.id] ?? defaultFreeSplicePosition(splice, harness.connectors, resolvedConnectorPositions, index);
      let labelSide: SpliceNodeData['labelSide'] = 'right';
      if (splice.placement === 'CONNECTOR' && splice.ownerConnectorId) {
        const placement = connectorNearSplicePosition(splice, connectorById.get(splice.ownerConnectorId), connectorPositionById.get(splice.ownerConnectorId) ?? { x: 80, y: 120 }, harness.viewerLayout.connectorRotations[splice.ownerConnectorId] ?? 0);
        position = placement.position;
        labelSide = placement.labelSide;
      }
      const connected = harness.wires.filter((wire) => wire.status !== 'ORPHANED' && ((wire.endpointA.kind === 'splice' && wire.endpointA.spliceId === splice.id) || (wire.endpointB.kind === 'splice' && wire.endpointB.spliceId === splice.id)));
      const summaryLines = connected.map((wire) => {
        const other = wire.endpointA.kind === 'splice' && wire.endpointA.spliceId === splice.id ? wire.endpointB : wire.endpointA;
        return `${wire.displayId}: ${endpointDescription(other, harness.connectors, harness.splices)} [${wire.status}]`;
      });
      return {
        id: splice.id,
        type: 'splice',
        position,
        draggable: splice.placement === 'FREE',
        data: {
          splice,
          netName: project.nets.find((net) => net.id === splice.netId)?.name ?? 'Unknown net',
          labelSide,
          wireCount: connected.length,
          summary: `${splice.displayId} · ${project.nets.find((net) => net.id === splice.netId)?.name ?? 'Unknown net'}\n${splice.placement === 'CONNECTOR' ? 'Connector-near' : 'Free splice'}\n${summaryLines.join('\n')}`,
        },
      };
    });

    const actualNodes: FlowNode[] = [...connectors, ...splices];
    if (!splicePreview || splicePreview.spliceId) return actualNodes;
    const fake: SpliceInstance = {
      id: PREVIEW_SPLICE_ID,
      displayId: 'NEW',
      netId: splicePreview.netId,
      placement: splicePreview.placement,
      ownerConnectorId: null,
      anchorPinId: splicePreview.anchorPinId,
      memberEndpoints: [],
      status: 'ACTIVE',
    };
    let position = { x: 420, y: 250 };
    let labelSide: SpliceNodeData['labelSide'] = 'right';
    if (splicePreview.placement === 'CONNECTOR' && splicePreview.anchorPinId) {
      const anchorConnector = harness.connectors.find((connector) => connector.pins.some((pin) => pin.id === splicePreview.anchorPinId));
      if (anchorConnector) {
        fake.ownerConnectorId = anchorConnector.id;
        const placement = connectorNearSplicePosition(fake, anchorConnector, connectorPositionById.get(anchorConnector.id) ?? { x: 80, y: 120 }, harness.viewerLayout.connectorRotations[anchorConnector.id] ?? 0);
        position = placement.position;
        labelSide = placement.labelSide;
      }
    } else {
      const points = splicePreview.endpoints.flatMap((endpoint) => {
        const node = actualNodes.find((item) => item.id === nodeIdForEndpoint(endpoint));
        return node ? [{ x: node.position.x + (node.type === 'connector' ? 90 : 0), y: node.position.y + (node.type === 'connector' ? 70 : 0) }] : [];
      });
      if (points.length) position = { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
    }
    actualNodes.push({
      id: PREVIEW_SPLICE_ID,
      type: 'splice',
      position,
      draggable: false,
      selectable: false,
      data: { splice: fake, netName: project.nets.find((net) => net.id === splicePreview.netId)?.name ?? 'Unknown net', labelSide, wireCount: splicePreview.endpoints.length, summary: 'Proposed splice wiring', preview: true },
    });
    return actualNodes;
  }, [harness.connectors, harness.splices, harness.viewerLayout.connectorPositions, harness.viewerLayout.connectorRotations, harness.viewerLayout.splicePositions, harness.wires, onRotateConnector, project.nets, selectedConnectorId, splicePreview]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(desiredNodes);
  useEffect(() => {
    setNodes((current) => desiredNodes.map((desired) => {
      const live = current.find((node) => node.id === desired.id);
      if (!live) return desired;
      return {
        ...desired,
        position: live.dragging ? live.position : desired.position,
        dragging: live.dragging,
        measured: live.measured,
      };
    }));
  }, [desiredNodes, setNodes]);

  const activeWires = useMemo(() => harness.wires.filter(isActiveWire), [harness.wires]);
  const spliceById = useMemo(() => new Map(harness.splices.map((splice) => [splice.id, splice])), [harness.splices]);
  const routedWires = useMemo(() => activeWires.filter((wire) => !connectorNearAnchorLead(wire, spliceById)), [activeWires, spliceById]);
  const breakouts = useMemo(() => connectorBreakouts(routedWires, harness.connectors), [routedWires, harness.connectors]);
  const obstacles = useMemo(() => nodes.map(nodeObstacle).filter((item): item is RouteObstacle => item !== null), [nodes]);

  const requestForWire = (wire: ActiveWire): RouteRequest | null => {
    const source = terminalForEndpoint(wire.endpointA, nodes);
    const target = terminalForEndpoint(wire.endpointB, nodes);
    if (!source || !target) return null;
    return {
      id: wire.id,
      source,
      target,
      sourceBreakout: wire.endpointA.kind === 'pin' ? breakouts.get(breakoutKey(wire.id, 'source')) ?? BREAKOUT_BASE_PX : SPLICE_BREAKOUT_PX,
      targetBreakout: wire.endpointB.kind === 'pin' ? breakouts.get(breakoutKey(wire.id, 'target')) ?? BREAKOUT_BASE_PX : SPLICE_BREAKOUT_PX,
    };
  };

  const orthogonalPlans = useMemo<Map<string, OrthogonalRoutePlan>>(() => {
    if (wireRenderStyle !== 'orthogonal') return new Map();
    const requests = routedWires.map(requestForWire).filter((item): item is RouteRequest => item !== null);
    return planOrthogonalRoutes(requests, obstacles);
  }, [breakouts, nodes, obstacles, routedWires, wireRenderStyle]);

  const previewSpecs = useMemo<PreviewRouteSpec[]>(() => {
    if (!splicePreview) return [];
    const sourceId = splicePreview.spliceId ?? PREVIEW_SPLICE_ID;
    return splicePreview.endpoints
      .filter((endpoint) => nodeIdForEndpoint(endpoint) !== sourceId)
      .map((endpoint, index) => ({
        id: `preview-${index}-${endpointKeyLocal(endpoint)}`,
        endpoint,
        direct: splicePreview.placement === 'CONNECTOR' && endpoint.kind === 'pin' && endpoint.pinId === splicePreview.anchorPinId,
      }));
  }, [splicePreview]);

  const previewPlans = useMemo<Map<string, OrthogonalRoutePlan>>(() => {
    if (wireRenderStyle !== 'orthogonal' || !splicePreview) return new Map();
    const unaffectedRequests = routedWires
      .filter((wire) => !previewAffectsWire(wire, splicePreview))
      .map(requestForWire)
      .filter((item): item is RouteRequest => item !== null);
    const sourceEndpoint: WireEndpoint = { kind: 'splice', spliceId: splicePreview.spliceId ?? PREVIEW_SPLICE_ID };
    const source = terminalForEndpoint(sourceEndpoint, nodes);
    if (!source) return new Map();
    const previewRequests: RouteRequest[] = previewSpecs.filter((spec) => !spec.direct).flatMap((spec, index) => {
      const target = terminalForEndpoint(spec.endpoint, nodes);
      if (!target) return [];
      let targetBreakout = spec.endpoint.kind === 'pin' ? BREAKOUT_BASE_PX + index * BREAKOUT_STEP_PX : SPLICE_BREAKOUT_PX;
      if (spec.endpoint.kind === 'pin') {
        const affected = activeWires.find((wire) => previewAffectsWire(wire, splicePreview) && wireContainsEndpoint(wire, spec.endpoint));
        const end = affected ? wireContainsEndpoint(affected, spec.endpoint) : null;
        if (affected && end) targetBreakout = breakouts.get(breakoutKey(affected.id, end)) ?? targetBreakout;
      }
      return [{ id: spec.id, source, target, sourceBreakout: SPLICE_BREAKOUT_PX, targetBreakout }];
    });
    return planOrthogonalRoutes([...unaffectedRequests, ...previewRequests], obstacles);
  }, [activeWires, breakouts, nodes, obstacles, previewSpecs, routedWires, splicePreview, wireRenderStyle]);

  const normalEdges = useMemo<Edge[]>(() => activeWires.map((wire) => {
    const wireClass = wireClasses.find((item) => item.id === wire.wireClassId);
    const primary = wire.overrides.primaryColor.mode === 'explicit' ? wire.overrides.primaryColor.value : wireClass?.primaryColor;
    const secondary = wire.overrides.secondaryColor.mode === 'explicit' ? wire.overrides.secondaryColor.value : wireClass?.secondaryColor;
    const gauge = wire.overrides.gaugeMm2.mode === 'explicit' ? wire.overrides.gaugeMm2.value : wireClass?.gaugeMm2;
    const highlighted = highlightedNetId === wire.netId;
    const color = colorMap[primary ?? ''] ?? '#9aa3b2';
    const colorText = [primary, secondary].filter(Boolean).join('/') || '—';
    const dimmedByNet = Boolean(highlightedNetId && !highlighted);
    const previewAffected = previewAffectsWire(wire, splicePreview);
    const anchorLead = connectorNearAnchorLead(wire, spliceById);
    const plan = orthogonalPlans.get(wire.id);
    const sourceHandle = plan?.sourceHandleId ?? nearestSpliceHandle(wire.endpointA, wire.endpointB, nodes);
    const targetHandle = plan?.targetHandleId ?? nearestSpliceHandle(wire.endpointB, wire.endpointA, nodes);
    const sourceBreakout = plan?.sourceBreakout ?? (wire.endpointA.kind === 'pin' ? breakouts.get(breakoutKey(wire.id, 'source')) ?? BREAKOUT_BASE_PX : SPLICE_BREAKOUT_PX);
    const targetBreakout = plan?.targetBreakout ?? (wire.endpointB.kind === 'pin' ? breakouts.get(breakoutKey(wire.id, 'target')) ?? BREAKOUT_BASE_PX : SPLICE_BREAKOUT_PX);
    return {
      id: wire.id,
      source: nodeIdForEndpoint(wire.endpointA), sourceHandle,
      target: nodeIdForEndpoint(wire.endpointB), targetHandle,
      type: 'wire-edge',
      animated: highlighted && !anchorLead && !previewAffected,
      style: { stroke: color, strokeWidth: highlighted ? 5 : anchorLead ? 2 : 2.5, opacity: previewAffected ? 0.18 : dimmedByNet ? 0.18 : 1 },
      data: {
        netId: wire.netId,
        routing: wireRenderStyle,
        direct: anchorLead,
        routeAxis: plan?.axis,
        routeLane: plan?.lane,
        sourceBreakout,
        targetBreakout,
        wireInfo: `${wire.displayId} · ${gauge ?? '—'} · ${colorText}`,
        sourceLabelVisible: !anchorLead && wire.endpointA.kind === 'pin',
        targetLabelVisible: !anchorLead && wire.endpointB.kind === 'pin',
        labelFill: highlighted ? '#fff' : '#aeb8c6',
        labelOpacity: previewAffected ? 0.2 : dimmedByNet ? 0.22 : 0.9,
      },
    };
  }), [activeWires, breakouts, highlightedNetId, nodes, orthogonalPlans, spliceById, splicePreview, wireClasses, wireRenderStyle]);

  const previewEdges = useMemo<Edge[]>(() => {
    if (!splicePreview) return [];
    const sourceId = splicePreview.spliceId ?? PREVIEW_SPLICE_ID;
    const sourceEndpoint: WireEndpoint = { kind: 'splice', spliceId: sourceId };
    return previewSpecs.map((spec, index) => {
      const plan = previewPlans.get(spec.id);
      const sourceHandle = plan?.sourceHandleId ?? nearestSpliceHandle(sourceEndpoint, spec.endpoint, nodes);
      const targetHandle = plan?.targetHandleId ?? nearestSpliceHandle(spec.endpoint, sourceEndpoint, nodes);
      const targetBreakout = plan?.targetBreakout ?? (spec.endpoint.kind === 'pin' ? BREAKOUT_BASE_PX + index * BREAKOUT_STEP_PX : SPLICE_BREAKOUT_PX);
      return {
        id: spec.id,
        source: sourceId,
        sourceHandle,
        target: nodeIdForEndpoint(spec.endpoint),
        targetHandle,
        type: 'wire-edge',
        selectable: false,
        focusable: false,
        style: { stroke: '#b8a7ff', strokeWidth: 3, strokeDasharray: '8 6', opacity: 0.95 },
        data: {
          netId: splicePreview.netId,
          routing: wireRenderStyle,
          direct: spec.direct,
          routeAxis: plan?.axis,
          routeLane: plan?.lane,
          sourceBreakout: plan?.sourceBreakout ?? SPLICE_BREAKOUT_PX,
          targetBreakout,
          sourceLabelVisible: false,
          targetLabelVisible: false,
        },
      } as Edge;
    });
  }, [nodes, previewPlans, previewSpecs, splicePreview, wireRenderStyle]);

  const edges = useMemo(() => [...normalEdges, ...previewEdges], [normalEdges, previewEdges]);

  return (
    <ReactFlow<FlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      connectionMode={ConnectionMode.Loose}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_, node) => {
        if (node.type === 'connector') onLayoutChange(node.id, node.position.x, node.position.y);
        else if (node.type === 'splice' && !node.data.preview && node.data.splice.placement === 'FREE') onSpliceLayoutChange(node.id, node.position.x, node.position.y);
      }}
      onNodeClick={(_, node) => {
        if (node.type === 'connector') onSelectConnector(node.id);
        else if (node.type === 'splice' && !node.data.preview) {
          onHighlightNet(node.data.splice.netId);
          onEditSplice(node.data.splice.id);
        }
      }}
      onEdgeClick={(_, edge) => onHighlightNet((edge.data?.netId as UUID | undefined) ?? null)}
      fitView
      minZoom={0.15}
      maxZoom={2.5}
    >
      <Background gap={22} size={1} />
      <Controls />
    </ReactFlow>
  );
}
