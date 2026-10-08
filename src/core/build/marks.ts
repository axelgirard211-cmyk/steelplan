import { getProfile } from '../catalog/index';
import { holeSignature } from '../geometry/holes';
import { notchSignature } from '../geometry/notches';
import { cutAngleDeg, cutLengths, memberFrame, type Member, type MemberRole } from '../geometry/member';
import { dot, scale, add, sub, type Vec3 } from '../math/vec3';
import type { Haunch, Plate } from './types';

/**
 * Repérage automatique.
 *
 * Deux pièces portent le même repère si et seulement si elles sont
 * INTERCHANGEABLES en atelier : même profil, même nuance, même longueur de
 * débit et mêmes angles de coupe. Le nombre de repères distincts est donc
 * exactement le nombre de pièces différentes à fabriquer — c'est la donnée qui
 * pilote la liste de débit.
 */
const PREFIXES: Readonly<Record<MemberRole, string>> = {
  poteau: 'PO',
  traverse: 'TR',
  console: 'CO',
  jarret: 'JA',
  panne: 'PA',
  lisse: 'LI',
  potelet: 'PT',
  chevetre: 'CH',
  'membrure-sup': 'MS',
  'membrure-inf': 'MI',
  montant: 'MO',
  diagonale: 'DI',
  contreventement: 'CV',
  lierne: 'LN',
  attache: 'AT',
  equerre: 'EQ',
  libre: 'LB',
};

/** Tolérance de regroupement : 1 mm sur les longueurs, 0,1° sur les angles. */
function signature(m: Member): string {
  const l = cutLengths(m);
  // La mise en miroir ne compte que sur une section dissymétrique : deux
  // cornières dos à dos sont deux pièces différentes, deux IPE non.
  const forme = getProfile(m.profileId).shape;
  const miroir = (forme === 'L' || forme === 'U') && m.mirrored ? 'M' : '';
  // Sections doublement symétriques : la pièce peut être retournée d'un demi-tour
  // autour de son axe sans changer de nature.
  const doublementSymetrique =
    forme === 'I' || forme === 'CHS' || forme === 'BOX' || forme === 'RECT' || forme === 'ROND';
  return [
    m.role,
    m.profileId + miroir,
    m.grade,
    Math.round(l.max),
    Math.round(l.min),
    cutAngleDeg(m, 'start').toFixed(1),
    cutAngleDeg(m, 'end').toFixed(1),
    // Deux pièces percées différemment ne sont pas interchangeables, même si
    // elles sortent de la même barre à la même longueur.
    holeSignature(m.holes, { demiTourAutourDeLAxe: doublementSymetrique }),
    // Deux pièces grugées différemment ne sont pas non plus interchangeables.
    notchSignature(m.notches),
    // Ni deux tubes fendus différemment.
    (m.fentes ?? []).map((f) => `${f.about}:${Math.round(f.longueur)}x${f.largeur}`).join(','),
  ].join('|');
}

/**
 * Attribue les repères. Les pièces sont numérotées dans leur ordre
 * d'apparition, ce qui rend le repérage stable : ajouter une travée ne
 * renumérote pas les pièces existantes.
 */
export function assignMarks(members: readonly Member[]): Member[] {
  const parSignature = new Map<string, string>();
  const compteurs = new Map<string, number>();

  return members.map((m) => {
    const sig = signature(m);
    let mark = parSignature.get(sig);
    if (!mark) {
      const prefixe = PREFIXES[m.role];
      const n = (compteurs.get(prefixe) ?? 0) + 1;
      compteurs.set(prefixe, n);
      mark = `${prefixe}${n}`;
      parSignature.set(sig, mark);
    }
    return { ...m, mark };
  });
}

/** Même principe pour les jarrets, regroupés sur profil + longueur + hauteur. */
export function assignHaunchMarks(haunches: readonly Haunch[]): Haunch[] {
  const parSignature = new Map<string, string>();
  let n = 0;
  return haunches.map((h) => {
    const l = Math.round(
      Math.hypot(h.tip.x - h.root.x, h.tip.y - h.root.y, h.tip.z - h.root.z),
    );
    const sig = `${h.profileId}|${h.grade}|${l}|${Math.round(h.rootDepth)}`;
    let mark = parSignature.get(sig);
    if (!mark) {
      n += 1;
      mark = `JA${n}`;
      parSignature.set(sig, mark);
    }
    return { ...h, mark };
  });
}

