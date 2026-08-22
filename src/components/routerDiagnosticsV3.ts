import type { OrthogonalRouteResult, RouteObstacle, RoutePoint, RouteRequest } from './routingGeometry';
import type { RouteBundle } from './routingBundles';

export interface RouterDiagnosticSvgInput {
  title: string;
  requests: RouteRequest[];
  obstacles: RouteObstacle[];
  results: Map<string, OrthogonalRouteResult>;
  bundles: RouteBundle[];
  displayIds: Record<string, string>;
  focusBundleKey?: string;
  gridSize?: number;
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[char]!));
}

function terminalPoint(request: RouteRequest, nodeId: string): RoutePoint {
  const terminal = request.source.nodeId === nodeId ? request.source : request.target;
  return terminal.options[0]?.point ?? { x: 0, y: 0 };
}

function includePoint(bounds: Bounds, point: RoutePoint) {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

function computeBounds(input: RouterDiagnosticSvgInput): Bounds {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const obstacle of input.obstacles) {
    includePoint(bounds, { x: obstacle.x, y: obstacle.y });
    includePoint(bounds, { x: obstacle.x + obstacle.width, y: obstacle.y + obstacle.height });
  }
  for (const request of input.requests) {
    for (const option of request.source.options) includePoint(bounds, option.point);
    for (const option of request.target.options) includePoint(bounds, option.point);
    const result = input.results.get(request.id);
    if (result?.status === 'ROUTED') for (const point of result.points) includePoint(bounds, point);
  }
  if (!Number.isFinite(bounds.minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const pad = 140;
  return { minX: bounds.minX - pad, minY: bounds.minY - pad, maxX: bounds.maxX + pad, maxY: bounds.maxY + pad };
}

function polyline(points: RoutePoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function bundleCenter(bundle: RouteBundle, nodeId: string): RoutePoint {
  const points = bundle.requests.map((request) => terminalPoint(request, nodeId));
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / Math.max(1, points.length),
    y: points.reduce((sum, point) => sum + point.y, 0) / Math.max(1, points.length),
  };
}

export function renderRouterDiagnosticSvg(input: RouterDiagnosticSvgInput): string {
  const bounds = computeBounds(input);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const grid = input.gridSize ?? 28;
  const requestById = new Map(input.requests.map((request) => [request.id, request]));
  const bundleByWire = new Map<string, RouteBundle>();
  for (const bundle of input.bundles) for (const request of bundle.requests) bundleByWire.set(request.id, bundle);

  const unroutedByNode = new Map<string, number>();
  for (const request of input.requests) {
    if (input.results.get(request.id)?.status === 'ROUTED') continue;
    unroutedByNode.set(request.source.nodeId, (unroutedByNode.get(request.source.nodeId) ?? 0) + 1);
    unroutedByNode.set(request.target.nodeId, (unroutedByNode.get(request.target.nodeId) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}" width="${width}" height="${height}">`);
  lines.push(`<defs><pattern id="grid" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse"><path d="M ${grid} 0 L 0 0 0 ${grid}" fill="none" stroke="#e5e7eb" stroke-width="1"/></pattern></defs>`);
  lines.push(`<rect x="${bounds.minX}" y="${bounds.minY}" width="${width}" height="${height}" fill="#ffffff"/>`);
  lines.push(`<rect x="${bounds.minX}" y="${bounds.minY}" width="${width}" height="${height}" fill="url(#grid)"/>`);
  lines.push(`<style>
    .node{fill:#f8fafc;stroke:#475569;stroke-width:3}.node-critical{fill:#fff7ed;stroke:#dc2626;stroke-width:5}
    .label-obstacle{fill:#f1f5f9;stroke:#cbd5e1;stroke-width:1}.route{fill:none;stroke:#475569;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}
    .route-muted{fill:none;stroke:#cbd5e1;stroke-width:2}.route-focus{fill:none;stroke:#2563eb;stroke-width:5}.unrouted{fill:none;stroke:#dc2626;stroke-width:4;stroke-dasharray:14 10}
    .critical{fill:#dc2626;stroke:#ffffff;stroke-width:3}.bundle-warning{fill:#fff7ed;stroke:#dc2626;stroke-width:2}.text{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;fill:#0f172a}.small{font-size:18px}.title{font-size:30px;font-weight:700}.warning{fill:#b91c1c;font-weight:700}
  </style>`);
  lines.push(`<text class="text title" x="${bounds.minX + 24}" y="${bounds.minY + 42}">${escapeXml(input.title)}</text>`);

  for (const obstacle of input.obstacles.filter((item) => item.kind !== 'label')) {
    const criticalCount = obstacle.nodeId ? (unroutedByNode.get(obstacle.nodeId) ?? 0) : 0;
    const css = criticalCount ? 'node-critical' : 'node';
    lines.push(`<rect class="${css}" x="${obstacle.x}" y="${obstacle.y}" width="${obstacle.width}" height="${obstacle.height}" rx="8"/>`);
    const display = obstacle.nodeId ? (input.displayIds[obstacle.nodeId] ?? obstacle.nodeId) : obstacle.id;
    lines.push(`<text class="text small" x="${obstacle.x + 10}" y="${obstacle.y + 24}">${escapeXml(display)}${criticalCount ? `  !${criticalCount}` : ''}</text>`);
  }
  for (const obstacle of input.obstacles.filter((item) => item.kind === 'label')) {
    lines.push(`<rect class="label-obstacle" x="${obstacle.x}" y="${obstacle.y}" width="${obstacle.width}" height="${obstacle.height}" rx="2"/>`);
  }

  for (const request of input.requests) {
    const result = input.results.get(request.id);
    const bundle = bundleByWire.get(request.id);
    const focused = !!input.focusBundleKey && bundle?.key === input.focusBundleKey;
    if (result?.status === 'ROUTED') {
      const css = focused ? 'route-focus' : input.focusBundleKey ? 'route-muted' : 'route';
      lines.push(`<polyline class="${css}" points="${polyline(result.points)}"><title>${escapeXml(request.id)} · ${result.length}px · ${result.bends} bends</title></polyline>`);
      continue;
    }
    const a = request.source.options[0]?.point;
    const b = request.target.options[0]?.point;
    if (!a || !b) continue;
    lines.push(`<polyline class="unrouted" points="${a.x},${a.y} ${b.x},${b.y}"><title>${escapeXml(request.id)} · UNROUTED</title></polyline>`);
    lines.push(`<circle class="critical" cx="${a.x}" cy="${a.y}" r="8"/><circle class="critical" cx="${b.x}" cy="${b.y}" r="8"/>`);
  }

  let warningRow = 0;
  for (const bundle of input.bundles) {
    const routed = bundle.requests.filter((request) => input.results.get(request.id)?.status === 'ROUTED').length;
    if (routed === bundle.requests.length) continue;
    if (input.focusBundleKey && bundle.key !== input.focusBundleKey) continue;
    const a = bundleCenter(bundle, bundle.elementAId);
    const b = bundleCenter(bundle, bundle.elementBId);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const text = `${bundle.elementADisplayId}-${bundle.elementBDisplayId} ${routed}/${bundle.requests.length}`;
    lines.push(`<rect class="bundle-warning" x="${mx - 72}" y="${my - 25}" width="144" height="34" rx="5"/>`);
    lines.push(`<text class="text small warning" text-anchor="middle" x="${mx}" y="${my - 2}">${escapeXml(text)}</text>`);
    const legendY = bounds.minY + 78 + warningRow * 24;
    lines.push(`<text class="text small warning" x="${bounds.minX + 24}" y="${legendY}">UNROUTED: ${escapeXml(text)}</text>`);
    warningRow += 1;
  }

  const routedTotal = [...input.results.values()].filter((result) => result.status === 'ROUTED').length;
  lines.push(`<text class="text small" x="${bounds.minX + 24}" y="${bounds.maxY - 24}">routed ${routedTotal}/${input.requests.length} · grid ${grid}px · generated from router data</text>`);
  lines.push(`</svg>`);
  return lines.join('\n');
}
