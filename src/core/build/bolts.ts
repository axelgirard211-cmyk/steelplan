import { getProfile } from '../catalog/index';
import { EN_ATTENTE, type Hole } from '../geometry/holes';
import { memberFrame, sectionPointAt, type Member } from '../geometry/member';
import { sectionOutline, type Pt2 } from '../geometry/section';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../math/vec3';
import type { Plate } from './types';

/**
 * IMPLANTATION DE LA BOULONNERIE.
 *
 * ⚠ Une seule source pour TROIS usages : le comptage, le dessin 3D et la liste
 * de boulonnerie. Un boulon traverse plusieurs pièces et apparaît donc une fois
 * par pièce percée ; c'est l'alignement de ces trous qui en fait un seul.
 * Compter d'un côté et dessiner de l'autre garantirait qu'un jour la vue 3D
 * montre six cents boulons quand la nomenclature en commande cinq cent
 * quarante — et personne ne saurait lequel croire.
 */

export type BoltKind = 'boulon' | 'ancrage';

export interface BoltPlacement {
  /** Point d'appui de la TÊTE, sur la face extérieure de la première pièce. */
  readonly at: Vec3;
  /** Axe de la tige, orienté de la tête vers l'écrou. */
  readonly axis: Vec3;
  /** Diamètre de perçage (mm), jeu compris. */
  readonly d: number;
  /** Épaisseur totale serrée (mm) : ce que la tige doit traverser. */
  readonly grip: number;
  readonly kind: BoltKind;
  /** Assemblage desservi, pour la liste de boulonnerie. */
  readonly usage: string;
  /** Identifiants des pièces serrées, de la tête à l'écrou. */
  readonly pieces: readonly string[];
}

/** Un trou, vu comme un tronçon de la future tige. */
interface Occurrence {
  readonly centre: Vec3;
  readonly axe: Vec3;
  readonly epaisseur: number;
  readonly piece: string;
  readonly d: number;
  /** Nature de la tôle, ou rôle de la barre. */
  readonly nature: string;
}

const USAGES: Readonly<Record<string, string>> = {
  'platine-about': 'platines d’about',
  'platine-pied': 'platines de pied',
  gousset: 'goussets de treillis',
  eclisse: 'éclisses de continuité',
  'gousset-cv': 'contreventements',
  'plat-tube': 'contreventements',
  'gousset-tete': 'têtes de potelets',
  'attache-lisse': 'chevêtres d’ouverture',
};

/**
 * Tous les boulons du modèle, chacun une seule fois.
 *
 * ⚠⚠ Un boulon, c'est un ensemble de trous COAXIAUX traversant des pièces
 * EMPILÉES — et rien d'autre. Les règles par cas qu'on lisait ici (« trou de
 * barre appairé à une tôle ⇒ un boulon », « deux tôles face à face ⇒ un seul
 * jeu », « tôle non réclamée ⇒ tige d'ancrage ») ignoraient chacune un montage :
 * les deux cornières d'une barre double et leur gousset donnaient deux boulons
 * pour une tige, et l'éclisse de la seconde face d'âme, que nul trou ne citait,
 * était comptée… en tiges d'ancrage. Le regroupement géométrique n'a pas de cas
 * particulier, il n'en oublie donc aucun.
 *
 * C'est aussi l'UNIQUE source de la liste de boulonnerie et de la vue 3D : une
 * troisième écriture des mêmes règles vivait dans la nomenclature, et c'est
 * elle qui commandait des M12×230.
 */
