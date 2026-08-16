import type { PropertyValue } from './model';

export interface ResolvedProperty<T> {
  value: T | null;
  source: 'wire' | 'net' | 'wireClass' | 'familyDefault' | 'none';
}

export function resolveProperty<T>(
  wire: PropertyValue<T>,
  net: PropertyValue<T> | undefined,
  wireClass: T | null | undefined,
  familyDefault: T | null | undefined,
): ResolvedProperty<T> {
  if (wire.mode === 'explicit') return { value: wire.value, source: 'wire' };
  if (net?.mode === 'explicit') return { value: net.value, source: 'net' };
  if (wireClass !== undefined && wireClass !== null) return { value: wireClass, source: 'wireClass' };
  if (familyDefault !== undefined && familyDefault !== null) return { value: familyDefault, source: 'familyDefault' };
  return { value: null, source: 'none' };
}
