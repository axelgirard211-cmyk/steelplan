import type { SteelGradeId } from '../catalog/types';
import { buildingLength, type GridParams } from './grid';

/**
 * OUVERTURES DE FAÇADE — portails, portes et châssis.
 *
 * ⚠ Une ouverture n'est pas un trou dans le bardage : c'est une INTERRUPTION DE
 * L'OSSATURE. Les lisses qui la traversaient s'arrêtent, et ce qu'elles
 * portaient doit être repris par un chevêtre — deux montants et un linteau.
 * Dessiner l'ouverture sans son chevêtre donnerait un plan où le bardage tient
 * en l'air sur toute la largeur du portail.
 *
 * ⚠⚠ Ce que le logiciel NE FAIT PAS et qu'il ne faut pas lui prêter : il ne
 * choisit pas la menuiserie, ne vérifie pas l'ancrage du dormant, et ne reprend
 * pas les efforts d'un portail sectionnel sur ses rails de guidage. Il pose
 * l'ossature qui borde le vide et vérifie ses barres comme les autres.
 */

/** Sur quelle façade l'ouverture est percée. */
export type FaceOuverture =
  | 'long-pan-gauche'
  | 'long-pan-droit'
  | 'pignon-ouest'
  | 'pignon-est';

export const FACES_OUVERTURE: readonly FaceOuverture[] = [
  'long-pan-gauche',
  'long-pan-droit',
  'pignon-ouest',
  'pignon-est',
];

export const LIBELLE_FACE: Readonly<Record<FaceOuverture, string>> = {
  'long-pan-gauche': 'Long pan gauche',
  'long-pan-droit': 'Long pan droit',
  'pignon-ouest': 'Pignon ouest',
  'pignon-est': 'Pignon est',
};

/**
 * Nature de l'ouverture.
 *
 * ⚠ Elle ne change RIEN à la géométrie du chevêtre — seule l'allège distingue
 * un châssis d'une porte. Elle est conservée parce qu'elle porte le sens sur le
 * plan et dans la nomenclature : « linteau de portail P1 » se lit, « linteau de
 * l'ouverture 3 » se déchiffre.
 */
export type TypeOuverture = 'portail' | 'porte' | 'chassis';

export const LIBELLE_TYPE: Readonly<Record<TypeOuverture, string>> = {
  portail: 'Portail',
  porte: 'Porte',
  chassis: 'Châssis',
};

export interface Ouverture {
  readonly id: string;
  readonly face: FaceOuverture;
  readonly type: TypeOuverture;
  /**
   * Abscisse du bord GAUCHE le long de la façade (mm), mesurée depuis l'origine
   * de celle-ci : x = 0 sur un long pan, y = 0 sur un pignon.
   */
  readonly position: number;
  readonly largeur: number;
  readonly hauteur: number;
  /**
   * Allège : cote du bord bas au-dessus du sol (mm).
   *
   * ⚠ Nulle pour une porte ou un portail, qui descendent au sol. C'est la SEULE
   * grandeur qui distingue géométriquement un châssis : lui seul reçoit une
   * traverse basse, car lui seul a du bardage sous son ouverture.
   */
  readonly allege: number;
}

export interface OuvertureParams {
  readonly enabled: boolean;
  /** Profil des montants et linteaux. */
  readonly profile: string;
  readonly grade: SteelGradeId;
  readonly items: readonly Ouverture[];
}

export const OUVERTURES_PAR_DEFAUT: OuvertureParams = {
  enabled: false,
  profile: 'UPE 160',
  grade: 'S235',
  items: [],
};

/** Longueur de la façade sur laquelle se mesure l'abscisse d'une ouverture. */
export function longueurFacade(g: GridParams, face: FaceOuverture): number {
  return face.startsWith('long-pan') ? buildingLength(g) : g.span;
}

/**
 * Pourquoi une ouverture est refusée, ou `null` si elle est posable.
 *
 * ⚠ Une ouverture hors limites est REFUSÉE ET NOMMÉE, jamais rabotée en
 * silence. Ramener discrètement un portail de 6 m dans une travée de 5 m
 * donnerait un plan qui ne correspond ni à ce qui a été demandé ni à ce qui sera
 * construit — et personne ne verrait la différence avant le chantier.
 */
export function refusOuverture(
  o: Ouverture,
  g: GridParams,
): string | null {
  const L = longueurFacade(g, o.face);
  if (o.largeur <= 0 || o.hauteur <= 0) {
    return 'largeur et hauteur doivent être positives';
  }
  if (o.position < 0 || o.position + o.largeur > L) {
    return (
      `déborde de la façade : ${(o.position / 1000).toFixed(2)} à ` +
      `${((o.position + o.largeur) / 1000).toFixed(2)} m pour une façade de ` +
      `${(L / 1000).toFixed(2)} m`
    );
  }
  if (o.allege < 0) return 'allège négative';
  /*
   * ⚠ Le linteau doit rester SOUS L'ÉGOUT. Au-dessus commence le rampant, dont
   * la hauteur varie le long de la façade : un chevêtre y serait à cheval sur
   * une pente, et ce n'est plus une ouverture de bardage mais un percement de
   * toiture, que SteelPlan ne traite pas.
   */
  if (o.allege + o.hauteur > g.eaveHeight) {
    return (
      `dépasse l’égout : tête à ${((o.allege + o.hauteur) / 1000).toFixed(2)} m ` +
      `pour un égout à ${(g.eaveHeight / 1000).toFixed(2)} m`
    );
  }
  return null;
}

/**
 * Deux ouvertures de la même façade se chevauchent-elles ?
 *
 * ⚠ Le recouvrement doit être détecté même quand les hauteurs diffèrent : deux
 * ouvertures superposées partageraient des montants et produiraient deux
 * chevêtres imbriqués, donc des barres en double au même endroit.
 */
export function seChevauchent(a: Ouverture, b: Ouverture): boolean {
  if (a.face !== b.face) return false;
  const enX = a.position < b.position + b.largeur && b.position < a.position + a.largeur;
  const enZ =
    a.allege < b.allege + b.hauteur && b.allege < a.allege + a.hauteur;
  return enX && enZ;
}