export function listerBoulons(
  members: readonly Member[],
  plates: readonly Plate[],
): BoltPlacement[] {
  const occurrences: Occurrence[] = [];
  const liernes = new Set(members.filter((m) => m.role === 'lierne').map((m) => m.id));
  for (const m of members) {
    if (m.holes.length === 0) continue;
    const f = memberFrame(m);
    const profil = getProfile(m.profileId);
    for (const h of m.holes) {
      // Un trou en attente est percé, mais aucun boulon ne le traverse ; un
      // passage de lierne non plus : la lierne s'y bloque par ses écrous.
      if (h.from === EN_ATTENTE || liernes.has(h.from)) continue;
      occurrences.push({
        centre: sectionPointAt(f, m.start, h.s, milieuDeParoi(profil, h)),
        axe: h.through === 'y' ? f.ay : f.az,
        epaisseur: epaisseurParoi(profil, h),
        piece: m.id,
        d: h.d,
        nature: m.role,
      });
    }
  }
  for (const pl of plates) {
    const { u, w, n } = repereTole(pl);
    for (const h of pl.holes) {
      occurrences.push({
        centre: add(pl.origin, add(scale(u, h.at.y), scale(w, h.at.z))),
        axe: n,
        epaisseur: pl.thickness,
        piece: pl.id,
        d: h.d,
        nature: pl.kind,
      });
    }
  }

  const groupes = regrouperCoaxiaux(occurrences);
  return groupes.map((g) => placer(g));
}

/**
 * Diamètre NOMINAL d'un boulon posé, retrouvé depuis son perçage : le jeu
 * normalisé (1, 2 ou 3 mm), plus la marge des trous d'ancrage.
 */
export function diametreNominal(b: Pick<BoltPlacement, 'd' | 'kind'>): number {
  const d0 = b.kind === 'ancrage' ? b.d - 4 : b.d;
  return d0 <= 15 ? d0 - 1 : d0 <= 26 ? d0 - 2 : d0 - 3;
}

/** Perçage d'une barre, situé dans l'espace : pour le montrer en 3D. */
export interface PercageDeBarre {
  /** Barre percée. */
  readonly piece: string;
  /** Milieu du trou, à mi-épaisseur de la paroi. */
  readonly centre: Vec3;
  readonly axe: Vec3;
  readonly d: number;
  readonly epaisseur: number;
}

/**
 * Tous les trous percés dans les barres, boulonnés ou non. Une barre est
 * extrudée pleine : sans eux, un trou en attente ou un passage de lierne ne se
 * verrait nulle part.
 */
export function percagesDesBarres(members: readonly Member[]): PercageDeBarre[] {
  const out: PercageDeBarre[] = [];
  for (const m of members) {
    if (m.holes.length === 0) continue;
    const f = memberFrame(m);
    const profil = getProfile(m.profileId);
    for (const h of m.holes) {
      out.push({
        piece: m.id,
        centre: sectionPointAt(f, m.start, h.s, milieuDeParoi(profil, h)),
        axe: h.through === 'y' ? f.ay : f.az,
        d: h.d,
        epaisseur: epaisseurParoi(profil, h),
      });
    }
  }
  return out;
}

/** Nombre de boulons du modèle : la liste, comptée. */
export function compterBoulons(
  members: readonly Member[],
  plates: readonly Plate[],
): number {
  return listerBoulons(members, plates).length;
}

/** Tolérance d'alignement de deux trous sur une même tige (mm). */
const TOL_LATERALE = 1.5;

/**
 * Union des trous coaxiaux et contigus. Deux trous appartiennent à la même tige
 * s'ils sont sur la même droite (à 1,5 mm près) et séparés de moins que leurs
 * deux parois réunies — le centre d'un trou est coté tantôt à mi-épaisseur,
 * tantôt sur une face, d'où cette marge d'une épaisseur entière.
 *
 * Les centres sont rangés dans une grille de 60 mm : seules les cases voisines
 * sont comparées, et la régénération du modèle reste instantanée.
 */
