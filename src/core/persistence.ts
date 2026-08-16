import type { Project } from './model';

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(json: string): Project {
  const parsed = JSON.parse(json) as Partial<Project>;
  if (parsed.schemaVersion !== 1) throw new Error(`Unsupported project schema version: ${String(parsed.schemaVersion)}`);
  if (!parsed.id || !parsed.name || !parsed.subHarnesses || !parsed.nets) throw new Error('Invalid WireMaster project');

  const project = parsed as Project;
  for (const harness of project.subHarnesses) {
    if (!harness.viewerLayout) throw new Error(`Invalid WireMaster project: missing viewer layout for ${harness.name}`);
    harness.viewerLayout.connectorPositions ??= {};
    harness.viewerLayout.connectorRotations ??= {};
    harness.viewerLayout.splicePositions ??= {};
  }
  return project;
}
