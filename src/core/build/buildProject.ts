import {
  cutLengths,
  memberMassKg,
  memberPaintM2,
  squareCut,
  type Member,
  type MemberRole,
} from '../geometry/member';
import { RHO_ACIER, deg2rad } from '../math/tolerance';
import { defaultUp, normalize, rotateAround, sub } from '../math/vec3';
import type { ProjectParams } from '../model/project';
import { polygonArea } from '../geometry/section';
import type { Fente } from '../geometry/member';
import { longueurDeposee, type Weld } from '../geometry/weld';
import { buildBracing } from './buildBracing';
import { buildConnections } from './buildConnections';
import { fenteDuPlat } from './connections/contreventement';
import { buildColumns, buildSolidRafters } from './buildFrame';
import { buildSecondary } from './buildSecondary';
import { buildTruss } from './buildTruss';
import { compterBoulons as compter } from './bolts';
import { haunchMassKg, haunchPaintM2 } from './jarret';
import { assignAssemblyMarks, assignHaunchMarks, assignMarks, assignPlateMarks } from './marks';
import type { Haunch, ModelStats, Plate, RoleStat, StructuralModel } from './types';

/**
 * ⚠ POINT D'ENTRÉE UNIQUE DU GÉNÉRATEUR.
 *
 * `ProjectParams` entre, `StructuralModel` sort. Fonction PURE : mêmes
 * paramètres ⇒ même modèle, au bit près. Aucun état conservé entre deux appels,
 * donc aucune possibilité de désynchronisation entre la 3D, les plans et les
 * nomenclatures : ils lisent tous le même résultat.
 */
export function buildProject(p: ProjectParams): StructuralModel {
  const t0 = performance.now();

  // Les poteaux existent dans tous les cas ; seule la toiture change de nature.
  const poteaux = buildColumns(p);
  const { members: traverses, haunches: jarrets } = buildSolidRafters(p);
  const fermes = buildTruss(p);
  const secondaire = buildSecondary(p);
  const contreventements = buildBracing(p, [...poteaux, ...traverses, ...fermes, ...secondaire.members]);
  const libres = buildFreeMembers(p);

  const brutes = [
    ...poteaux,
    ...traverses,
    ...fermes,
    ...secondaire.members,
    ...contreventements.members,
    ...libres,
  ];

  // Les assemblages lisent la géométrie déjà construite et renvoient les
  // perçages à porter : le repérage vient APRÈS, pour que deux pièces percées
  // différemment ne partagent jamais un repère.
  const assemblages = buildConnections(p, brutes, jarrets, contreventements.attaches);
  // Fentes d'about des tubes : lues sur les plats que l'assemblage y a engagés.
  const fentes = new Map<string, Fente[]>();
  const parId = new Map(brutes.map((m) => [m.id, m]));
  for (const pl of assemblages.plates) {
    const tube = pl.kind === 'plat-tube' && pl.porteur ? parId.get(pl.porteur) : undefined;
    if (!tube) continue;
    const f = fenteDuPlat(tube, pl);
    fentes.set(tube.id, [...(fentes.get(tube.id) ?? []), { about: f.about, longueur: f.longueur, largeur: pl.thickness + 2 }]);
  }
  const percees = brutes.map((m) => {
    const h = assemblages.holes.get(m.id);
    const fe = fentes.get(m.id);
    return {
      ...m,
      holes: h && h.length > 0 ? h : m.holes,
      porteur: assemblages.porteurs.get(m.id) ?? null,
      ...(fe ? { fentes: fe.sort((a, b) => a.about.localeCompare(b.about)) } : {}),
    };
  });

  const haunches = assignHaunchMarks(
    jarrets.map((h) => ({ ...h, porteur: assemblages.porteursJarrets.get(h.id) ?? null })),
  );
  const plates = assignPlateMarks(assemblages.plates);
  // Repères de débit d'abord, d'assemblage ensuite : le second se construit sur
  // le premier et sur les repères des tôles et des jarrets.
  const members = assignAssemblyMarks(assignMarks(percees), plates, haunches);

  /*
   * ⚠ Statistiques calculées À LA DEMANDE. Le compte des boulons y apparie
   * chaque trou à ses coaxiaux : plus d'un tiers du temps de génération, pour
   * un chiffre que la 3D et les nomenclatures lisent, mais pas le
   * dimensionnement automatique, qui génère le modèle des dizaines de fois.
   */
  let stats: ReturnType<typeof computeStats> | null = null;
  return {
    members,
    haunches,
    plates,
    welds: assemblages.welds,
    get stats() {
      stats ??= computeStats(members, haunches, plates, assemblages.welds);
      return stats;
    },
    spacings: {
      purlins: secondaire.purlinSpacing,
      rails: secondaire.railSpacing,
    },
    buildMs: performance.now() - t0,
  };
}