function regrouperCoaxiaux(occ: readonly Occurrence[]): Occurrence[][] {
  const parent = occ.map((_, i) => i);
  const racine = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  const PAS = 60;
  const cellule = (q: Vec3): [number, number, number] => [
    Math.floor(q.x / PAS),
    Math.floor(q.y / PAS),
    Math.floor(q.z / PAS),
  ];
  /*
   * Clé NUMÉRIQUE de case : une clé texte fabriquée vingt-sept fois par trou
   * faisait de ce regroupement le premier poste de la génération du modèle.
   * Décalage de 2^10 cases (61 km) : aucun bâtiment n'en sort.
   */
  const D = 1024;
  const cle = (x: number, y: number, z: number): number => ((x + D) * 2 * D + (y + D)) * 2 * D + (z + D);
  const grille = new Map<number, number[]>();
  occ.forEach((o, i) => {
    const [x, y, z] = cellule(o.centre);
    const k = cle(x, y, z);
    const l = grille.get(k);
    if (l) l.push(i);
    else grille.set(k, [i]);
  });

  occ.forEach((a, i) => {
    const [cx, cy, cz] = cellule(a.centre);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grille.get(cle(cx + dx, cy + dy, cz + dz)) ?? []) {
            if (j <= i) continue;
            const b = occ[j] as Occurrence;
            if (b.piece === a.piece || b.d !== a.d) continue;
            // Axes parallèles, puis b sur la droite de a, puis contiguïté.
            if (Math.abs(dot(a.axe, b.axe)) < 0.999) continue;
            const ab = sub(b.centre, a.centre);
            const axial = dot(ab, a.axe);
            const lat = sub(ab, scale(a.axe, axial));
            if (Math.hypot(lat.x, lat.y, lat.z) > TOL_LATERALE) continue;
            if (Math.abs(axial) > a.epaisseur + b.epaisseur + 1) continue;
            parent[racine(j)] = racine(i);
          }
        }
      }
    }
  });

  const groupes = new Map<number, Occurrence[]>();
  occ.forEach((o, i) => {
    const r = racine(i);
    const l = groupes.get(r);
    if (l) l.push(o);
    else groupes.set(r, [o]);
  });
  return [...groupes.values()];
}

/**
 * Pose de la tige : sens, tête et serrage.
 *
 * ⚠ La tête s'appuie sur la face extérieure de la pièce la PLUS EXTERNE de
 * l'empilage. Sur un axe vertical elle est en HAUT : sous une platine de pied,
 * l'écrou se retrouvait noyé dans le béton — invisible et faux.
 */
function placer(g: readonly Occurrence[]): BoltPlacement {
  const a0 = (g[0] as Occurrence).axe;
  // Orientation de référence : vers le haut, sinon vers les y puis les x positifs.
  const versHaut =
    Math.abs(a0.z) > 0.5 ? Math.sign(a0.z) : Math.abs(a0.y) > 0.5 ? Math.sign(a0.y) : Math.sign(a0.x) || 1;
  const ref = scale(a0, versHaut);
  const tries = [...g].sort((x, y) => dot(y.centre, ref) - dot(x.centre, ref));
  const tete = tries[0] as Occurrence;
  const grip = g.reduce((s, o) => s + o.epaisseur, 0);
  const seule = g.length === 1 ? (g[0] as Occurrence) : null;
  const tole = g.find((o) => o.nature in USAGES && o.nature !== 'platine-pied') ?? g.find((o) => o.nature in USAGES);
  return {
    at: add(tete.centre, scale(ref, tete.epaisseur / 2)),
    axis: scale(ref, -1),
    d: tete.d,
    grip,
    // Un trou de platine de pied que rien ne prolonge : c'est le béton qui le
    // prolonge, et c'est une tige d'ancrage.
    kind: seule?.nature === 'platine-pied' ? 'ancrage' : 'boulon',
    usage: tole ? (USAGES[tole.nature] as string) : usageBarres(g),
    pieces: tries.map((o) => o.piece),
  };
}

function usageBarres(g: readonly Occurrence[]): string {
  const roles = new Set(g.map((o) => o.nature));
  if (roles.has('panne')) return 'attaches de pannes';
  if (roles.has('lisse')) return 'attaches de lisses';
  if (roles.has('lierne')) return 'liernes';
  if (roles.has('contreventement')) return 'contreventements';
  return 'assemblages barre à barre';
}

