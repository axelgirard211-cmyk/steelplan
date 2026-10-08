import { epaisseurParoi, listerBoulons } from '../build/bolts';
import type { StructuralModel } from '../build/types';
import { getProfile } from '../catalog/index';
import { RHO_ACIER } from '../math/tolerance';
import type { BoltClass } from '../model/connections';
import type { ProjectParams } from '../model/project';

/**
 * LISTE DE BOULONNERIE.
 *
 * Un boulon se commande par sa désignation ET sa longueur : « M20×70 10.9 ». La
 * longueur ne se choisit pas, elle se déduit du SERRAGE — l'épaisseur totale des
 * pièces traversées — auquel on ajoute de quoi loger l'écrou et laisser dépasser
 * le filet.
 *
 * Le serrage est lu sur les pièces réellement percées : la provenance de chaque
 * trou nomme la pièce appariée, et l'épaisseur traversée s'en déduit. Aucune
 * valeur n'est saisie.
 */
export interface BoltLine {
  readonly designation: string;
  /** Boulon complet, tige d'ancrage, ou écrou seul (liernes filetées). */
  readonly piece: 'boulon' | 'ancrage' | 'ecrou';
  readonly diameter: number;
  readonly cls: BoltClass;
  /** Longueur de tige commandée (mm). */
  readonly length: number;
  /** Épaisseur totale des pièces assemblées (mm). */
  readonly grip: number;
  readonly count: number;
  readonly usage: string;
  readonly massUnit: number;
  readonly massTotal: number;
}

/** Série commerciale des longueurs de boulons de charpente (mm). */
const LONGUEURS = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 140, 160, 180, 200];

/**
 * Longueur commandée pour un serrage donné.
 *
 * Il faut le serrage, plus l'écrou et deux rondelles, plus un dépassement de
 * filet — soit environ 1,5 fois le diamètre — arrondi à la longueur commerciale
 * immédiatement supérieure. Un boulon trop court ne serre pas ; trop long, il
 * dépasse et gêne au montage.
 */
export function boltLength(grip: number, diameter: number): number {
  const necessaire = grip + 1.5 * diameter;
  return LONGUEURS.find((l) => l >= necessaire) ?? Math.ceil(necessaire / 10) * 10;
}

/**
 * Masse d'un boulon avec son écrou et ses rondelles (kg).
 *
 * Volume de la tige, plus un forfait de 1,9 × (section × diamètre) qui couvre la
 * tête, l'écrou et les rondelles. Recoupé sur un M20×60 8.8 : 0,24 kg contre
 * 0,25 kg au catalogue.
 */
export function boltMass(length: number, diameter: number): number {
  const section = (Math.PI * diameter * diameter) / 4;
  return (section * length + 1.9 * section * diameter) * RHO_ACIER;
}

/**
 * Masse d'un écrou hexagonal et de sa rondelle (kg) : 1,4 d³ en volume — écrou
 * de 1,5 d sur plats et 0,84 d de haut, rondelle de 2 d × 0,19 d. Recoupé sur
 * HM16 + rondelle : 0,045 kg contre 0,031 + 0,011 au catalogue.
 */
export function nutMass(diameter: number): number {
  return 1.4 * diameter ** 3 * RHO_ACIER;
}

