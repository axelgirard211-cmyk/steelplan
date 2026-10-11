import * as THREE from 'three';
import { getProfile } from '../core/catalog/index';
import { cordonsDAttache } from '../core/build/connections/chevetres';
import { fenteDuPlat } from '../core/build/connections/contreventement';
import type { Plate, StructuralModel } from '../core/build/types';
import { fibreAbscissa, memberFrame, sectionPointAt, type Member } from '../core/geometry/member';
import { sectionOutline, type Pt2 } from '../core/geometry/section';
import type { Vec3 } from '../core/math/vec3';
import { contourJarret } from '../core/build/jarret';

/**
 * CORDONS DE SOUDURE EN 3D.
 *
 * ⚠ Un assemblage se lit à ses boulons OU à ses soudures. Le modèle porte cent
 * mètres de cordon — les platines d'about, les platines de pied — et ils étaient
 * invisibles à l'écran : une platine paraissait simplement posée contre l'about
 * de la poutre, sans que rien ne dise ce qui l'y tient.
 *
 * La géométrie n'est pas inventée : chaque cordon est reconstruit depuis les
 * pièces qu'il assemble. Une tôle d'about se soude sur le POURTOUR du profil, au
 * droit de la platine ; un jarret par deux cordons le long de son âme ; une
 * échantignolle par deux cordons au pied de son aile dressée.
 */

/** Rapport entre le côté du triangle du cordon et sa gorge : côté = a·√2. */
const COTE_SUR_GORGE = Math.SQRT2;

/**
 * Un seul maillage pour tous les cordons du bâtiment.
 *
 * Renvoie `null` quand il n'y a rien à souder — le modèle peut n'avoir aucune
 * tôle si les assemblages sont désactivés.
 */