/** Barres ajoutées à la main : coupes droites aux deux abouts. */
function buildFreeMembers(p: ProjectParams): Member[] {
  return p.freeMembers.map((m) => {
    const axe = normalize(sub(m.end, m.start));
    const up = rotateAround(defaultUp(axe), axe, deg2rad(m.rotation));
    return {
      id: `LIBRE-${m.id}`,
      role: 'libre' as MemberRole,
      profileId: m.profile,
      grade: m.grade,
      start: m.start,
      end: m.end,
      up,
      mirrored: false,
      holes: [],
      notches: [],
      porteur: null,
      cutStart: squareCut(m.start, axe, -1),
      cutEnd: squareCut(m.end, axe, 1),
      mark: '',
      assemblage: '',
      position: m.label || 'barre libre',
    };
  });
}

/* Masse et surface des jarrets : leur forme n'a qu'une définition. */
export { haunchMassKg, haunchPaintM2 } from './jarret';

/** Masse d'une tôle (kg) : aire du contour × épaisseur, trous déduits. */
export function plateMassKg(pl: Plate): number {
  const aire = Math.abs(polygonArea(pl.outline));
  const vides = pl.holes.reduce((s, h) => s + (Math.PI * h.d * h.d) / 4, 0);
  return Math.max(0, aire - vides) * pl.thickness * RHO_ACIER;
}

/** Surface à peindre d'une tôle (m²) : ses deux faces et son chant. */
export function platePaintM2(pl: Plate): number {
  const aire = Math.abs(polygonArea(pl.outline));
  let perimetre = 0;
  for (let i = 0; i < pl.outline.length; i++) {
    const a = pl.outline[i] as { y: number; z: number };
    const b = pl.outline[(i + 1) % pl.outline.length] as { y: number; z: number };
    perimetre += Math.hypot(b.y - a.y, b.z - a.z);
  }
  return (2 * aire + perimetre * pl.thickness) / 1e6;
}

/**
 * Comptage de la boulonnerie.
 *
 * ⚠ Délégué à `listerBoulons`, qui sert aussi à POSER les boulons dans la vue
 * 3D. Compter d'un côté et dessiner de l'autre laisserait les deux dériver, et
 * l'écart entre une vue montrant six cents boulons et une nomenclature qui en
 * commande cinq cent quarante ne se remarquerait qu'à la livraison.
 */
export { compterBoulons, listerBoulons, type BoltPlacement } from './bolts';

function computeStats(
  members: readonly Member[],
  haunches: readonly Haunch[],
  plates: readonly Plate[],
  welds: readonly Weld[],
): ModelStats {
  const byRole: Partial<Record<MemberRole, RoleStat>> = {};
  let massKg = 0;
  let paintM2 = 0;

  for (const m of members) {
    const masse = memberMassKg(m);
    massKg += masse;
    paintM2 += memberPaintM2(m);
    const actuel = byRole[m.role] ?? { count: 0, massKg: 0 };
    byRole[m.role] = { count: actuel.count + 1, massKg: actuel.massKg + masse };
  }
  for (const h of haunches) {
    const masse = haunchMassKg(h);
    massKg += masse;
    paintM2 += haunchPaintM2(h);
    const actuel = byRole.jarret ?? { count: 0, massKg: 0 };
    byRole.jarret = { count: actuel.count + 1, massKg: actuel.massKg + masse };
  }

  for (const pl of plates) {
    massKg += plateMassKg(pl);
    paintM2 += platePaintM2(pl);
  }

  const reperes = new Set(members.map((m) => m.mark));
  for (const h of haunches) reperes.add(h.mark);
  for (const pl of plates) reperes.add(pl.mark);

  const boltCount = compter(members, plates);

  return {
    memberCount: members.length,
    haunchCount: haunches.length,
    plateCount: plates.length,
    boltCount,
    weldCount: welds.length,
    weldMetres: welds.reduce((s, w) => s + longueurDeposee(w), 0) / 1000,
    markCount: reperes.size,
    massKg,
    paintM2,
    byRole,
  };
}

/** Longueur de débit d'une barre, exposée pour l'interface et les nomenclatures. */
export { cutLengths };