export function boltList(p: ProjectParams, model: StructuralModel): BoltLine[] {
  /** Regroupement par désignation exacte : diamètre, classe, longueur, usage. */
  const lignes = new Map<string, BoltLine & { n: number }>();
  const ajouter = (cle: string, l: Omit<BoltLine, 'count' | 'massTotal'>): void => {
    const existant = lignes.get(cle);
    if (existant) existant.n += 1;
    else lignes.set(cle, { ...l, count: 0, massTotal: 0, n: 1 });
  };

  /*
   * ⚠ Lue sur la liste UNIQUE des boulons du modèle — celle que dessine la vue
   * 3D. Cette nomenclature réécrivait les règles de comptage pour son compte, et
   * c'est sa copie, restée en arrière d'une correction, qui commandait des
   * M12×230 pour serrer dix millimètres.
   */
  const cb = p.connections.columnBase;
  for (const b of listerBoulons(model.members, model.plates)) {
    if (b.kind === 'ancrage') {
      const d = cb.anchorDiameter;
      const length = cb.anchorEmbedment + b.grip + cb.groutThickness + 2 * d;
      ajouter(`ancrage|${d}|${length}`, {
        designation: `Tige d’ancrage M${d}×${length}`,
        piece: 'ancrage',
        diameter: d,
        cls: '8.8',
        length,
        grip: b.grip + cb.groutThickness,
        usage: 'pieds de poteaux',
        massUnit: boltMass(length, d),
      });
      continue;
    }
    const diameter = diametreNominal(b.d, p);
    const cls = classeDe(b.d, p);
    const length = boltLength(b.grip, diameter);
    ajouter(`${diameter}|${cls}|${length}|${b.usage}`, {
      designation: `M${diameter}×${length} ${cls}`,
      piece: 'boulon',
      diameter,
      cls,
      length,
      grip: b.grip,
      usage: b.usage,
      massUnit: boltMass(length, diameter),
    });
  }

  /*
   * ⚠ Une lierne est un rond FILETÉ à ses deux bouts, bloqué de part et d'autre
   * de l'âme de chaque panne : quatre écrous et quatre rondelles par lierne. Ils
   * n'apparaissaient nulle part — le monteur recevait les ronds sans de quoi les
   * serrer. Ce ne sont pas des boulons : ils ne comptent pas dans les boulons posés.
   */
  const liernes = model.members.filter((m) => m.role === 'lierne');
  if (liernes.length > 0) {
    const d = p.secondary.purlins.sagBars.diameter;
    const ame = epaisseurParoi(getProfile(p.secondary.purlins.profile), { through: 'y' });
    for (let i = 0; i < 4 * liernes.length; i++) {
      ajouter(`ecrou|${d}`, {
        designation: `Écrou HM${d} + rondelle`,
        piece: 'ecrou',
        diameter: d,
        cls: '8.8',
        length: 0,
        grip: ame,
        usage: 'liernes — 2 écrous par about',
        massUnit: nutMass(d),
      });
    }
  }

  return [...lignes.values()]
    .map(({ n, ...l }) => ({ ...l, count: n, massTotal: l.massUnit * n }))
    .sort((a, b) => a.diameter - b.diameter || a.length - b.length);
}

/* ------------------------------------------------------------------ */

/**
 * Diamètre nominal du boulon dont vient ce perçage. Le trou porte son diamètre
 * de perçage, jeu compris : on remonte au diamètre nominal en retirant le jeu
 * normalisé.
 */
function diametreNominal(dPercage: number, p: ProjectParams): number {
  const candidats = [
    p.connections.rafterToColumn.bolt,
    p.connections.ridge.bolt,
    p.connections.gusset.bolt,
    p.connections.splice.bolt,
    p.connections.secondaryBolt,
  ];
  for (const b of candidats) {
    const jeu = b.d <= 14 ? 1 : b.d <= 24 ? 2 : 3;
    if (b.d + jeu === dPercage) return b.d;
  }
  // Repli : le jeu courant est de 2 mm sur la plage la plus utilisée.
  return dPercage - 2;
}

function classeDe(dPercage: number, p: ProjectParams): BoltClass {
  const candidats = [
    p.connections.rafterToColumn.bolt,
    p.connections.ridge.bolt,
    p.connections.gusset.bolt,
    p.connections.splice.bolt,
    p.connections.secondaryBolt,
  ];
  const d = diametreNominal(dPercage, p);
  return candidats.find((b) => b.d === d)?.cls ?? '8.8';
}