export function weldBeadGeometry(model: StructuralModel, seg = 6): THREE.BufferGeometry | null {
  const barres = new Map(model.members.map((m) => [m.id, m]));
  const toles = new Map(model.plates.map((pl) => [pl.id, pl]));
  const jarrets = new Map(model.haunches.map((h) => [h.id, h]));
  const positions: number[] = [];
  const normals: number[] = [];
  const rendus: string[] = [];
  const platinesCernees = new Set<string>();

  for (const w of model.welds) {
    if (w.throat <= 0) continue;
    const [a, b] = w.between;
    const cote = w.throat * COTE_SUR_GORGE;
    const barre = barres.get(a) ?? barres.get(b);
    const tole = toles.get(a) ?? toles.get(b);
    const jarret = jarrets.get(a) ?? jarrets.get(b);

    if (jarret) {
      /*
       * Jarret : deux cordons le long de son âme, sous la semelle de la
       * traverse — ou d'aplomb contre la platine pour le cordon de racine.
       */
      const c = contourJarret(jarret);
      const profil = getProfile(jarret.profileId);
      const lateral = normaliser(produit(sub(c.pointe, c.haut), sub(c.bas, c.haut)));
      const [p0, p1, contre] = tole
        ? [c.haut, c.bas, normaliser(sub(c.pointe, c.haut))]
        : [c.haut, c.pointe, normaliser(sub(c.bas, c.haut))];
      deuxCordons(positions, normals, p0, p1, lateral, profil.shape === 'I' ? profil.tw / 2 : 4, contre, cote);
      rendus.push(w.id);
      continue;
    }
    /*
     * Gousset soudé par un BORD — sur une âme, sous une semelle ou sous une
     * platine : deux cordons le long de ce bord, un sur chaque face. ⚠ Le tracer
     * comme une platine d'about posait un pourtour de profil autour du poteau.
     */
    const gousset = [toles.get(b), toles.get(a)].find((x) => x?.kind === 'gousset-cv' || x?.kind === 'gousset-tete');
    if (gousset) {
      const { u, w: v, n } = repereDeTole(gousset);
      const ys = gousset.outline.filter((q) => Math.abs(q.z) < 0.5).map((q) => q.y);
      const p0 = add3(gousset.origin, scale3(u, Math.min(...ys)));
      const p1 = add3(gousset.origin, scale3(u, Math.max(...ys)));
      deuxCordons(positions, normals, p0, p1, n, gousset.thickness / 2, v, cote);
      rendus.push(w.id);
      continue;
    }
    // Plat d'attache de chevêtre : à recouvrement sur la semelle du montant.
    if (barre && tole?.kind === 'attache-lisse') {
      for (const ar of cordonsDAttache(tole, barre).aretes) {
        const n = normaliser(produit(tole.u, tole.v));
        const versMontant = Math.sign(n.x * (barre.start.x - tole.origin.x) + n.y * (barre.start.y - tole.origin.y)) || 1;
        deuxCordons(positions, normals, ar.a, ar.b, ar.dehors, 0, scale3(n, -versMontant), cote);
      }
      rendus.push(w.id);
      continue;
    }
    // Plat d'about de tube : sur chaque lèvre de la fente, des deux côtés du plat.
    if (barre && tole?.kind === 'plat-tube') {
      const { u, w: v, n } = repereDeTole(tole);
      const ys = tole.outline.map((q) => q.y);
      const fond = Math.max(...ys);
      const engage = fenteDuPlat(barre, tole).longueur;
      const levre = (w.id.endsWith('2') ? -1 : 1) * (getProfile(barre.profileId).h / 2);
      const le = (y: number): Vec3 => add3(add3(tole.origin, scale3(u, y)), scale3(v, levre));
      deuxCordons(positions, normals, le(fond - engage), le(fond), n, tole.thickness / 2, scale3(v, Math.sign(levre)), cote);
      rendus.push(w.id);
      continue;
    }
    if (barre && tole) {
      // Une platine d'about porte ses cordons de semelles et d'âme : un seul
      // tour de profil les montre, à la gorge du premier — celui des semelles.
      if (!platinesCernees.has(tole.id)) poserCordon(positions, normals, barre, tole.origin, w.throat, seg);
      platinesCernees.add(tole.id);
      rendus.push(w.id);
      continue;
    }
    // Échantignolle sur son porteur : l'aile dressée, soudée par son chant.
    const piece = barres.get(b);
    const porteur = barres.get(a);
    if (piece && porteur) {
      const f = memberFrame(piece);
      const profil = getProfile(piece.profileId);
      if (profil.shape !== 'L') continue;
      // L'aile dressée est à y = −cy (dos) … −cy + t, son chant en z = a − cz.
      const yAile = -profil.cy + profil.t / 2;
      const zChant = profil.a - profil.cz;
      const pied = (s: number): Vec3 => sectionPointAt(f, piece.start, s, { y: yAile, z: zChant });
      const l = Math.hypot(piece.end.x - piece.start.x, piece.end.y - piece.start.y, piece.end.z - piece.start.z);
      // Le long de l'aile, vers son milieu : c'est l'opposé de la direction du chant.
      const versLAile = scale3(f.az, -1);
      deuxCordons(positions, normals, pied(0), pied(l), f.ay, profil.t / 2, versLAile, cote);
      rendus.push(w.id);
    }
  }

  if (positions.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.computeBoundingSphere();
  // Les cordons effectivement tracés : un cordon du modèle qu'aucune branche ne
  // saurait dessiner se voit ici, au lieu de disparaître de l'écran.
  g.userData.cordons = rendus;
  return g;
}

/**
 * Deux cordons d'angle de part et d'autre d'une paroi d'épaisseur 2·`demi`,
 * le long du segment p0 → p1 posé sur la pièce porteuse. Chaque cordon a un
 * côté contre la porteuse (vers l'extérieur de la paroi) et un côté contre la
 * paroi (direction `lePongDeLaParoi`).
 */
function deuxCordons(
  positions: number[],
  normals: number[],
  p0: Vec3,
  p1: Vec3,
  lateral: Vec3,
  demi: number,
  lePongDeLaParoi: Vec3,
  cote: number,
): void {
  for (const signe of [1, -1]) {
    const decal = scale3(lateral, signe * demi);
    const a0 = vec(add3(p0, decal));
    const a1 = vec(add3(p1, decal));
    const dehors = vec(scale3(lateral, signe * cote));
    const long = vec(scale3(lePongDeLaParoi, cote));
    const b0 = a0.clone().add(dehors);
    const b1 = a1.clone().add(dehors);
    const c0 = a0.clone().add(long);
    const c1 = a1.clone().add(long);
    bandeau(positions, normals, a0, a1, b1, b0);
    bandeau(positions, normals, b0, b1, c1, c0);
    bandeau(positions, normals, c0, c1, a1, a0);
  }
}

const vec = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale3 = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const produit = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const normaliser = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return scale3(a, 1 / l);
};

/**
 * Cordon d'angle faisant le tour d'une section, au droit d'une tôle.
 *
 * Section du cordon : le triangle rectangle usuel, un côté plaqué sur le flanc du
 * profil, l'autre sur la face de la tôle, l'hypoténuse à l'air libre. C'est ce
 * triangle-là que le symbole normalisé des plans désigne par sa gorge `a`.
 */
