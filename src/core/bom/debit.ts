import { getProfile } from '../catalog/index';
import { groupByMark } from '../build/marks';
import { LIBELLE_TOLE, type Haunch, type Plate, type StructuralModel } from '../build/types';
import { haunchMassKg, haunchPaintM2, platePaintM2 } from '../build/buildProject';
import {
  cutAngleDeg,
  cutLengths,
  memberMassKg,
  memberPaintM2,
  type Member,
} from '../geometry/member';
import type { SteelGradeId } from '../catalog/types';

/**
 * LISTE DE DÉBIT.
 *
 * Une ligne par REPÈRE, pas par pièce : le repère est par définition l'ensemble
 * des pièces interchangeables, donc exactement ce que l'atelier débite en série.
 *
 * ⚠ Rien n'est recalculé ici. Longueurs, angles et masses sont relus du modèle,
 * qui les tient déjà des mêmes fonctions que les plans de débit. Une nomenclature
 * qui refait ses propres calculs finit toujours par ne plus dire la même chose
 * que le plan qu'elle accompagne.
 */
export interface DebitLine {
  readonly mark: string;
  readonly designation: string;
  readonly profileId: string;
  readonly grade: SteelGradeId;
  /** Longueur de débit à l'axe (mm). */
  readonly length: number;
  /** Fibre la plus longue (mm) : c'est elle qui définit la barre à commander. */
  readonly lengthMax: number;
  readonly angleStart: number;
  readonly angleEnd: number;
  readonly holes: number;
  readonly notches: number;
  readonly quantity: number;
  readonly massUnit: number;
  readonly massTotal: number;
  readonly paintM2: number;
}

/** Liste de débit des barres et des jarrets, dans l'ordre des repères. */
export function debitList(model: StructuralModel): DebitLine[] {
  const out: DebitLine[] = [];

  for (const [mark, pieces] of groupByMark(model.members)) {
    const m = pieces[0] as Member;
    const l = cutLengths(m);
    const profil = getProfile(m.profileId);
    /*
     * ⚠ Masse de la pièce FINIE, grugeages déduits — et non masse de la barre
     * brute. Les deux diffèrent, et la nomenclature affichait la seconde sous un
     * total intitulé « masse à livrer » : le logiciel annonçait alors 29 776 kg
     * en synthèse et 29 771 kg au colisage, deux chiffres sous le même nom.
     *
     * Ce qu'on livre, lève et pèse au pont bascule, c'est la pièce grugée. La
     * barre à COMMANDER, elle, est décrite par `lengthMax` : c'est la fibre la
     * plus longue qui fixe la longueur à sortir du stock, pas la masse.
     */
    const massUnit = memberMassKg(m);
    out.push({
      mark,
      designation: libelleRole(m),
      profileId: profil.id,
      grade: m.grade,
      length: l.axis,
      lengthMax: l.max,
      angleStart: cutAngleDeg(m, 'start'),
      angleEnd: cutAngleDeg(m, 'end'),
      holes: m.holes.length,
      notches: m.notches.length,
      quantity: pieces.length,
      massUnit,
      massTotal: massUnit * pieces.length,
      paintM2: memberPaintM2(m) * pieces.length,
    });
  }

  // Jarrets : ce ne sont pas des barres prismatiques, leur longueur est celle du
  // tronçon découpé.
  const parRepere = new Map<string, Haunch[]>();
  for (const h of model.haunches) {
    parRepere.set(h.mark, [...(parRepere.get(h.mark) ?? []), h]);
  }
  for (const [mark, jarrets] of parRepere) {
    const h = jarrets[0] as Haunch;
    const l = Math.hypot(h.tip.x - h.root.x, h.tip.y - h.root.y, h.tip.z - h.root.z);
    const massUnit = haunchMassKg(h);
    out.push({
      mark,
      designation: 'Jarret',
      profileId: getProfile(h.profileId).id,
      grade: h.grade,
      length: l,
      lengthMax: Math.hypot(l, h.rootDepth),
      angleStart: 0,
      angleEnd: 0,
      holes: 0,
      notches: 0,
      quantity: jarrets.length,
      massUnit,
      massTotal: massUnit * jarrets.length,
      paintM2: haunchPaintM2(h) * jarrets.length,
    });
  }

  return out;
}

/**
 * LISTE DES TÔLES. Les platines, goussets et éclisses se débitent à part : ce
 * n'est pas de la barre mais de la tôle, souvent découpée sur une autre machine.
 */
export interface ToleLine {
  readonly mark: string;
  readonly designation: string;
  readonly grade: SteelGradeId;
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly holes: number;
  readonly holeDiameter: number;
  readonly quantity: number;
  readonly massUnit: number;
  readonly massTotal: number;
  /** Deux faces et chant : une tôle se peint et se facture comme une barre. */
  readonly paintM2: number;
}


export function toleList(model: StructuralModel, masse: (pl: Plate) => number): ToleLine[] {
  const parRepere = new Map<string, Plate[]>();
  for (const pl of model.plates) {
    parRepere.set(pl.mark, [...(parRepere.get(pl.mark) ?? []), pl]);
  }

  const out: ToleLine[] = [];
  for (const [mark, toles] of parRepere) {
    const pl = toles[0] as Plate;
    const ys = pl.outline.map((q) => q.y);
    const zs = pl.outline.map((q) => q.z);
    const massUnit = masse(pl);
    out.push({
      mark,
      designation: LIBELLE_TOLE[pl.kind],
      grade: pl.grade,
      width: Math.max(...ys) - Math.min(...ys),
      height: Math.max(...zs) - Math.min(...zs),
      thickness: pl.thickness,
      holes: pl.holes.length,
      holeDiameter: pl.holes[0]?.d ?? 0,
      quantity: toles.length,
      massUnit,
      massTotal: massUnit * toles.length,
      paintM2: platePaintM2(pl) * toles.length,
    });
  }
  return out;
}

/** Libellé lisible du rôle d'une pièce, pour la colonne « désignation ». */
function libelleRole(m: Member): string {
  const libelles: Record<Member['role'], string> = {
    poteau: 'Poteau',
    traverse: 'Traverse',
    console: 'Console de débord',
    jarret: 'Jarret',
    panne: 'Panne',
    lisse: 'Lisse de bardage',
    potelet: 'Potelet de pignon',
    chevetre: 'Chevêtre d’ouverture',
    'membrure-sup': 'Arbalétrier',
    'membrure-inf': 'Entrait',
    montant: 'Montant',
    diagonale: 'Diagonale',
    contreventement: 'Contreventement',
    lierne: 'Lierne',
    attache: 'Cornière d’attache',
    equerre: 'Équerre de lisse',
    libre: 'Barre libre',
  };
  return libelles[m.role];
}
