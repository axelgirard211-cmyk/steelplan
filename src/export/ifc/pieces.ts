import type { BoltPlacement, PercageDeBarre } from '../../core/build/bolts';
import { contourJarret } from '../../core/build/jarret';
import type { Haunch, Plate } from '../../core/build/types';
import { getProfile } from '../../core/catalog/index';
import { contourDeTrou } from '../../core/geometry/holes';
import { fibreAbscissa, memberFrame, type Member } from '../../core/geometry/member';
import type { Notch } from '../../core/geometry/notches';
import { polygonArea, sectionOutline, type Pt2 } from '../../core/geometry/section';
import { cross, dot, normalize, scale, sub, v3 } from '../../core/math/vec3';
import { directionLocale, perpendiculaire, versLocal, type Geometrie, type Repere } from './geometrie';
import type { Ref } from './step';

/**
 * LA FORME DE CHAQUE PIÈCE, en entités IFC.
 *
 * ⚠ La même géométrie que la vue 3D et les plans : contour de section exact,
 * abouts arrêtés sur leurs plans de coupe, jarret tiré de `contourJarret`, tôle
 * percée de ses vrais trous. Un fichier IFC qui montrerait une autre pièce que
 * le plan de débit serait pire que pas de fichier : la synthèse détecterait des
 * conflits qui n'existent pas, et en manquerait d'autres.
 */

/** Corps d'une pièce : ses solides, dans le repère de la pièce. */
export interface Corps {
  readonly repere: Repere;
  readonly solides: readonly Ref[];
  /** Type de représentation IFC : extrusion simple ou extrusion recoupée. */
  readonly type: 'SweptSolid' | 'Clipping';
}

/** Polygone remis dans le sens trigonométrique, celui qu'attend un contour extérieur. */
function trigo(p: readonly Pt2[]): Pt2[] {
  return polygonArea(p) < 0 ? [...p].reverse() : [...p];
}

/**
 * Repère d'une barre : origine au point de travail de départ, Z le long de
 * l'axe, X la largeur de section, Y sa hauteur.
 *
 * ⚠ Toujours DIRECT, même pour une cornière en miroir : c'est son contour qu'on
 * retourne, pas le repère. Un repère indirect retourne les solides pour bon
 * nombre de lecteurs, qui affichent alors la cornière à l'envers.
 */
export function repereDeBarre(m: Member): Repere {
  const f = memberFrame(m);
  return { o: m.start, x: normalize(cross(f.az, f.ax)), z: f.ax };
}

/** Barre : profil extrudé entre ses fibres extrêmes, recoupé par ses plans d'about. */
export function corpsDeBarre(g: Geometrie, m: Member): Corps {
  const profil = getProfile(m.profileId);
  const sec = sectionOutline(profil, 6);
  const miroir = (c: readonly Pt2[]): Pt2[] => (m.mirrored ? c.map((p) => ({ y: -p.y, z: p.z })).reverse() : [...c]);
  const forme = g.profil(`barre:${m.profileId}:${m.mirrored}`, m.profileId, trigo(miroir(sec.outer)), sec.holes.map(miroir));

  const f = memberFrame(m);
  const fibres = (plan: Member['cutStart']): number[] => sec.outer.map((p) => fibreAbscissa(f, m.start, plan, p));
  const debut = fibres(m.cutStart);
  const fin = fibres(m.cutEnd);
  const s0 = Math.min(...debut);
  const s1 = Math.max(...fin);

  const r = repereDeBarre(m);
  let solide = g.extrusion(forme, s0, s1 - s0);
  let recoupe = false;
  // Une coupe d'équerre est déjà la face de l'extrusion : rien à recouper.
  for (const [abscisses, plan] of [
    [debut, m.cutStart],
    [fin, m.cutEnd],
  ] as const) {
    if (Math.max(...abscisses) - Math.min(...abscisses) <= 0.01) continue;
    solide = g.recouper(solide, versLocal(r, plan.point), directionLocale(r, plan.normal));
    recoupe = true;
  }
  return { repere: r, solides: [solide], type: recoupe ? 'Clipping' : 'SweptSolid' };
}

/**
 * Jarret : le triangle d'âme et la semelle suivant l'hypoténuse, chacun extrudé
 * sur son épaisseur, de part et d'autre du plan de la traverse.
 */
export function corpsDeJarret(g: Geometrie, h: Haunch): Corps | null {
  const profil = getProfile(h.profileId);
  if (profil.shape !== 'I') return null;
  const c = contourJarret(h);
  const ax = normalize(sub(c.pointe, c.haut));
  const versBas = sub(c.bas, c.haut);
  const az = normalize(sub(versBas, scale(ax, dot(versBas, ax))));
  const ay = cross(az, ax);
  const L = dot(sub(c.pointe, c.haut), ax);
  const bas = { s: dot(versBas, ax), d: dot(versBas, az) };

  // Semelle : côté extérieur de l'hypoténuse, sur l'épaisseur tf.
  const dir = { s: L - bas.s, d: -bas.d };
  const n = Math.hypot(dir.s, dir.d) || 1;
  const nx = { s: -dir.d / n, d: dir.s / n };
  const ext = nx.d >= 0 ? nx : { s: -nx.s, d: -nx.d };
  const e = profil.tf;

  // Repère : X le long de la traverse, Z selon l'épaisseur ; Y = Z × X = −az.
  const r: Repere = { o: c.haut, x: ax, z: ay };
  const plan = (pts: readonly { s: number; d: number }[]): Pt2[] => trigo(pts.map((p) => ({ y: p.s, z: -p.d })));
  const ame = g.profil(`jarret-ame:${h.id}`, null, plan([{ s: 0, d: 0 }, bas, { s: L, d: 0 }]));
  const semelle = g.profil(
    `jarret-semelle:${h.id}`,
    null,
    plan([bas, { s: bas.s + ext.s * e, d: bas.d + ext.d * e }, { s: L + ext.s * e, d: ext.d * e }, { s: L, d: 0 }]),
  );
  return {
    repere: r,
    solides: [g.extrusion(ame, -profil.tw / 2, profil.tw), g.extrusion(semelle, -profil.b / 2, profil.b)],
    type: 'SweptSolid',
  };
}

