import type { Profile } from '../catalog/types';

/**
 * Contour exact de la section d'un profil, dans le repère local de la barre :
 * `y` = largeur, `z` = hauteur, ORIGINE AU CENTRE DE GRAVITÉ.
 *
 * Ce contour sert deux fois : à l'extrusion 3D et au tracé des sections sur
 * les plans. Une seule géométrie pour les deux, donc aucune divergence possible
 * entre ce qu'on voit à l'écran et ce qui est imprimé.
 */
export interface Pt2 {
  readonly y: number;
  readonly z: number;
}

export interface SectionOutline {
  /** Contour extérieur, sens trigonométrique (aire signée positive). */
  readonly outer: readonly Pt2[];
  /** Contours intérieurs (vides des tubes), sens horaire. */
  readonly holes: readonly (readonly Pt2[])[];
}

const pt = (y: number, z: number): Pt2 => ({ y, z });

/**
 * Points d'un arc, du premier angle au second (radians), le point de départ
 * EXCLU : il est déjà produit par le segment précédent.
 */
function arc(cy: number, cz: number, r: number, a0: number, a1: number, seg: number): Pt2[] {
  const out: Pt2[] = [];
  for (let i = 1; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    out.push(pt(cy + r * Math.cos(a), cz + r * Math.sin(a)));
  }
  return out;
}

/** Cercle complet, sens trigonométrique si `sens` vaut +1. */
function circle(r: number, seg: number, sens: 1 | -1): Pt2[] {
  const out: Pt2[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (sens * 2 * Math.PI * i) / seg;
    out.push(pt(r * Math.cos(a), r * Math.sin(a)));
  }
  return out;
}

/** Rectangle à coins arrondis centré sur l'origine, sens trigonométrique. */
function roundedRect(b: number, h: number, r: number, seg: number): Pt2[] {
  const y = b / 2;
  const z = h / 2;
  const rr = Math.min(r, y, z);
  if (rr <= 0) return [pt(y, -z), pt(y, z), pt(-y, z), pt(-y, -z)];
  const HP = Math.PI / 2;
  const p: Pt2[] = [pt(y - rr, -z)];
  p.push(...arc(y - rr, -z + rr, rr, -HP, 0, seg)); // coin bas-droit
  p.push(pt(y, z - rr));
  p.push(...arc(y - rr, z - rr, rr, 0, HP, seg)); // coin haut-droit
  p.push(pt(-y + rr, z));
  p.push(...arc(-y + rr, z - rr, rr, HP, Math.PI, seg)); // coin haut-gauche
  p.push(pt(-y, -z + rr));
  p.push(...arc(-y + rr, -z + rr, rr, Math.PI, 1.5 * Math.PI, seg)); // coin bas-gauche
  return p;
}

/** Aire signée d'un polygone (positive si sens trigonométrique). */
export function polygonArea(p: readonly Pt2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as Pt2;
    const b = p[(i + 1) % p.length] as Pt2;
    s += a.y * b.z - b.y * a.z;
  }
  return s / 2;
}

/** Retourne le polygone si son sens n'est pas celui attendu. */
function orient(p: Pt2[], trigo: boolean): Pt2[] {
  const positif = polygonArea(p) > 0;
  return positif === trigo ? p : [...p].reverse();
}

/**
 * Contour d'un profil.
 * @param seg nombre de segments par quart de congé (qualité du tracé)
 */
export function sectionOutline(p: Profile, seg = 6): SectionOutline {
  switch (p.shape) {
    case 'I':
      return { outer: orient(outlineI(p.h, p.b, p.tw, p.tf, p.r, seg), true), holes: [] };
    case 'U':
      // Les UPN ont des ailes inclinées à 8 %, les UPE des ailes parallèles.
      return {
        outer: orient(
          outlineU(p.h, p.b, p.tw, p.tf, p.r, p.cy, seg, p.family === 'UPN' ? 0.08 : 0),
          true,
        ),
        holes: [],
      };
    case 'L':
      return { outer: orient(outlineL(p.a, p.a2, p.t, p.r, p.cy, p.cz, seg), true), holes: [] };
    case 'CHS': {
      const n = Math.max(16, seg * 6);
      return { outer: circle(p.d / 2, n, 1), holes: [circle(p.d / 2 - p.t, n, -1)] };
    }
    case 'BOX': {
      const outer = orient(roundedRect(p.b, p.h, p.ro, seg), true);
      const inner = orient(roundedRect(p.b - 2 * p.t, p.h - 2 * p.t, p.ri, seg), false);
      return { outer, holes: [inner] };
    }
    case 'RECT': {
      const y = p.b / 2;
      const z = p.t / 2;
      return { outer: [pt(y, -z), pt(y, z), pt(-y, z), pt(-y, -z)], holes: [] };
    }
    case 'ROND':
      return { outer: circle(p.d / 2, Math.max(12, seg * 4), 1), holes: [] };
    case 'Z':
    case 'C':
      return { outer: orient(outlineFroid(p.shape, p, p.cy, p.cz), true), holes: [] };
  }
}

