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
  PinEndpoint,
  Project,
  SpliceInstance,
  UUID,
  ViewerRotation,
  WireEndpoint,
  WireInstance,
} from '../core/model';

interface ConnectorNodeData extends Record<string, unknown> {
  connector: ConnectorInstance;
  rotation: ViewerRotation;
  onRotate: (connectorId: UUID) => void;
}

interface SpliceNodeData extends Record<string, unknown> {
  splice: SpliceInstance;
  netName: string;
}

type ConnectorNode = Node<ConnectorNodeData, 'connector'>;
type SpliceNode = Node<SpliceNodeData, 'splice'>;
type FlowNode = ConnectorNode | SpliceNode;
type ActiveWire = WireInstance & { status: 'ACTIVE' };
export type WireRenderStyle = 'smooth' | 'orthogonal';

const PIN_PITCH_PX = 28;
const BREAKOUT_BASE_PX = 38;
const SPLICE_BREAKOUT_PX = 18;

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
      >
        ↻
      </button>
    </div>
  );

  return (
    <div className={`viewer-connector rotation-${data.rotation} ${horizontal ? 'horizontal' : 'vertical'}`}>
      {!titleAtBottom && title}
      <div className="viewer-pins">
        {data.connector.pins.map((pin) => (
          <div className="viewer-pin" key={pin.id}>
            <Handle
              id={`p-${pin.id}`}
              type="source"
              position={handlePosition}
              className="pin-handle"
            />
            <span className="cavity">{pin.cavity}</span>
            <span className="pin-name">{pin.pinName || '—'}</span>
          </div>
        ))}
      </div>
      {titleAtBottom && title}
    </div>
  );
}

function SpliceNodeView({ data }: NodeProps<SpliceNode>) {
  return (
    <div className={`viewer-splice ${data.splice.placement.toLowerCase()} status-${data.splice.status.toLowerCase()}`}>
      <Handle
        id={`s-${data.splice.id}`}
        type="source"
        position={Position.Right}
        className="splice-handle"
      />
      <strong>{data.splice.displayId}</strong>
      <span>{data.netName}</span>
    </div>
  );
}

function outwardPoint(x: number, y: number, position: Position, distance: number): { x: number; y: number } {
  if (position === Position.Left) return { x: x - distance, y };
  if (position === Position.Right) return { x: x + distance, y };
  if (position === Position.Top) return { x, y: y - distance };
  return { x, y: y + distance };
}

interface EndLabelPosition {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  rotation: number;
}

function endpointLabelPosition(x: number, y: number, position: Position): EndLabelPosition {
  if (position === Position.Left) return { x: x - 10, y: y - 5, anchor: 'end', rotation: 0 };
  if (position === Position.Right) return { x: x + 10, y: y - 5, anchor: 'start', rotation: 0 };
  // Keep labels beside vertical breakout stubs rather than directly on top of
  // the wire. The lateral offset is intentionally larger than the label's
  // outline/stroke so highlighted wires stay visually separate as well.
  if (position === Position.Top) return { x: x - 10, y: y - 10, anchor: 'start', rotation: -90 };
  return { x: x + 10, y: y + 10, anchor: 'start', rotation: 90 };
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
  corridorOffset: number,
): string {
  const sourceHorizontal = sourcePosition === Position.Left || sourcePosition === Position.Right;
  const targetHorizontal = targetPosition === Position.Left || targetPosition === Position.Right;
  const sourceOut = outwardPoint(sourceX, sourceY, sourcePosition, sourceBreakout);
  const targetOut = outwardPoint(targetX, targetY, targetPosition, targetBreakout);

  if (sourceHorizontal && targetHorizontal) {
    const corridorY = (sourceOut.y + targetOut.y) / 2 + corridorOffset;
    return [
      `M ${sourceX} ${sourceY}`,
      `L ${sourceOut.x} ${sourceOut.y}`,
      `L ${sourceOut.x} ${corridorY}`,
      `L ${targetOut.x} ${corridorY}`,
      `L ${targetOut.x} ${targetOut.y}`,
      `L ${targetX} ${targetY}`,
    ].join(' ');
  }

  if (!sourceHorizontal && !targetHorizontal) {
    const corridorX = (sourceOut.x + targetOut.x) / 2 + corridorOffset;
    return [
      `M ${sourceX} ${sourceY}`,
      `L ${sourceOut.x} ${sourceOut.y}`,
      `L ${corridorX} ${sourceOut.y}`,
      `L ${corridorX} ${targetOut.y}`,
      `L ${targetOut.x} ${targetOut.y}`,
      `L ${targetX} ${targetY}`,
    ].join(' ');
  }

  if (sourceHorizontal) {
    return [
      `M ${sourceX} ${sourceY}`,
      `L ${sourceOut.x} ${sourceOut.y}`,
      `L ${targetOut.x} ${sourceOut.y}`,
      `L ${targetOut.x} ${targetOut.y}`,
      `L ${targetX} ${targetY}`,
    ].join(' ');
  }

  return [
    `M ${sourceX} ${sourceY}`,
    `L ${sourceOut.x} ${sourceOut.y}`,
    `L ${sourceOut.x} ${targetOut.y}`,
    `L ${targetOut.x} ${targetOut.y}`,
    `L ${targetX} ${targetY}`,
  ].join(' ');
}

function WireEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  style,
  markerStart,
  markerEnd,
  interactionWidth,
}: EdgeProps) {
  const routing = data?.routing === 'orthogonal' ? 'orthogonal' : 'smooth';
  const corridorOffset = typeof data?.corridorOffset === 'number' ? data.corridorOffset : 0;
  const sourceBreakout = typeof data?.sourceBreakout === 'number' ? data.sourceBreakout : BREAKOUT_BASE_PX;
  const targetBreakout = typeof data?.targetBreakout === 'number' ? data.targetBreakout : BREAKOUT_BASE_PX;
  const wireInfo = typeof data?.wireInfo === 'string' ? data.wireInfo : '';
  const labelFill = typeof data?.labelFill === 'string' ? data.labelFill : '#aeb8c6';
  const labelOpacity = typeof data?.labelOpacity === 'number' ? data.labelOpacity : 1;

  let path: string;
  if (routing === 'orthogonal') {
    path = orthogonalPath(
      sourceX,
      sourceY,
      sourcePosition,
      sourceBreakout,
      targetX,
      targetY,
      targetPosition,
      targetBreakout,
      corridorOffset,
    );
  } else {
    [path] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  }

  const sourceLabel = endpointLabelPosition(sourceX, sourceY, sourcePosition);
  const targetLabel = endpointLabelPosition(targetX, targetY, targetPosition);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
      />
      {wireInfo && (
        <g className="wire-end-labels" opacity={labelOpacity} pointerEvents="none">
          <text
            x={sourceLabel.x}
            y={sourceLabel.y}
            textAnchor={sourceLabel.anchor}
            transform={sourceLabel.rotation ? `rotate(${sourceLabel.rotation} ${sourceLabel.x} ${sourceLabel.y})` : undefined}
            fill={labelFill}
            className="wire-end-label"
          >
            {wireInfo}
          </text>
          <text
            x={targetLabel.x}
            y={targetLabel.y}
            textAnchor={targetLabel.anchor}
            transform={targetLabel.rotation ? `rotate(${targetLabel.rotation} ${targetLabel.x} ${targetLabel.y})` : undefined}
            fill={labelFill}
            className="wire-end-label"
          >
            {wireInfo}
          </text>
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

function nodeIdForEndpoint(endpoint: WireEndpoint): UUID {
  return endpoint.kind === 'pin' ? endpoint.connectorId : endpoint.spliceId;
}

function handleIdForEndpoint(endpoint: WireEndpoint): string {
  return endpoint.kind === 'pin' ? `p-${endpoint.pinId}` : `s-${endpoint.spliceId}`;
}

function nodePairKey(wire: ActiveWire): string {
  return [nodeIdForEndpoint(wire.endpointA), nodeIdForEndpoint(wire.endpointB)].sort().join('|');
}

function corridorOffsets(wires: ActiveWire[]): Map<UUID, number> {
  const groups = new Map<string, ActiveWire[]>();
  for (const wire of wires) {
    const key = nodePairKey(wire);
    const group = groups.get(key) ?? [];
    group.push(wire);
    groups.set(key, group);
  }

  const result = new Map<UUID, number>();
  for (const group of groups.values()) {
    group.sort((left, right) => left.displayId.localeCompare(right.displayId, undefined, { numeric: true }));
    const center = (group.length - 1) / 2;
    group.forEach((wire, index) => {
      result.set(wire.id, (index - center) * PIN_PITCH_PX);
    });
  }
  return result;
}

function breakoutKey(wireId: UUID, end: EdgeEnd): string {
  return `${wireId}:${end}`;
}

function connectorBreakouts(wires: ActiveWire[], connectors: ConnectorInstance[]): Map<string, number> {
  const entriesByConnector = new Map<UUID, Array<{ wire: ActiveWire; end: EdgeEnd; pinIndex: number }>>();
  const connectorById = new Map(connectors.map((connector) => [connector.id, connector]));

  for (const wire of wires) {
    const endpoints: Array<{ endpoint: WireEndpoint; end: EdgeEnd }> = [
      { endpoint: wire.endpointA, end: 'source' },
      { endpoint: wire.endpointB, end: 'target' },
    ];

    for (const { endpoint, end } of endpoints) {
      if (endpoint.kind !== 'pin') continue;
      const connector = connectorById.get(endpoint.connectorId);
      if (!connector) continue;
      const pinIndex = Math.max(0, connector.pins.findIndex((pin) => pin.id === endpoint.pinId));
      const entries = entriesByConnector.get(connector.id) ?? [];
      entries.push({ wire, end, pinIndex });
      entriesByConnector.set(connector.id, entries);
    }
  }

  const result = new Map<string, number>();
  for (const entries of entriesByConnector.values()) {
    entries.sort((left, right) => left.pinIndex - right.pinIndex
      || left.wire.displayId.localeCompare(right.wire.displayId, undefined, { numeric: true }));
    entries.forEach((entry, index) => {
      result.set(breakoutKey(entry.wire.id, entry.end), BREAKOUT_BASE_PX + index * PIN_PITCH_PX);
    });
  }
  return result;
}

function connectorNearSplicePosition(
  splice: SpliceInstance,
  connector: ConnectorInstance | undefined,
  connectorPosition: { x: number; y: number },
  rotation: ViewerRotation,
): { x: number; y: number } {
  const pinIndex = Math.max(0, connector?.pins.findIndex((pin) => pin.id === splice.anchorPinId) ?? 0);
  if (rotation === 180) return { x: connectorPosition.x - 72, y: connectorPosition.y + 29 + pinIndex * PIN_PITCH_PX };
  if (rotation === 90) return { x: connectorPosition.x + 6 + pinIndex * 32, y: connectorPosition.y + 148 };
  if (rotation === 270) return { x: connectorPosition.x + 6 + pinIndex * 32, y: connectorPosition.y - 58 };
  return { x: connectorPosition.x + 214, y: connectorPosition.y + 29 + pinIndex * PIN_PITCH_PX };
}

interface Props {
  project: Project;
  harnessId: UUID;
  selectedConnectorId: UUID | null;
  highlightedNetId: UUID | null;
  wireRenderStyle: WireRenderStyle;
  onSelectConnector: (id: UUID) => void;
  onHighlightNet: (id: UUID | null) => void;
  onRotateConnector: (id: UUID) => void;
  onLayoutChange: (connectorId: UUID, x: number, y: number) => void;
  onSpliceLayoutChange: (spliceId: UUID, x: number, y: number) => void;
}

export function ElectricalViewer({
  project,
  harnessId,
  selectedConnectorId,
  highlightedNetId,
  wireRenderStyle,
  onSelectConnector,
  onHighlightNet,
  onRotateConnector,
  onLayoutChange,
  onSpliceLayoutChange,
}: Props) {
  const harness = project.subHarnesses.find((item) => item.id === harnessId)!;
  const wireClasses = project.wireClasses;

  const desiredNodes = useMemo<FlowNode[]>(() => {
    const connectors: ConnectorNode[] = harness.connectors.map((connector, index) => ({
      id: connector.id,
      type: 'connector',
      position: harness.viewerLayout.connectorPositions[connector.id] ?? { x: 80 + index * 380, y: 120 },
      data: {
        connector,
        rotation: harness.viewerLayout.connectorRotations[connector.id] ?? 0,
        onRotate: onRotateConnector,
      },
      selected: connector.id === selectedConnectorId,
    }));
    const connectorById = new Map(harness.connectors.map((connector) => [connector.id, connector]));
    const connectorPositionById = new Map(connectors.map((node) => [node.id, node.position]));

    const splices: SpliceNode[] = harness.splices
      .filter((splice) => splice.status !== 'ORPHANED')
      .map((splice, index) => {
        let position = harness.viewerLayout.splicePositions[splice.id] ?? { x: 360 + index * 70, y: 260 };
        if (splice.placement === 'CONNECTOR' && splice.ownerConnectorId) {
          const connector = connectorById.get(splice.ownerConnectorId);
          const connectorPosition = connectorPositionById.get(splice.ownerConnectorId) ?? { x: 80, y: 120 };
          const rotation = harness.viewerLayout.connectorRotations[splice.ownerConnectorId] ?? 0;
          position = connectorNearSplicePosition(splice, connector, connectorPosition, rotation);
        }
        return {
          id: splice.id,
          type: 'splice',
          position,
          draggable: splice.placement === 'FREE',
          data: {
            splice,
            netName: project.nets.find((net) => net.id === splice.netId)?.name ?? 'Unknown net',
          },
        };
      });
    return [...connectors, ...splices];
  }, [harness.connectors, harness.splices, harness.viewerLayout.connectorPositions, harness.viewerLayout.connectorRotations, harness.viewerLayout.splicePositions, onRotateConnector, project.nets, selectedConnectorId]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(desiredNodes);
  useEffect(() => {
    setNodes((current) => desiredNodes.map((desired) => {
      const live = current.find((node) => node.id === desired.id);
      return live?.dragging
        ? { ...desired, position: live.position, dragging: true }
        : desired;
    }));
  }, [desiredNodes, setNodes]);

  const activeWires = useMemo(() => harness.wires.filter(isActiveWire), [harness.wires]);
  const routeCorridors = useMemo(() => corridorOffsets(activeWires), [activeWires]);
  const breakouts = useMemo(() => connectorBreakouts(activeWires, harness.connectors), [activeWires, harness.connectors]);

  const edges = useMemo<Edge[]>(() => activeWires.map((wire) => {
    const wireClass = wireClasses.find((item) => item.id === wire.wireClassId);
    const primary = wire.overrides.primaryColor.mode === 'explicit' ? wire.overrides.primaryColor.value : wireClass?.primaryColor;
    const secondary = wire.overrides.secondaryColor.mode === 'explicit' ? wire.overrides.secondaryColor.value : wireClass?.secondaryColor;
    const gauge = wire.overrides.gaugeMm2.mode === 'explicit' ? wire.overrides.gaugeMm2.value : wireClass?.gaugeMm2;
    const highlighted = highlightedNetId === wire.netId;
    const color = colorMap[primary ?? ''] ?? '#9aa3b2';
    const colorText = [primary, secondary].filter(Boolean).join('/') || '—';
    const dimmed = Boolean(highlightedNetId && !highlighted);
    return {
      id: wire.id,
      source: nodeIdForEndpoint(wire.endpointA),
      sourceHandle: handleIdForEndpoint(wire.endpointA),
      target: nodeIdForEndpoint(wire.endpointB),
      targetHandle: handleIdForEndpoint(wire.endpointB),
      type: 'wire-edge',
      animated: highlighted,
      style: { stroke: color, strokeWidth: highlighted ? 5 : 2.5, opacity: dimmed ? 0.18 : 1 },
      data: {
        netId: wire.netId,
        routing: wireRenderStyle,
        corridorOffset: routeCorridors.get(wire.id) ?? 0,
        sourceBreakout: wire.endpointA.kind === 'pin' ? breakouts.get(breakoutKey(wire.id, 'source')) ?? BREAKOUT_BASE_PX : SPLICE_BREAKOUT_PX,
        targetBreakout: wire.endpointB.kind === 'pin' ? breakouts.get(breakoutKey(wire.id, 'target')) ?? BREAKOUT_BASE_PX : SPLICE_BREAKOUT_PX,
        wireInfo: `${wire.displayId} · ${gauge ?? '—'} · ${colorText}`,
        labelFill: highlighted ? '#fff' : '#aeb8c6',
        labelOpacity: dimmed ? 0.22 : 0.9,
      },
    };
  }), [activeWires, breakouts, highlightedNetId, routeCorridors, wireClasses, wireRenderStyle]);

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
        else if (node.type === 'splice' && node.data.splice.placement === 'FREE') onSpliceLayoutChange(node.id, node.position.x, node.position.y);
      }}
      onNodeClick={(_, node) => {
        if (node.type === 'connector') onSelectConnector(node.id);
        else if (node.type === 'splice') onHighlightNet(node.data.splice.netId);
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
