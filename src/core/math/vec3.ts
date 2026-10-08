/** Vecteur 3D immuable. Repère : X = longueur du bâtiment, Y = largeur (portée), Z = vertical. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export const ZERO: Vec3 = v3(0, 0, 0);
export const EX: Vec3 = v3(1, 0, 0);
export const EY: Vec3 = v3(0, 1, 0);
export const EZ: Vec3 = v3(0, 0, 1);

export function add(a: Vec3, b: Vec3): Vec3 {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(a: Vec3, k: number): Vec3 {
  return v3(a.x * k, a.y * k, a.z * k);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Normalise ; renvoie le vecteur nul si la norme est négligeable. */
export function normalize(a: Vec3): Vec3 {
  const n = length(a);
  return n === 0 ? ZERO : scale(a, 1 / n);
}

/** Interpolation linéaire, t ∈ [0,1]. */
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

/** Rotation d'un vecteur autour d'un axe unitaire (formule de Rodrigues). */
export function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const k = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/**
 * Direction « hauteur de section » par défaut pour un axe donné : on prend
 * l'axe global le moins aligné avec la barre, puis on l'orthogonalise. Garantit
 * un repère stable même pour une barre quelconque.
 */
export function defaultUp(ax: Vec3): Vec3 {
  const a = normalize(ax);
  const candidats: Vec3[] = [EZ, EY, EX];
  let meilleur = EZ;
  let min = Infinity;
  for (const c of candidats) {
    const alignement = Math.abs(dot(a, c));
    if (alignement < min) {
      min = alignement;
      meilleur = c;
    }
  }
  return normalize(sub(meilleur, scale(a, dot(meilleur, a))));
}

/** Angle non signé entre deux vecteurs (radians). */
export function angleBetween(a: Vec3, b: Vec3): number {
  const na = normalize(a);
  const nb = normalize(b);
  const d = Math.min(1, Math.max(-1, dot(na, nb)));
  return Math.acos(d);
}
