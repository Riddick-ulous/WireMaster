import { useEffect, useMemo } from 'react';
import {
  Background,
  BaseEdge,
  ConnectionMode,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useNodesState,
  useUpdateNodeInternals,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { ConnectorInstance, Project, SpliceInstance, UUID, ViewerRotation, WireEndpoint, WireInstance } from '../core/model';
import type { SplicePreview } from './SpliceDialog';
import { connectorNearSplicePosition } from './connectorNearSpliceLayout';
import { planOrthogonalRoutesV2 } from './orthogonalRouterV2';
import { spliceLabelObstacle, wireLabelGeometry, type RoutingLabelGeometry } from './routingLabels';
import { MIN_BEND_SPACING, type CardinalSide, type OrthogonalRouteResult, type RouteObstacle, type RoutePoint, type RouteRequest, type RouteTerminal, type RouteTerminalOption } from './routingGeometry';

interface ConnectorNodeData extends Record<string, unknown> { connector: ConnectorInstance; rotation: ViewerRotation; onRotate: (connectorId: UUID) => void }
interface SpliceNodeData extends Record<string, unknown> { splice: SpliceInstance; netName: string; labelSide: CardinalSide; wireCount: number; summary: string; preview?: boolean }
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
const SPLICE_SIZE_PX = 12;
const PREVIEW_SPLICE_ID = '__wiremaster_splice_preview__';

interface WireVisual { text: string; color: string; highlighted: boolean; dimmedByNet: boolean }
interface WireEndLabels { source?: RoutingLabelGeometry; target?: RoutingLabelGeometry }
interface RenderLabel { x: number; y: number; anchor: 'start' | 'middle' | 'end'; rotation: number }

function isActiveWire(wire: WireInstance): wire is ActiveWire { return wire.status === 'ACTIVE' }
function nodeIdForEndpoint(endpoint: WireEndpoint): UUID { return endpoint.kind === 'pin' ? endpoint.connectorId : endpoint.spliceId }
function endpointKey(endpoint: WireEndpoint): string { return endpoint.kind === 'pin' ? `pin:${endpoint.connectorId}:${endpoint.pinId}` : `splice:${endpoint.spliceId}` }

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
      <button type="button" className="viewer-rotate nodrag nopan" title="Rotate connector 90°" aria-label={`Rotate ${data.connector.displayId} 90 degrees`} onClick={(event) => { event.stopPropagation(); data.onRotate(data.connector.id); }}>↻</button>
    </div>
  );
  return (
    <div className={`viewer-connector rotation-${data.rotation} ${horizontal ? 'horizontal' : 'vertical'}`}>
      {!titleAtBottom && title}
      <div className="viewer-pins">
        {data.connector.pins.map((pin) => (
          <div className="viewer-pin" key={pin.id}>
            <Handle id={`p-${pin.id}`} type="source" position={handlePosition} className="pin-handle" />
            <span className="cavity">{pin.cavity}</span><span className="pin-name">{pin.pinName || '—'}</span>
          </div>
        ))}
      </div>
      {titleAtBottom && title}
    </div>
  );
}

function SpliceNodeView({ id, data }: NodeProps<SpliceNode>) {
  return (
    <div className={`viewer-splice ${data.splice.placement.toLowerCase()} status-${data.splice.status.toLowerCase()} label-${data.labelSide} ${data.preview ? 'preview' : ''}`} title={data.summary}>
      {(['left', 'right', 'top', 'bottom'] as const).map((side) => <Handle key={side} id={`s-${id}-${side}`} type="source" position={positionForSide(side)} className="splice-handle" />)}
      <span className="splice-tag">{data.preview ? 'NEW' : data.splice.displayId}{data.wireCount ? ` · ${data.wireCount}W` : ''}</span>
    </div>
  );
}