/**
 * Contour d'un profil formé à froid, Z ou C à lèvres.
 *
 * ⚠ Plis VIFS, sans arrondi. Ce n'est pas une approximation de confort : c'est
 * exactement la géométrie sur laquelle le catalogue calcule aire et inerties
 * (EN 1993-1-3 § 5.1(3)). Arrondir ici, et pas là, ferait un dessin qui ne
 * décrit plus la section calculée — sur une tôle de 2 mm l'arrondi est de toute
 * façon invisible au trait.
 *
 * ⚠ Les deux ailes d'un Z partent en sens OPPOSÉS. Un Z dessiné comme un C
 * donnerait une section symétrique : le dessin cesserait de montrer pourquoi ces
 * pannes s'emboîtent au droit des appuis.
 */
function outlineFroid(
  forme: 'Z' | 'C',
  d: { h: number; aile: number; aile2: number; c: number; t: number },
  cy: number,
  cz: number,
): Pt2[] {
  const { h, aile: b, aile2: b2, c, t } = d;
  const q = (y: number, z: number): Pt2 => pt(y - cy, z - cz);

  const bas = [
    q(0, 0),
    q(b, 0),
    q(b, c),
    q(b - t, c),
    q(b - t, t),
    q(t, t),
  ];

  if (forme === 'C') {
    return [
      ...bas,
      q(t, h - t),
      q(b - t, h - t),
      q(b - t, h - c),
      q(b, h - c),
      q(b, h),
      q(0, h),
    ];
  }
  return [
    ...bas,
    q(t, h),
    q(t - b2, h),
    q(t - b2, h - c),
    q(2 * t - b2, h - c),
    q(2 * t - b2, h - t),
    q(0, h - t),
  ];
}

/** Profil en I : deux semelles, une âme, quatre congés de raccordement. */
function outlineI(h: number, b: number, tw: number, tf: number, r: number, seg: number): Pt2[] {
  const y = b / 2;
  const z = h / 2;
  const w = tw / 2;
  const zi = z - tf; // face intérieure des semelles
  const HP = Math.PI / 2;
  const p: Pt2[] = [pt(y, -z), pt(y, -zi), pt(w + r, -zi)];
  p.push(...arc(w + r, -zi + r, r, -HP, -Math.PI, seg)); // congé bas-droit
  p.push(pt(w, zi - r));
  p.push(...arc(w + r, zi - r, r, Math.PI, HP, seg)); // congé haut-droit
  p.push(pt(y, zi), pt(y, z), pt(-y, z), pt(-y, zi), pt(-(w + r), zi));
  p.push(...arc(-(w + r), zi - r, r, HP, 0, seg)); // congé haut-gauche
  p.push(pt(-w, -zi + r));
  p.push(...arc(-(w + r), -zi + r, r, 0, -HP, seg)); // congé bas-gauche
  p.push(pt(-y, -zi), pt(-y, -z));
  return p;
}

/**
 * Profil en U, dos (âme) tourné vers les y négatifs.
 *
 * `pente` est l'inclinaison de la face INTÉRIEURE des ailes : 0 pour un UPE
 * (ailes parallèles), 0,08 pour un UPN (ailes inclinées à 8 %, DIN 1026-1).
 *
 * Convention de l'épaisseur d'aile sur les profils à ailes inclinées : `tf` est
 * mesurée à mi-débord de l'aile. L'inclinaison pivote donc autour de ce point,
 * ce qui laisse l'aire de l'aile égale à `tf × débord` — la pente épaissit le
 * pied de l'aile exactement autant qu'elle amincit son bout.
 */
function outlineU(
  h: number,
  b: number,
  tw: number,
  tf: number,
  r: number,
  cy: number,
  seg: number,
  pente: number,
): Pt2[] {
  const y0 = -cy; // dos de l'âme
  const y1 = b - cy; // bout des ailes
  const z = h / 2;
  const yMid = y0 + tw + (b - tw) / 2; // mi-débord de l'aile
  /** Altitude de la face intérieure de l'aile, à l'abscisse `y`. */
  const zi = (y: number): number => z - tf + pente * (y - yMid);

  const yRacine = y0 + tw + r;
  const HP = Math.PI / 2;
  const p: Pt2[] = [pt(y0, -z), pt(y1, -z), pt(y1, -zi(y1)), pt(yRacine, -zi(yRacine))];
  p.push(...arc(y0 + tw + r, -zi(yRacine) + r, r, -HP, -Math.PI, seg));
  p.push(pt(y0 + tw, zi(yRacine) - r));
  p.push(...arc(y0 + tw + r, zi(yRacine) - r, r, Math.PI, HP, seg));
  p.push(pt(yRacine, zi(yRacine)), pt(y1, zi(y1)), pt(y1, z), pt(y0, z));
  return p;
}

/** Cornière : grande aile `a` dressée selon z, petite aile `a2` couchée selon y. */
function outlineL(a: number, a2: number, t: number, r: number, cy: number, cz: number, seg: number): Pt2[] {
  const y0 = -cy;
  const z0 = -cz;
  const HP = Math.PI / 2;
  const p: Pt2[] = [pt(y0, z0), pt(y0 + a2, z0), pt(y0 + a2, z0 + t), pt(y0 + t + r, z0 + t)];
  p.push(...arc(y0 + t + r, z0 + t + r, r, -HP, -Math.PI, seg)); // congé de raccordement
  p.push(pt(y0 + t, z0 + a), pt(y0, z0 + a));
  return p;
}
