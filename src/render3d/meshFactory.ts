import * as THREE from 'three';
import { contourDeTrou } from '../core/geometry/holes';
import { contourJarret } from '../core/build/jarret';
import { getProfile } from '../core/catalog/index';
import type { Haunch, Plate } from '../core/build/types';
import {
  fibreAbscissa,
  memberFrame,
  sectionPointAt,
  type Member,
  type MemberFrame,
} from '../core/geometry/member';
import { sectionOutline, type Pt2 } from '../core/geometry/section';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../core/math/vec3';

/**
 * Fabrication des maillages 3D.
 *
 * Le solide n'est pas une approximation : le contour exact de la section est
 * transporté le long de la barre, puis chaque fibre est arrêtée sur son plan de
 * coupe. Les abouts obtenus sont donc rigoureusement les coupes qui seront
 * cotées sur les plans de débit — ce qu'on voit à l'écran est la pièce.
 */

const v = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);

/**
 * Angle au-delà duquel une arête du contour reste VIVE (degrés).
 *
 * ⚠ C'est ce seuil qui fait la différence entre un congé de raccordement rond et
 * un congé à six facettes. Les normales calculées face par face donnent un
 * arrondi anguleux, visible dès qu'on s'approche ; les moyenner partout
 * arrondirait au contraire les angles droits des semelles, et le profilé
 * ressemblerait à du plastique. On ne lisse donc que là où le contour tourne
 * doucement — exactement les arcs.
 */
const ANGLE_VIF = 35;

/** Maillage d'une barre prismatique, abouts compris. */
export function memberGeometry(m: Member, seg = 8): THREE.BufferGeometry {
  const profile = getProfile(m.profileId);
  const outline = sectionOutline(profile, seg);
  const f = memberFrame(m);

  const positions: number[] = [];
  const normals: number[] = [];
  const anneaux: readonly (readonly Pt2[])[] = [outline.outer, ...outline.holes];

  // Une section en miroir rend le repère indirect : le sens de parcours des
  // contours s'inverse dans l'espace, il faut retourner les faces pour que les
  // normales continuent de sortir du métal.
  const inverse = m.mirrored;

  // --- Faces latérales : un bandeau de quadrilatères par anneau ---
  for (const [i, anneau] of anneaux.entries()) {
    const exterieur = (i === 0) !== inverse;
    const n2 = normalesDeContour(anneau);

    for (let k = 0; k < anneau.length; k++) {
      const j = (k + 1) % anneau.length;
      const a = anneau[k] as Pt2;
      const b = anneau[j] as Pt2;
      const a0 = bout(f, m, a, 'start');
      const a1 = bout(f, m, a, 'end');
      const b0 = bout(f, m, b, 'start');
      const b1 = bout(f, m, b, 'end');
      // Normales de l'arête courante : celle du départ et celle de l'arrivée,
      // lissées ou non selon l'angle que fait le contour à chaque sommet.
      const na = en3d(f, n2[k]?.[1] as Pt2);
      const nb = en3d(f, n2[j]?.[0] as Pt2);

      // Le sens de parcours des vides est déjà inversé : la normale sort du métal.
      if (exterieur) pushQuadN(positions, normals, [a0, b0, b1, a1], [na, nb, nb, na]);
      else pushQuadN(positions, normals, [b0, a0, a1, b1], [nb, na, na, nb]);
    }
  }

  // --- Abouts : triangulation du contour troué, posée sur chaque plan de coupe ---
  const contour = outline.outer.map((p) => new THREE.Vector2(p.y, p.z));
  const trous = outline.holes.map((t) => t.map((p) => new THREE.Vector2(p.y, p.z)));
  const faces = THREE.ShapeUtils.triangulateShape(contour, trous);
  const tousPoints: Pt2[] = [...outline.outer, ...outline.holes.flat()];

  // La face d'about est plane : sa normale est celle du plan de coupe.
  const nDebut = v(m.cutStart.normal);
  const nFin = v(m.cutEnd.normal);

  for (const [i0, i1, i2] of faces) {
    const p0 = tousPoints[i0 as number] as Pt2;
    const p1 = tousPoints[i1 as number] as Pt2;
    const p2 = tousPoints[i2 as number] as Pt2;
    const [a, b] = inverse ? [p1, p2] : [p2, p1];
    pushTriN(
      positions,
      normals,
      [bout(f, m, p0, 'start'), bout(f, m, a, 'start'), bout(f, m, b, 'start')],
      nDebut,
    );
    pushTriN(
      positions,
      normals,
      [bout(f, m, p0, 'end'), bout(f, m, b, 'end'), bout(f, m, a, 'end')],
      nFin,
    );
  }

  return depuisPositionsEtNormales(positions, normals);
}