function polylinePath(points: RoutePoint[]): string { return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ') }
function pointToward(from: RoutePoint, to: RoutePoint, distance: number): RoutePoint {
  if (Math.abs(from.x - to.x) < 0.01) return { x: from.x, y: from.y + Math.sign(to.y - from.y) * distance };
  return { x: from.x + Math.sign(to.x - from.x) * distance, y: from.y };
}
function roundedPolylinePath(points: RoutePoint[], preferredRadius = 7): string {
  if (points.length < 3) return polylinePath(points);
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incoming = Math.abs(corner.x - previous.x) + Math.abs(corner.y - previous.y);
    const outgoing = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y);
    const radius = Math.min(preferredRadius, incoming / 3, outgoing / 3);
    const before = pointToward(corner, previous, radius);
    const after = pointToward(corner, next, radius);
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function temporaryPath(sourceX: number, sourceY: number, sourcePosition: Position, targetX: number, targetY: number, targetPosition: Position): string {
  const horizontalSource = sourcePosition === Position.Left || sourcePosition === Position.Right;
  const horizontalTarget = targetPosition === Position.Left || targetPosition === Position.Right;
  if (horizontalSource && horizontalTarget) {
    const middle = (sourceX + targetX) / 2;
    return polylinePath([{ x: sourceX, y: sourceY }, { x: middle, y: sourceY }, { x: middle, y: targetY }, { x: targetX, y: targetY }]);
  }
  const middle = (sourceY + targetY) / 2;
  return polylinePath([{ x: sourceX, y: sourceY }, { x: sourceX, y: middle }, { x: targetX, y: middle }, { x: targetX, y: targetY }]);
}

function renderLabel(label: RoutingLabelGeometry | undefined): RenderLabel | undefined {
  return label ? { x: label.textX, y: label.textY, anchor: label.anchor, rotation: label.rotation } : undefined;
}

function WireEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data, style, markerStart, markerEnd, interactionWidth }: EdgeProps) {
  const points = Array.isArray(data?.points) ? data.points as RoutePoint[] : [];
  const routing = data?.routing === 'smooth' ? 'smooth' : 'orthogonal';
  const temporary = data?.temporary === true;
  const direct = data?.direct === true;
  let path: string;
  if (direct) path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  else if (temporary || points.length < 2) path = temporaryPath(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition);
  else path = routing === 'smooth' ? roundedPolylinePath(points) : polylinePath(points);

  const wireInfo = typeof data?.wireInfo === 'string' ? data.wireInfo : '';
  const sourceLabel = data?.sourceLabel as RenderLabel | undefined;
  const targetLabel = data?.targetLabel as RenderLabel | undefined;
  const labelFill = typeof data?.labelFill === 'string' ? data.labelFill : '#aeb8c6';
  const labelOpacity = typeof data?.labelOpacity === 'number' ? data.labelOpacity : 1;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={interactionWidth} />
      {wireInfo && (sourceLabel || targetLabel) && (
        <g className="wire-end-labels" opacity={labelOpacity} pointerEvents="none">
          {sourceLabel && <text x={sourceLabel.x} y={sourceLabel.y} textAnchor={sourceLabel.anchor} transform={sourceLabel.rotation ? `rotate(${sourceLabel.rotation} ${sourceLabel.x} ${sourceLabel.y})` : undefined} fill={labelFill} className="wire-end-label">{wireInfo}</text>}
          {targetLabel && <text x={targetLabel.x} y={targetLabel.y} textAnchor={targetLabel.anchor} transform={targetLabel.rotation ? `rotate(${targetLabel.rotation} ${targetLabel.x} ${targetLabel.y})` : undefined} fill={labelFill} className="wire-end-label">{wireInfo}</text>}
        </g>
      )}
    </>
  );
}

const nodeTypes = { connector: ConnectorNodeView, splice: SpliceNodeView };
const edgeTypes = { 'wire-edge': WireEdge };
const colorMap: Record<string, string> = { VIOLET: '#a970ff', RED: '#ff5b67', GREEN: '#4adf8f', WHITE: '#f4f6fa', BLACK: '#353a46', BLUE: '#52a8ff', YELLOW: '#ffd65c', ORANGE: '#ff9f4a', BROWN: '#a8734a', GREY: '#9aa3b2' };