/** Tôle : son contour, percé de ses trous, extrudé sur son épaisseur de part et d'autre de son plan. */
export function corpsDeTole(g: Geometrie, pl: Plate): Corps {
  const u = normalize(pl.u);
  const w = normalize(sub(pl.v, scale(u, dot(pl.v, u))));
  const r: Repere = { o: pl.origin, x: u, z: cross(u, w) };
  const cle = `tole:${pl.mark || pl.id}:${pl.thickness}:${pl.outline.length}:${pl.holes.length}`;
  const forme = g.profil(cle, null, trigo(pl.outline), pl.holes.map((h) => contourDeTrou(h, 16)));
  return { repere: r, solides: [g.extrusion(forme, -pl.thickness / 2, pl.thickness)], type: 'SweptSolid' };
}

/* ------------------------------------------------------------------ */
/* Perçages et grugeages : des ouvertures dans la barre                 */
/* ------------------------------------------------------------------ */

/** Perçage de barre : un cylindre à peine plus long que la paroi, dans le repère de la barre. */
export function corpsDePercage(g: Geometrie, m: Member, t: PercageDeBarre): Corps {
  const rb = repereDeBarre(m);
  const a = normalize(directionLocale(rb, t.axe));
  const h = t.epaisseur + 2;
  const base = sub(versLocal(rb, t.centre), scale(a, h / 2));
  const r: Repere = { o: base, x: perpendiculaire(a), z: a };
  return { repere: r, solides: [g.extrusion(g.cercle(t.d / 2), 0, h)], type: 'SweptSolid' };
}

/**
 * Grugeage : le pavé de matière retirée, de s0 à s1 le long de la barre, en
 * débordant de 2 mm hors du profil pour que la coupe soit franche.
 */
export function corpsDeGrugeage(g: Geometrie, m: Member, n: Notch): Corps {
  const sec = sectionOutline(getProfile(m.profileId), 6).outer;
  // Une barre en miroir a ses chants inversés dans son repère.
  const sens = m.mirrored ? -1 : 1;
  const ys = sec.map((p) => sens * p.y);
  const zs = sec.map((p) => p.z);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const d = n.depth + 2;
  const L = y1 - y0 + 4;
  const H = z1 - z0 + 4;
  const ym = (y0 + y1) / 2;
  const zm = (z0 + z1) / 2;
  const cote = n.side === 'gauche' || n.side === 'droite' ? (n.side === 'gauche') === (sens > 0) ? 'bas' : 'haut' : null;
  const rect =
    n.side === 'sup'
      ? g.rectangle(ym, z1 + 2 - d / 2, L, d)
      : n.side === 'inf'
        ? g.rectangle(ym, z0 - 2 + d / 2, L, d)
        : cote === 'bas'
          ? g.rectangle(y0 - 2 + d / 2, zm, d, H)
          : g.rectangle(y1 + 2 - d / 2, zm, d, H);
  const r: Repere = { o: v3(0, 0, 0), x: v3(1, 0, 0), z: v3(0, 0, 1) };
  return { repere: r, solides: [g.extrusion(rect, n.s0, n.s1 - n.s0)], type: 'SweptSolid' };
}

/* ------------------------------------------------------------------ */
/* Boulonnerie                                                         */
/* ------------------------------------------------------------------ */

/** Hexagone circonscrit au rayon `r`, sens trigonométrique. */
function hexagone(r: number): Pt2[] {
  return Array.from({ length: 6 }, (_, i) => ({ y: r * Math.cos((i * Math.PI) / 3), z: r * Math.sin((i * Math.PI) / 3) }));
}

/**
 * Solides d'un boulon dans son repère (Z = axe de la tige, origine au point
 * d'appui de la tête), aux proportions de la vue 3D : entreplat 1,5 d, tête
 * 0,65 d, écrou 0,8 d. Une tige d'ancrage dépasse de 2 d au-dessus de son écrou
 * et descend dans le béton sur le reste de sa longueur.
 */
export function solidesDeBoulon(
  g: Geometrie,
  b: Pick<BoltPlacement, 'kind' | 'grip'>,
  nominal: number,
  longueur: number,
): Ref[] {
  const rayon = (1.5 * nominal) / 2 / Math.cos(Math.PI / 6);
  const hex = g.profil(`hexagone:${nominal}`, null, hexagone(rayon));
  const tige = g.cercle(nominal / 2);
  if (b.kind === 'ancrage') {
    return [g.extrusion(tige, -2 * nominal, longueur), g.extrusion(hex, -0.8 * nominal, 0.8 * nominal)];
  }
  return [
    g.extrusion(hex, -0.65 * nominal, 0.65 * nominal),
    g.extrusion(tige, 0, longueur),
    g.extrusion(hex, b.grip, 0.8 * nominal),
  ];
}

/** Repère d'un boulon posé. */
export function repereDeBoulon(b: Pick<BoltPlacement, 'at' | 'axis'>): Repere {
  const z = normalize(b.axis);
  return { o: b.at, x: perpendiculaire(z), z };
}