/**
 * Repérage des tôles. Deux tôles sont la même pièce si elles ont mêmes
 * dimensions, même épaisseur, même nuance ET même perçage — À RETOURNEMENT PRÈS.
 *
 * ⚠ Une tôle plane se retourne : le gousset du pied gauche d'une croix est celui
 * du pied droit, posé l'autre face en avant. Comparés dans leur repère de pose,
 * ils prenaient deux repères, deux fichiers de découpe et deux lignes de
 * commande pour une seule pièce. La signature est donc prise dans la plus petite
 * des huit présentations de la tôle — retournée, tournée d'un quart de tour.
 */
export function assignPlateMarks(plates: readonly Plate[]): Plate[] {
  const prefixes: Record<Plate['kind'], string> = {
    'platine-about': 'PL',
    'platine-pied': 'PP',
    gousset: 'GO',
    eclisse: 'EC',
    'gousset-cv': 'GC',
    'plat-tube': 'PC',
    'gousset-tete': 'GT',
  };
  const parSignature = new Map<string, string>();
  const compteurs = new Map<string, number>();

  return plates.map((pl) => {
    const sig = `${pl.kind}|${pl.grade}|${pl.thickness}|${formeCanonique(pl)}`;
    let mark = parSignature.get(sig);
    if (!mark) {
      const prefixe = prefixes[pl.kind];
      const n = (compteurs.get(prefixe) ?? 0) + 1;
      compteurs.set(prefixe, n);
      mark = `${prefixe}${n}`;
      parSignature.set(sig, mark);
    }
    return { ...pl, mark };
  });
}

/** Contour et perçage d'une tôle, dans la plus petite de ses huit présentations. */
function formeCanonique(pl: Plate): string {
  const vues: ((y: number, z: number) => [number, number])[] = [
    (y, z) => [y, z],
    (y, z) => [-y, z],
    (y, z) => [y, -z],
    (y, z) => [-y, -z],
    (y, z) => [z, y],
    (y, z) => [-z, y],
    (y, z) => [z, -y],
    (y, z) => [-z, -y],
  ];
  return vues
    .map((t) => {
      const c = pl.outline.map((q) => t(q.y, q.z));
      const y0 = Math.min(...c.map((q) => q[0]));
      const z0 = Math.min(...c.map((q) => q[1]));
      const cle = (y: number, z: number): string => `${Math.round(y - y0)},${Math.round(z - z0)}`;
      const contour = c.map(([y, z]) => cle(y, z)).sort().join(';');
      // Un oblong tourne avec la tôle : un quart de tour change son axe.
      const tourne = t(1, 0)[0] === 0;
      const trous = pl.holes
        .map((h) => {
          const [y, z] = t(h.at.y, h.at.z);
          const o = h.oblong ? `,${Math.round(h.oblong.longueur)}${(h.oblong.sens === 'y') !== tourne ? 'y' : 'z'}` : '';
          return `${cle(y, z)},${h.d}${o}`;
        })
        .sort()
        .join(';');
      return `${contour}|${trous}`;
    })
    .sort()[0] as string;
}

/**
 * REPÈRES D'ASSEMBLAGE — ce qui est peint sur la pièce finie.
 *
 * Le repère de débit dit « même barre » ; il ne dit pas « même pièce livrée ».
 * Deux traverses débitées à l'identique peuvent recevoir des échantignolles
 * différentes — celles des pignons ne portent qu'une panne — et ne sont alors
 * plus interchangeables au montage. L'élément de fabrication, qui prenait la
 * première barre du repère pour représenter toutes les autres, décrivait
 * pourtant leurs tôles et leurs pièces soudées comme si elles l'étaient.
 *
 * Signature : le repère de débit, plus chaque tôle, jarret et pièce soudés,
 * avec sa position dans le repère de la barre. Si toutes les barres d'un repère
 * de débit ont la même, le repère d'assemblage EST le repère de débit — c'est le
 * cas courant, et il ne change rien aux plans. Sinon, chaque variante reçoit une
 * lettre : TR1A, TR1B.
 */