function connectorNearAnchorLead(wire: ActiveWire, splices: Map<UUID, SpliceInstance>): boolean {
  const spliceEndpoint = wire.endpointA.kind === 'splice' ? wire.endpointA : wire.endpointB.kind === 'splice' ? wire.endpointB : null;
  const pinEndpoint = wire.endpointA.kind === 'pin' ? wire.endpointA : wire.endpointB.kind === 'pin' ? wire.endpointB : null;
  if (!spliceEndpoint || !pinEndpoint) return false;
  const splice = splices.get(spliceEndpoint.spliceId);
  return splice?.placement === 'CONNECTOR' && splice.anchorPinId === pinEndpoint.pinId && splice.ownerConnectorId === pinEndpoint.connectorId;
}

function defaultFreeSplicePosition(splice: SpliceInstance, connectors: ConnectorInstance[], connectorPositions: Record<UUID, RoutePoint>, index: number): RoutePoint {
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
  return { width: node.measured?.width ?? (horizontal ? Math.max(CONNECTOR_WIDTH_PX, node.data.connector.pins.length * HORIZONTAL_PIN_WIDTH_PX) : CONNECTOR_WIDTH_PX), height: node.measured?.height ?? (horizontal ? CONNECTOR_TITLE_PX + HORIZONTAL_PIN_HEIGHT_PX : CONNECTOR_TITLE_PX + node.data.connector.pins.length * PIN_PITCH_PX) };
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
    let point: RoutePoint;
    if (rotation === 180) { side = 'left'; point = { x: node.position.x, y: node.position.y + CONNECTOR_TITLE_PX + pinIndex * PIN_PITCH_PX + PIN_PITCH_PX / 2 }; }
    else if (rotation === 90) { side = 'bottom'; point = { x: node.position.x + pinIndex * HORIZONTAL_PIN_WIDTH_PX + HORIZONTAL_PIN_WIDTH_PX / 2, y: node.position.y + size.height }; }
    else if (rotation === 270) { side = 'top'; point = { x: node.position.x + pinIndex * HORIZONTAL_PIN_WIDTH_PX + HORIZONTAL_PIN_WIDTH_PX / 2, y: node.position.y }; }
    else { side = 'right'; point = { x: node.position.x + size.width, y: node.position.y + CONNECTOR_TITLE_PX + pinIndex * PIN_PITCH_PX + PIN_PITCH_PX / 2 }; }
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
  return { id: `node-${node.id}`, nodeId: node.id, kind: 'node', x: node.position.x, y: node.position.y, width: size.width, height: size.height };
}