/**
 * Pour chaque sommet du contour, la normale À GAUCHE et À DROITE de ce sommet.
 *
 * Elles sont égales — donc lissées — quand les deux arêtes voisines font un
 * angle faible : c'est le cas sur un arc. Elles restent distinctes sur une arête
 * vive, ce qui préserve les angles droits.
 */
function normalesDeContour(anneau: readonly Pt2[]): [Pt2, Pt2][] {
  const n = anneau.length;
  const seuil = Math.cos((ANGLE_VIF * Math.PI) / 180);

  // Normale sortante de chaque arête i → i+1 : pour un anneau parcouru dans le
  // bon sens, c'est (dz, −dy) normalisé.
  const aretes: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const a = anneau[i] as Pt2;
    const b = anneau[(i + 1) % n] as Pt2;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const l = Math.hypot(dy, dz) || 1;
    aretes.push({ y: dz / l, z: -dy / l });
  }

  return anneau.map((_, i) => {
    const avant = aretes[(i - 1 + n) % n] as Pt2;
    const apres = aretes[i] as Pt2;
    const cos = avant.y * apres.y + avant.z * apres.z;
    if (cos < seuil) return [avant, apres]; // arête vive : deux normales
    const my = avant.y + apres.y;
    const mz = avant.z + apres.z;
    const l = Math.hypot(my, mz) || 1;
    const moyenne = { y: my / l, z: mz / l };
    return [moyenne, moyenne]; // arc : une seule, partagée
  });
}

/** Normale de section portée dans l'espace par le repère de la barre. */
function en3d(f: MemberFrame, n: Pt2): THREE.Vector3 {
  return new THREE.Vector3(
    f.ay.x * n.y + f.az.x * n.z,
    f.ay.y * n.y + f.az.y * n.z,
    f.ay.z * n.y + f.az.z * n.z,
  ).normalize();
}

/** Point du solide : la fibre passant par `p`, arrêtée sur le plan de coupe demandé. */
function bout(f: MemberFrame, m: Member, p: Pt2, cote: 'start' | 'end'): THREE.Vector3 {
  const plan = cote === 'start' ? m.cutStart : m.cutEnd;
  const s = fibreAbscissa(f, m.start, plan, p);
  return v(sectionPointAt(f, m.start, s, p));
}

/**
 * Maillage d'un jarret : le triangle d'âme et la semelle inférieure suivant
 * l'hypoténuse, tous deux découpés dans le profil de la traverse.
 */
export function haunchGeometry(h: Haunch, _hauteurTraverse?: number): THREE.BufferGeometry {
  const profile = getProfile(h.profileId);
  if (profile.shape !== 'I') return new THREE.BufferGeometry();

  /*
   * ⚠ La forme vient de `contourJarret`, la seule définition du jarret : la vue
   * 3D la recalculait à sa façon — hauteur perpendiculaire à la traverse —,
   * quand les plans la prenaient d'aplomb. Deux jarrets différents pour la même
   * pièce.
   */
  const c = contourJarret(h);
  const ax = normalize(sub(c.pointe, c.haut));
  const versBas = sub(c.bas, c.haut);
  const az = normalize(sub(versBas, scale(ax, dot(versBas, ax))));
  const ay = cross(az, ax);
  const L = Math.hypot(c.pointe.x - c.haut.x, c.pointe.y - c.haut.y, c.pointe.z - c.haut.z);
  const bas = { s: dot(versBas, ax), d: dot(versBas, az) };

  const positions: number[] = [];
  // Âme : le triangle, épaisseur tw.
  pousserPrisme(positions, [{ s: 0, d: 0 }, bas, { s: L, d: 0 }], c.haut, ax, ay, az, profile.tw);

  // Semelle : plaque suivant l'hypoténuse, largeur b, épaisseur tf, côté extérieur.
  const dir = { s: L - bas.s, d: -bas.d };
  const norme = Math.hypot(dir.s, dir.d);
  const nx = { s: -dir.d / norme, d: dir.s / norme };
  const exterieur = nx.d >= 0 ? nx : { s: -nx.s, d: -nx.d };
  const e = profile.tf;
  pousserPrisme(
    positions,
    [
      bas,
      { s: bas.s + exterieur.s * e, d: bas.d + exterieur.d * e },
      { s: L + exterieur.s * e, d: exterieur.d * e },
      { s: L, d: 0 },
    ],
    c.haut,
    ax,
    ay,
    az,
    profile.b,
  );

  return fromPositions(positions);
}

/**
 * Prisme droit : un polygone tracé dans le plan (s le long de `ax`,
 * d le long de `az`), extrudé de `epaisseur` centrée sur `ay`.
 */
