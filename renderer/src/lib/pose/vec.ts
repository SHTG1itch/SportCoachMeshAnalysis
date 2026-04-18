// Minimal 3D vector math. No deps.

export type Vec3 = { x: number; y: number; z: number };

export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const scale = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});

export const dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const norm = (a: Vec3): number =>
  Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a);
  if (n < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: a.x / n, y: a.y / n, z: a.z / n };
};

export const mid = (a: Vec3, b: Vec3): Vec3 => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
});

/** Angle in degrees between two vectors a and b. Clamped for numerical safety. */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const na = norm(a);
  const nb = norm(b);
  if (na < 1e-9 || nb < 1e-9) return 0;
  const c = Math.max(-1, Math.min(1, dot(a, b) / (na * nb)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Signed angle between two vectors projected onto plane perpendicular to `axis`. */
export function signedAngleDeg(a: Vec3, b: Vec3, axis: Vec3): number {
  const ax = normalize(axis);
  const ap = sub(a, scale(ax, dot(a, ax)));
  const bp = sub(b, scale(ax, dot(b, ax)));
  const unsigned = angleBetweenDeg(ap, bp);
  const sign = Math.sign(dot(cross(ap, bp), ax));
  return unsigned * (sign === 0 ? 1 : sign);
}