function nearestHandle(endpoint: WireEndpoint, other: WireEndpoint, nodes: FlowNode[]): string {
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

function previewAffectsWire(wire: ActiveWire, preview: SplicePreview | null): boolean {
  if (!preview) return false;
  if (preview.splitWireId === wire.id) return true;
  return Boolean(preview.spliceId && [wire.endpointA, wire.endpointB].some((endpoint) => endpoint.kind === 'splice' && endpoint.spliceId === preview.spliceId));
}

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
    const connectors: ConnectorNode[] = harness.connectors.map((connector, index) => ({ id: connector.id, type: 'connector', position: harness.viewerLayout.connectorPositions[connector.id] ?? { x: 80 + index * 380, y: 120 }, data: { connector, rotation: harness.viewerLayout.connectorRotations[connector.id] ?? 0, onRotate: onRotateConnector }, selected: connector.id === selectedConnectorId }));
    const connectorById = new Map(harness.connectors.map((connector) => [connector.id, connector]));
    const connectorPositionById = new Map(connectors.map((node) => [node.id, node.position]));
    const resolvedConnectorPositions = Object.fromEntries(connectors.map((node) => [node.id, node.position])) as Record<UUID, RoutePoint>;
    const splices: SpliceNode[] = harness.splices.filter((splice) => splice.status !== 'ORPHANED').map((splice, index) => {
      let position = harness.viewerLayout.splicePositions[splice.id] ?? defaultFreeSplicePosition(splice, harness.connectors, resolvedConnectorPositions, index);
      let labelSide: CardinalSide = 'right';
      if (splice.placement === 'CONNECTOR' && splice.ownerConnectorId) {
        const placement = connectorNearSplicePosition(splice, connectorById.get(splice.ownerConnectorId), connectorPositionById.get(splice.ownerConnectorId) ?? { x: 80, y: 120 }, harness.viewerLayout.connectorRotations[splice.ownerConnectorId] ?? 0);
        position = placement.position; labelSide = placement.labelSide;
      }
      const connected = harness.wires.filter((wire) => wire.status !== 'ORPHANED' && ((wire.endpointA.kind === 'splice' && wire.endpointA.spliceId === splice.id) || (wire.endpointB.kind === 'splice' && wire.endpointB.spliceId === splice.id)));
      const summaryLines = connected.map((wire) => { const other = wire.endpointA.kind === 'splice' && wire.endpointA.spliceId === splice.id ? wire.endpointB : wire.endpointA; return `${wire.displayId}: ${endpointDescription(other, harness.connectors, harness.splices)} [${wire.status}]`; });
      return { id: splice.id, type: 'splice', position, draggable: splice.placement === 'FREE', data: { splice, netName: project.nets.find((net) => net.id === splice.netId)?.name ?? 'Unknown net', labelSide, wireCount: connected.length, summary: `${splice.displayId} · ${project.nets.find((net) => net.id === splice.netId)?.name ?? 'Unknown net'}\n${splice.placement === 'CONNECTOR' ? 'Connector-near' : 'Free splice'}\n${summaryLines.join('\n')}` } };
    });
    const actualNodes: FlowNode[] = [...connectors, ...splices];
    if (!splicePreview || splicePreview.spliceId) return actualNodes;
    const fake: SpliceInstance = { id: PREVIEW_SPLICE_ID, displayId: 'NEW', netId: splicePreview.netId, placement: splicePreview.placement, ownerConnectorId: null, anchorPinId: splicePreview.anchorPinId, memberEndpoints: [], status: 'ACTIVE' };
    let position = { x: 420, y: 250 };
    let labelSide: CardinalSide = 'right';
    if (splicePreview.placement === 'CONNECTOR' && splicePreview.anchorPinId) {
      const anchorConnector = harness.connectors.find((connector) => connector.pins.some((pin) => pin.id === splicePreview.anchorPinId));
      if (anchorConnector) {
        fake.ownerConnectorId = anchorConnector.id;
        const placement = connectorNearSplicePosition(fake, anchorConnector, connectorPositionById.get(anchorConnector.id) ?? { x: 80, y: 120 }, harness.viewerLayout.connectorRotations[anchorConnector.id] ?? 0);
        position = placement.position; labelSide = placement.labelSide;
      }
    } else {
      const points = splicePreview.endpoints.flatMap((endpoint) => { const node = actualNodes.find((item) => item.id === nodeIdForEndpoint(endpoint)); return node ? [{ x: node.position.x + (node.type === 'connector' ? 90 : 0), y: node.position.y + (node.type === 'connector' ? 70 : 0) }] : []; });
      if (points.length) position = { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
    }
    actualNodes.push({ id: PREVIEW_SPLICE_ID, type: 'splice', position, draggable: false, selectable: false, data: { splice: fake, netName: project.nets.find((net) => net.id === splicePreview.netId)?.name ?? 'Unknown net', labelSide, wireCount: splicePreview.endpoints.length, summary: 'Proposed splice wiring', preview: true } });
    return actualNodes;
  }, [harness.connectors, harness.splices, harness.viewerLayout.connectorPositions, harness.viewerLayout.connectorRotations, harness.viewerLayout.splicePositions, harness.wires, onRotateConnector, project.nets, selectedConnectorId, splicePreview]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(desiredNodes);
  useEffect(() => {
    setNodes((current) => desiredNodes.map((desired) => { const live = current.find((node) => node.id === desired.id); return live ? { ...desired, position: live.dragging ? live.position : desired.position, dragging: live.dragging, measured: live.measured } : desired; }));
  }, [desiredNodes, setNodes]);

  const activeWires = useMemo(() => harness.wires.filter(isActiveWire), [harness.wires]);
  const spliceById = useMemo(() => new Map(harness.splices.map((splice) => [splice.id, splice])), [harness.splices]);
  const globallyRoutedWires = useMemo(() => activeWires.filter((wire) => !connectorNearAnchorLead(wire, spliceById)), [activeWires, spliceById]);
  const isDragging = nodes.some((node) => node.dragging);

  const visuals = useMemo(() => {
    const map = new Map<UUID, WireVisual>();
    for (const wire of activeWires) {
      const wireClass = wireClasses.find((item) => item.id === wire.wireClassId);
      const primary = wire.overrides.primaryColor.mode === 'explicit' ? wire.overrides.primaryColor.value : wireClass?.primaryColor;
      const secondary = wire.overrides.secondaryColor.mode === 'explicit' ? wire.overrides.secondaryColor.value : wireClass?.secondaryColor;
      const gauge = wire.overrides.gaugeMm2.mode === 'explicit' ? wire.overrides.gaugeMm2.value : wireClass?.gaugeMm2;
      const highlighted = highlightedNetId === wire.netId;
      map.set(wire.id, { text: `${wire.displayId} · ${gauge ?? '—'} · ${[primary, secondary].filter(Boolean).join('/') || '—'}`, color: colorMap[primary ?? ''] ?? '#9aa3b2', highlighted, dimmedByNet: Boolean(highlightedNetId && !highlighted) });
    }
    return map;
  }, [activeWires, highlightedNetId, wireClasses]);

  const wireLabels = useMemo(() => {
    const map = new Map<UUID, WireEndLabels>();
    for (const wire of globallyRoutedWires) {
      const visual = visuals.get(wire.id);
      if (!visual) continue;
      const labels: WireEndLabels = {};
      const source = terminalForEndpoint(wire.endpointA, nodes)?.options[0];
      const target = terminalForEndpoint(wire.endpointB, nodes)?.options[0];
      if (wire.endpointA.kind === 'pin' && source) labels.source = wireLabelGeometry(`${wire.id}-source-label`, source.point, source.side, visual.text);
      if (wire.endpointB.kind === 'pin' && target) labels.target = wireLabelGeometry(`${wire.id}-target-label`, target.point, target.side, visual.text);
      map.set(wire.id, labels);
    }
    return map;
  }, [globallyRoutedWires, nodes, visuals]);

  const obstacles = useMemo(() => {
    const result = nodes.map(nodeObstacle).filter((item): item is RouteObstacle => item !== null);
    for (const labels of wireLabels.values()) {
      if (labels.source) result.push(labels.source.obstacle);
      if (labels.target) result.push(labels.target.obstacle);
    }
    for (const node of nodes) {
      if (node.type !== 'splice' || node.data.preview) continue;
      const size = measuredSize(node);
      result.push(spliceLabelObstacle(`${node.id}-splice-label`, node.position, size.width, size.height, node.data.labelSide, `${node.data.splice.displayId} · ${node.data.wireCount}W`));
    }
    return result;
  }, [nodes, wireLabels]);

  const requests = useMemo(() => globallyRoutedWires.flatMap((wire): RouteRequest[] => {
    const source = terminalForEndpoint(wire.endpointA, nodes);
    const target = terminalForEndpoint(wire.endpointB, nodes);
    if (!source || !target) return [];
    const labels = wireLabels.get(wire.id);
    return [{ id: wire.id, source, target, sourceMinStraight: labels?.source?.minStraight ?? MIN_BEND_SPACING, targetMinStraight: labels?.target?.minStraight ?? MIN_BEND_SPACING }];
  }), [globallyRoutedWires, nodes, wireLabels]);

  const routingResults = useMemo<Map<string, OrthogonalRouteResult>>(() => isDragging ? new Map() : planOrthogonalRoutesV2(requests, obstacles), [isDragging, obstacles, requests]);
  const unroutedWires = useMemo(() => isDragging ? [] : globallyRoutedWires.filter((wire) => routingResults.get(wire.id)?.status !== 'ROUTED'), [globallyRoutedWires, isDragging, routingResults]);

  const normalEdges = useMemo<Edge[]>(() => activeWires.flatMap((wire) => {
    const visual = visuals.get(wire.id);
    if (!visual) return [];
    const anchorLead = connectorNearAnchorLead(wire, spliceById);
    const affected = previewAffectsWire(wire, splicePreview);
    const result = routingResults.get(wire.id);
    if (!anchorLead && !isDragging && result?.status !== 'ROUTED') return [];
    const labels = wireLabels.get(wire.id);
    const sourceHandle = result?.status === 'ROUTED' ? result.sourceHandleId : nearestHandle(wire.endpointA, wire.endpointB, nodes);
    const targetHandle = result?.status === 'ROUTED' ? result.targetHandleId : nearestHandle(wire.endpointB, wire.endpointA, nodes);
    return [{
      id: wire.id,
      source: nodeIdForEndpoint(wire.endpointA), sourceHandle,
      target: nodeIdForEndpoint(wire.endpointB), targetHandle,
      type: 'wire-edge',
      animated: visual.highlighted && !anchorLead && !affected && !isDragging,
      style: { stroke: visual.color, strokeWidth: visual.highlighted ? 5 : anchorLead ? 2 : 2.5, opacity: affected ? 0.18 : visual.dimmedByNet ? 0.18 : isDragging ? 0.55 : 1, strokeDasharray: isDragging && !anchorLead ? '5 5' : undefined },
      data: { netId: wire.netId, routing: wireRenderStyle, direct: anchorLead, temporary: isDragging && !anchorLead, points: result?.status === 'ROUTED' ? result.points : [], wireInfo: visual.text, sourceLabel: renderLabel(labels?.source), targetLabel: renderLabel(labels?.target), labelFill: visual.highlighted ? '#fff' : '#aeb8c6', labelOpacity: affected ? 0.2 : visual.dimmedByNet ? 0.22 : 0.9 },
    } as Edge];
  }), [activeWires, isDragging, nodes, routingResults, spliceById, splicePreview, visuals, wireLabels, wireRenderStyle]);

  const previewEdges = useMemo<Edge[]>(() => {
    if (!splicePreview) return [];
    const sourceId = splicePreview.spliceId ?? PREVIEW_SPLICE_ID;
    const sourceEndpoint: WireEndpoint = { kind: 'splice', spliceId: sourceId };
    return splicePreview.endpoints.filter((endpoint) => nodeIdForEndpoint(endpoint) !== sourceId).map((endpoint, index) => {
      const direct = splicePreview.placement === 'CONNECTOR' && endpoint.kind === 'pin' && endpoint.pinId === splicePreview.anchorPinId;
      return { id: `preview-${index}-${endpointKey(endpoint)}`, source: sourceId, sourceHandle: nearestHandle(sourceEndpoint, endpoint, nodes), target: nodeIdForEndpoint(endpoint), targetHandle: nearestHandle(endpoint, sourceEndpoint, nodes), type: 'wire-edge', selectable: false, focusable: false, style: { stroke: '#b8a7ff', strokeWidth: 3, strokeDasharray: '8 6', opacity: 0.95 }, data: { netId: splicePreview.netId, routing: 'orthogonal', direct, temporary: !direct, points: [], wireInfo: '' } } as Edge;
    });
  }, [nodes, splicePreview]);

  return (
    <div className="viewer-routing-root">
      {unroutedWires.length > 0 && (
        <div className="routing-warning" role="status">
          <strong>{unroutedWires.length} wire{unroutedWires.length === 1 ? '' : 's'} UNROUTED</strong>
          <span>{unroutedWires.slice(0, 8).map((wire) => wire.displayId).join(', ')}{unroutedWires.length > 8 ? ` +${unroutedWires.length - 8}` : ''} · Move connectors/splices farther apart to create valid routing space.</span>
        </div>
      )}
      <ReactFlow<FlowNode>
        nodes={nodes}
        edges={[...normalEdges, ...previewEdges]}
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
          else if (node.type === 'splice' && !node.data.preview) { onHighlightNet(node.data.splice.netId); onEditSplice(node.data.splice.id); }
        }}
        onEdgeClick={(_, edge) => onHighlightNet((edge.data?.netId as UUID | undefined) ?? null)}
        fitView minZoom={0.15} maxZoom={2.5}
      >
        <Background gap={22} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