function pousserPrisme(
  out: number[],
  poly: readonly { s: number; d: number }[],
  origine: Vec3,
  ax: Vec3,
  ay: Vec3,
  az: Vec3,
  epaisseur: number,
): void {
  const point = (p: { s: number; d: number }, cote: 1 | -1): THREE.Vector3 =>
    v(
      add(
        add(origine, scale(ax, p.s)),
        add(scale(az, p.d), scale(ay, (cote * epaisseur) / 2)),
      ),
    );

  const A = poly.map((p) => point(p, -1));
  const B = poly.map((p) => point(p, 1));

  // Deux faces planes, en éventail depuis le premier sommet.
  for (let i = 1; i < poly.length - 1; i++) {
    pushTri(out, A[0] as THREE.Vector3, A[i + 1] as THREE.Vector3, A[i] as THREE.Vector3);
    pushTri(out, B[0] as THREE.Vector3, B[i] as THREE.Vector3, B[i + 1] as THREE.Vector3);
  }
  // Bandeau de chant.
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    pushQuad(
      out,
      A[i] as THREE.Vector3,
      A[j] as THREE.Vector3,
      B[j] as THREE.Vector3,
      B[i] as THREE.Vector3,
    );
  }
}

function pushTri(out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

function pushQuad(
  out: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
): void {
  pushTri(out, a, b, c);
  pushTri(out, a, c, d);
}

/** Un sommet : sa position et SA normale, poussés ensemble. */
function pushSommet(pos: number[], nor: number[], p: THREE.Vector3, n: THREE.Vector3): void {
  pos.push(p.x, p.y, p.z);
  nor.push(n.x, n.y, n.z);
}

/** Triangle à normale unique (face plane). */
function pushTriN(
  pos: number[],
  nor: number[],
  [a, b, c]: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  n: THREE.Vector3,
): void {
  pushSommet(pos, nor, a, n);
  pushSommet(pos, nor, b, n);
  pushSommet(pos, nor, c, n);
}

/** Quadrilatère dont chaque sommet porte sa propre normale. */
function pushQuadN(
  pos: number[],
  nor: number[],
  [a, b, c, d]: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  [na, nb, nc, nd]: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
): void {
  pushSommet(pos, nor, a, na);
  pushSommet(pos, nor, b, nb);
  pushSommet(pos, nor, c, nc);
  pushSommet(pos, nor, a, na);
  pushSommet(pos, nor, c, nc);
  pushSommet(pos, nor, d, nd);
}

function depuisPositionsEtNormales(positions: number[], normals: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.computeBoundingSphere();
  return g;
}

function fromPositions(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Maillage d'une tôle d'assemblage : son contour extrudé sur son épaisseur, les
 * perçages réellement évidés. Ce qui est à l'écran est ce qui sera découpé.
 */
export function plateGeometry(pl: Plate, seg = 16): THREE.BufferGeometry {
  // Repère de la tôle, ré-orthonormé : `u` sa largeur, `w` sa hauteur,
  // `n` sa normale — donc son épaisseur.
  const u = normalize(pl.u);
  const w = normalize(sub(pl.v, scale(u, dotV(pl.v, u))));
  const n = cross(u, w);
  const demi = pl.thickness / 2;

  const en3d = (p: Pt2, cote: 1 | -1): THREE.Vector3 =>
    new THREE.Vector3(
      pl.origin.x + u.x * p.y + w.x * p.z + n.x * cote * demi,
      pl.origin.y + u.y * p.y + w.y * p.z + n.y * cote * demi,
      pl.origin.z + u.z * p.y + w.z * p.z + n.z * cote * demi,
    );

  const trousContours = pl.holes.map((h) => contourDeTrou(h, seg));
  const anneaux: readonly (readonly Pt2[])[] = [pl.outline, ...trousContours];

  const positions: number[] = [];
  for (const [i, anneau] of anneaux.entries()) {
    const exterieur = i === 0;
    for (let k = 0; k < anneau.length; k++) {
      const a = anneau[k] as Pt2;
      const b = anneau[(k + 1) % anneau.length] as Pt2;
      const a0 = en3d(a, -1);
      const a1 = en3d(a, 1);
      const b0 = en3d(b, -1);
      const b1 = en3d(b, 1);
      if (exterieur) pushQuad(positions, a0, b0, b1, a1);
      else pushQuad(positions, b0, a0, a1, b1);
    }
  }

  const contour = pl.outline.map((p) => new THREE.Vector2(p.y, p.z));
  const trous = trousContours.map((t) => t.map((p) => new THREE.Vector2(p.y, p.z)));
  const faces = THREE.ShapeUtils.triangulateShape(contour, trous);
  const tous: Pt2[] = [...pl.outline, ...trousContours.flat()];
  for (const [i0, i1, i2] of faces) {
    const p0 = tous[i0 as number] as Pt2;
    const p1 = tous[i1 as number] as Pt2;
    const p2 = tous[i2 as number] as Pt2;
    pushTri(positions, en3d(p0, -1), en3d(p2, -1), en3d(p1, -1));
    pushTri(positions, en3d(p0, 1), en3d(p1, 1), en3d(p2, 1));
  }
  return fromPositions(positions);
}

/** Contour circulaire, sens horaire : c'est un vide. */
function dotV(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Arêtes vives, pour lire la structure sans dépendre de l'éclairage. */
export function edgesOf(g: THREE.BufferGeometry, seuilDeg = 25): THREE.BufferGeometry {
  return new THREE.EdgesGeometry(g, seuilDeg);
}

/* ------------------------------------------------------------------ */
/* Boulonnerie                                                         */
/* ------------------------------------------------------------------ */

/**
 * Géométries de base d'un boulon, orientées selon +Z, rayon et hauteur unitaires.
 *
 * Elles sont INSTANCIÉES : un bâtiment courant compte cinq cents boulons, et
 * autant de maillages distincts coûterait plus cher que toute l'ossature. Trois
 * appels de dessin suffisent — les têtes, les tiges, les écrous.
 */
export function boltPartGeometries(): {
  tete: THREE.BufferGeometry;
  tige: THREE.BufferGeometry;
  ecrou: THREE.BufferGeometry;
} {
  return { tete: hexagone(), tige: cylindre(16), ecrou: hexagone() };
}

/** Prisme hexagonal, base en z = 0, sommet en z = 1, circonscrit au rayon 1. */
function hexagone(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
  // `CylinderGeometry` est dressée selon Y et centrée : on la redresse selon Z,
  // base à l'origine, pour que la matrice d'instance n'ait plus qu'à placer.
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}

/** Cylindre, base en z = 0, sommet en z = 1, rayon 1. */
function cylindre(segments: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, segments, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}

/**
 * Matrices d'instance d'un boulon : tête, tige, écrou.
 *
 * Proportions de la visserie métrique ISO, sur le diamètre NOMINAL et non sur
 * celui du trou : entreplat 1,5 d, hauteur de tête 0,65 d, hauteur d'écrou
 * 0,8 d. Une tige du diamètre du perçage bouchait le trou ; dessinée à son
 * diamètre, elle laisse voir le jeu — c'est à cela qu'on reconnaît qu'un boulon
 * est DANS son trou.
 */
export function boltMatrices(b: {
  at: Vec3;
  axis: Vec3;
  d: number;
  grip: number;
  /** Diamètre nominal de la tige (mm). */
  nominal: number;
}): { tete: THREE.Matrix4; tige: THREE.Matrix4; ecrou: THREE.Matrix4 } {
  const axe = new THREE.Vector3(b.axis.x, b.axis.y, b.axis.z).normalize();
  const at = new THREE.Vector3(b.at.x, b.at.y, b.at.z);
  // Hexagone circonscrit : sur les angles, l'entreplat divisé par cos 30°.
  const rayonTete = (1.5 * b.nominal) / 2 / Math.cos(Math.PI / 6);
  const hTete = 0.65 * b.nominal;
  const hEcrou = 0.8 * b.nominal;

  // La tête s'appuie sur la face et DÉPASSE vers l'extérieur : elle part du
  // point d'appui en remontant à contre-sens de la tige.
  const tete = placer(at, axe.clone().negate(), rayonTete, hTete);
  const tige = placer(at, axe, b.nominal / 2, b.grip + hEcrou);
  const ecrou = placer(at.clone().addScaledVector(axe, b.grip), axe, rayonTete, hEcrou);
  return { tete, tige, ecrou };
}

/**
 * Matrice d'un perçage de barre : un cylindre fermé du diamètre du trou, à
 * peine plus long que la paroi est épaisse. Ses deux fonds affleurent les faces
 * et s'y lisent comme l'ouverture du trou.
 */
export function matriceDePercage(t: { centre: Vec3; axe: Vec3; d: number; epaisseur: number }): THREE.Matrix4 {
  const axe = new THREE.Vector3(t.axe.x, t.axe.y, t.axe.z).normalize();
  const h = t.epaisseur + 0.6;
  const base = new THREE.Vector3(t.centre.x, t.centre.y, t.centre.z).addScaledVector(axe, -h / 2);
  return placer(base, axe, t.d / 2, h);
}

/** Cylindre FERMÉ, base en z = 0, sommet en z = 1, rayon 1 : un perçage. */
export function percageGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 20, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}

/** Matrice plaçant une géométrie unitaire +Z à `base`, dirigée selon `dir`. */
function placer(base: THREE.Vector3, dir: THREE.Vector3, rayon: number, hauteur: number): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  return new THREE.Matrix4().compose(base, q, new THREE.Vector3(rayon, rayon, hauteur));
}