export function assignAssemblyMarks(
  members: readonly Member[],
  plates: readonly Plate[],
  haunches: readonly Haunch[],
): Member[] {
  const signatures = new Map<string, string>();
  for (const m of members) {
    if (m.porteur !== null) continue;
    const f = memberFrame(m);
    const local = (q: Vec3): [number, number, number] => {
      const d = sub(q, m.start);
      return [dot(d, f.ax), dot(d, f.ay), dot(d, f.az)].map((v) => Math.round(v)) as [number, number, number];
    };
    const pieces = [
      ...plates.filter((pl) => pl.porteur === m.id).map((pl) => [pl.mark, local(pl.origin)] as const),
      ...haunches.filter((h) => h.porteur === m.id).map((h) => [h.mark, local(h.root)] as const),
      ...members
        .filter((x) => x.porteur === m.id)
        .map((x) => [x.mark, local(scale(add(x.start, x.end), 0.5))] as const),
    ];
    /*
     * Un profil doublement symétrique se retourne d'un demi-tour autour de son
     * axe sans changer de nature : (y, z) et (−y, −z) décrivent alors la même
     * pièce. On retient la plus petite des deux écritures.
     */
    const ecrire = (sens: 1 | -1): string =>
      pieces
        .map(([mark, [s0, y, z]]) => `${mark}@${s0},${sens * y},${sens * z}`)
        .sort()
        .join(';');
    const forme = getProfile(m.profileId).shape;
    const retournable = forme === 'I' || forme === 'CHS' || forme === 'BOX' || forme === 'RECT' || forme === 'ROND';
    const a = ecrire(1);
    const b = retournable ? ecrire(-1) : a;
    signatures.set(m.id, `${m.mark}|${a < b ? a : b}`);
  }

  /*
   * Variantes de chaque repère de débit, de la plus FRÉQUENTE à la plus rare :
   * la pièce courante prend la lettre A, les pièces singulières — un poteau
   * d'angle et ses équerres — les suivantes. À fréquence égale, l'ordre
   * d'apparition, qui rend le repérage stable.
   */
  const compte = new Map<string, number>();
  const ordre = new Map<string, number>();
  for (const m of members) {
    const sig = signatures.get(m.id);
    if (sig === undefined) continue;
    compte.set(sig, (compte.get(sig) ?? 0) + 1);
    if (!ordre.has(sig)) ordre.set(sig, ordre.size);
  }
  const variantes = new Map<string, string[]>();
  for (const m of members) {
    const sig = signatures.get(m.id);
    if (sig === undefined) continue;
    const l = variantes.get(m.mark) ?? [];
    if (!l.includes(sig)) l.push(sig);
    variantes.set(m.mark, l);
  }
  for (const l of variantes.values()) {
    l.sort((a, b) => (compte.get(b) ?? 0) - (compte.get(a) ?? 0) || (ordre.get(a) ?? 0) - (ordre.get(b) ?? 0));
  }
  const repere = (m: Member): string => {
    const l = variantes.get(m.mark) ?? [];
    if (l.length <= 1) return m.mark;
    return `${m.mark}${String.fromCharCode(65 + l.indexOf(signatures.get(m.id) ?? ''))}`;
  };

  const principales = new Map(members.filter((m) => m.porteur === null).map((m) => [m.id, repere(m)]));
  return members.map((m) => ({
    ...m,
    // Une pièce soudée porte le repère de son porteur : elle part avec lui.
    assemblage: m.porteur === null ? (principales.get(m.id) ?? m.mark) : (principales.get(m.porteur) ?? m.mark),
  }));
}

/** Regroupe les barres par repère, dans l'ordre d'apparition des repères. */
export function groupByMark(members: readonly Member[]): Map<string, Member[]> {
  const m = new Map<string, Member[]>();
  for (const b of members) {
    const l = m.get(b.mark);
    if (l) l.push(b);
    else m.set(b.mark, [b]);
  }
  return m;
}