function repereTole(pl: Plate): { u: Vec3; w: Vec3; n: Vec3 } {
  const u = normalize(pl.u);
  const w = normalize(sub(pl.v, scale(u, dot(pl.v, u))));
  return { u, w, n: normalize(cross(u, w)) };
}

/**
 * Point du trou ramené à MI-ÉPAISSEUR de la paroi qu'il traverse.
 *
 * ⚠ Un trou de barre est coté tantôt sur la face de contact, tantôt au milieu
 * de la paroi. La tête, posée à une demi-épaisseur du centre, se dessinait alors
 * à moitié noyée dans la semelle du poteau — « le boulon n'est pas dans son
 * trou ». La section dit où est le métal : on prend, sur la droite de perçage,
 * le tronçon de matière le plus proche du point coté, et son milieu.
 */
function milieuDeParoi(profil: ReturnType<typeof getProfile>, h: Pick<Hole, 'at' | 'through'>): Pt2 {
  const sec = sectionOutline(profil, 4);
  // Perçage selon z : droite y = cte, on cherche des z ; selon y, l'inverse.
  const fixe = h.through === 'z' ? h.at.y : h.at.z;
  const vise = h.through === 'z' ? h.at.z : h.at.y;
  const coupes: number[] = [];
  for (const poly of [sec.outer, ...sec.holes]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i] as Pt2;
      const b = poly[(i + 1) % poly.length] as Pt2;
      const [fa, fb, la, lb] = h.through === 'z' ? [a.y, b.y, a.z, b.z] : [a.z, b.z, a.y, b.y];
      if (fa > fixe === fb > fixe) continue;
      coupes.push(la + ((lb - la) * (fixe - fa)) / (fb - fa));
    }
  }
  coupes.sort((x, y) => x - y);
  let meilleur: number | null = null;
  let ecart = Infinity;
  for (let i = 0; i + 1 < coupes.length; i += 2) {
    const lo = coupes[i] as number;
    const hi = coupes[i + 1] as number;
    const e = vise < lo ? lo - vise : vise > hi ? vise - hi : 0;
    if (e < ecart) {
      ecart = e;
      meilleur = (lo + hi) / 2;
    }
  }
  if (meilleur === null) return h.at;
  return h.through === 'z' ? { y: h.at.y, z: meilleur } : { y: meilleur, z: h.at.z };
}

/**
 * Épaisseur de la paroi traversée par un perçage. Le sens de perçage le dit :
 * selon z on traverse une semelle, selon y une âme ou une aile.
 *
 * ⚠⚠ LA SEULE fonction qui réponde à cette question, construction ET
 * nomenclature. Elle était écrite deux fois : ici et dans la liste de
 * boulonnerie. La correction des profils formés à froid n'avait été portée qu'à
 * un endroit, et la nomenclature commandait trois cents boulons M12×230 —
 * 208 mm de serrage pour une tôle de 2 mm sur une cornière de 8.
 */
export function epaisseurParoi(
  profil: ReturnType<typeof getProfile>,
  h: Pick<Hole, 'through'>,
): number {
  if (profil.shape === 'I' || profil.shape === 'U') {
    return h.through === 'z' ? profil.tf : profil.tw;
  }
  if (profil.shape === 'L' || profil.shape === 'BOX' || profil.shape === 'CHS') return profil.t;
  if (profil.shape === 'RECT') return profil.t;
  /*
   * ⚠ Un profil FORMÉ À FROID est plié dans une tôle d'épaisseur unique : quel
   * que soit le sens de perçage, on traverse `t`. Sans ce cas, ces profils
   * tombaient sur le repli ci-dessous et annonçaient une paroi de 200 mm là où
   * la tôle en fait 2 — de quoi commander des boulons dix fois trop longs.
   */
  if (profil.shape === 'Z' || profil.shape === 'C') return profil.t;
  // Barre ronde pleine : on la traverse de part en part, sur son diamètre.
  return profil.h;
}
