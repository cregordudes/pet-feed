export type Role = 'Husband' | 'Wife';

export function isRole(value: unknown): value is Role {
  return value === 'Husband' || value === 'Wife';
}