function poserCordon(
  positions: number[],
  normals: number[],
  m: Member,
  origineTole: Vec3,
  gorge: number,
  seg: number,
): void {
  const f = memberFrame(m);
  const profil = getProfile(m.profileId);
  const contour = sectionOutline(profil, seg).outer;
  if (contour.length < 3) return;

  // De quel about la tôle est-elle solidaire ? Celui dont elle est le plus près.
  const dDebut = distance(origineTole, m.start);
  const dFin = distance(origineTole, m.end);
  const cote = dDebut <= dFin ? 'start' : 'end';
  const plan = cote === 'start' ? m.cutStart : m.cutEnd;
  // La normale du plan de coupe sort de la pièce : le cordon se dépose donc en
  // reculant le long de cette normale, du côté du métal.
  const sortie = plan.normal;
  const cote3 = gorge * COTE_SUR_GORGE;

  const n2 = normalesSortantes(contour);

  for (let k = 0; k < contour.length; k++) {
    const p0 = contour[k] as Pt2;
    const p1 = contour[(k + 1) % contour.length] as Pt2;
    const t0 = triangle(f, m, plan, p0, n2[k] as Pt2, sortie, cote3);
    const t1 = triangle(f, m, plan, p1, n2[k] as Pt2, sortie, cote3);

    // Trois bandeaux : le flanc contre le profil, la face contre la tôle,
    // l'hypoténuse visible. Seule cette dernière se voit vraiment, mais fermer
    // le volume évite les faces manquantes quand on tourne autour.
    bandeau(positions, normals, t0.aPiece, t1.aPiece, t1.aTole, t0.aTole);
    bandeau(positions, normals, t0.aTole, t1.aTole, t1.sommet, t0.sommet);
    bandeau(positions, normals, t0.sommet, t1.sommet, t1.aPiece, t0.aPiece);
  }
}

/** Les trois sommets de la section du cordon, en un point du contour. */
function triangle(
  f: ReturnType<typeof memberFrame>,
  m: Member,
  plan: Member['cutStart'],
  p: Pt2,
  n: Pt2,
  sortie: Vec3,
  cote: number,
): { aPiece: THREE.Vector3; aTole: THREE.Vector3; sommet: THREE.Vector3 } {
  // Point de la surface du profil, à l'aplomb de la face de la tôle.
  const s = fibreAbscissa(f, m.start, plan, p);
  const surface = sectionPointAt(f, m.start, s, p);
  const dehors = new THREE.Vector3(
    f.ay.x * n.y + f.az.x * n.z,
    f.ay.y * n.y + f.az.y * n.z,
    f.ay.z * n.y + f.az.z * n.z,
  ).normalize();
  const recul = new THREE.Vector3(sortie.x, sortie.y, sortie.z).normalize().multiplyScalar(-cote);

  const aTole = new THREE.Vector3(surface.x, surface.y, surface.z);
  const aPiece = aTole.clone().add(recul);
  const sommet = aTole.clone().addScaledVector(dehors, cote);
  return { aPiece, aTole, sommet };
}

/** Normale sortante en chaque sommet du contour, moyennée sur les arcs. */
function normalesSortantes(contour: readonly Pt2[]): Pt2[] {
  const n = contour.length;
  const aretes: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const a = contour[i] as Pt2;
    const b = contour[(i + 1) % n] as Pt2;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const l = Math.hypot(dy, dz) || 1;
    aretes.push({ y: dz / l, z: -dy / l });
  }
  return contour.map((_, i) => {
    const avant = aretes[(i - 1 + n) % n] as Pt2;
    const apres = aretes[i] as Pt2;
    const y = avant.y + apres.y;
    const z = avant.z + apres.z;
    const l = Math.hypot(y, z) || 1;
    return { y: y / l, z: z / l };
  });
}

/** Quadrilatère à normale plane : un cordon est rugueux, il ne se lisse pas. */
function bandeau(
  pos: number[],
  nor: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
): void {
  pousserTri(pos, nor, a, b, c);
  pousserTri(pos, nor, a, c, d);
}

function pousserTri(
  pos: number[],
  nor: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): void {
  const n = new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a))
    .normalize();
  for (const p of [a, b, c]) {
    pos.push(p.x, p.y, p.z);
    nor.push(n.x, n.y, n.z);
  }
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Repère orthonormé d'une tôle : u, w dans son plan, n normale. */
function repereDeTole(pl: Plate): { u: Vec3; w: Vec3; n: Vec3 } {
  const u = normaliser(pl.u);
  const pv = sub(pl.v, scale3(u, u.x * pl.v.x + u.y * pl.v.y + u.z * pl.v.z));
  const w = normaliser(pv);
  return { u, w, n: normaliser(produit(u, w)) };
}
