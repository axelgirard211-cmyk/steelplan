import { getProfile } from '../catalog/index';
import type { CutPlane } from '../geometry/member';
import { add, normalize, scale, sub, v3, type Vec3 } from '../math/vec3';
import type { ProjectParams } from '../model/project';

/**
 * GÉOMÉTRIE DU GENOU — poteau, traverse, jarret et platine d'about.
 *
 * Détail retenu, le plus courant en portique jarreté : le POTEAU MONTE jusqu'en
 * tête ; la TRAVERSE et son JARRET s'arrêtent sur une platine d'about verticale,
 * soudée sur eux et boulonnée sur la SEMELLE INTÉRIEURE du poteau. Le débord de
 * toiture, s'il y en a un, est une CONSOLE distincte boulonnée sur la semelle
 * extérieure.
 *
 * ⚠⚠ Le détail précédent faisait passer la traverse PAR-DESSUS le poteau, tout
 * en boulonnant une platine sur la semelle intérieure : le jarret pénétrait le
 * poteau sur une demi-hauteur, et la moitié des boulons de la platine tombaient
 * sous le jarret, face à rien. Aucun chiffre ne le trahissait — seul le dessin
 * du détail, lu comme un atelier le lirait, montrait une pièce infabricable.
 *
 * ⚠ UNE SEULE fonction pour toutes les cotes du genou. Le poteau y prend sa
 * coupe de tête, la traverse sa coupe d'about, le jarret sa racine et la platine
 * son contour et ses perçages : calculées à part, ces quatre cotes divergeraient
 * dès la première modification d'un profil.
 *
 * Les LIGNES D'ÉPURE ne bougent pas : le point de travail reste l'intersection
 * des axes du poteau et de la traverse. Seuls les PLANS DE COUPE changent, et le
 * modèle de calcul — qui lit les points de travail — n'en est pas affecté.
 */
export interface Genou {
  /** Plan de coupe de la traverse : face d'appui contre la platine, verticale. */
  readonly coupeTraverse: CutPlane;
  /** Racine du jarret : sur l'axe de la traverse, dans ce même plan. */
  readonly racineJarret: Vec3;
  /**
   * Plan de coupe en tête du poteau : DANS LE PLAN DU DESSUS DE TRAVERSE. La
   * panne sablière s'y pose, à l'aplomb du poteau, comme sur la traverse.
   */
  readonly coupePoteau: CutPlane;
  readonly platine: {
    /** Centre de la tôle, à mi-épaisseur. */
    readonly centre: Vec3;
    readonly hauteur: number;
    readonly largeur: number;
    /** Hauteur où se répartissent les boulons : la traverse et son jarret. */
    readonly hauteurUtile: number;
    /** Altitude du milieu de cette bande — le centre de la grille de boulons. */
    readonly zGrille: number;
  };
}

/**
 * Normale « haut » d'une traverse de direction `d` : perpendiculaire à elle,
 * dans le plan du portique, tournée vers le ciel quel que soit le sens de `d`.
 */
function hautDeTraverse(d: Vec3): Vec3 {
  const n = normalize(v3(0, -d.z, d.y));
  return n.z >= 0 ? n : scale(n, -1);
}

/**
 * Genou au point de travail `travail`, la traverse partant vers `versTravee`.
 *
 * @param profilPoteau  profil du poteau de CETTE file (les pignons peuvent différer)
 * @param profilTraverse profil de la traverse de cette file
 * @param avecJarret    le jarret de genou existe-t-il ?
 */
export function genou(
  p: ProjectParams,
  travail: Vec3,
  versTravee: Vec3,
  profilPoteau: string,
  profilTraverse: string,
  avecJarret: boolean,
): Genou {
  const ep = p.connections.rafterToColumn;
  const po = getProfile(profilPoteau);
  const tr = getProfile(profilTraverse);
  const d = normalize(versTravee);
  const signe = d.y >= 0 ? 1 : -1;

  // Face de coupe de la traverse : semelle intérieure du poteau, plus l'épaisseur
  // de la platine qui s'y plaque.
  const yCoupe = travail.y + signe * (po.h / 2 + ep.thickness);
  const racine = surLAxeEnY(travail, d, yCoupe);

  /*
   * Hauteurs VERTICALES : la coupe est d'aplomb, et une section inclinée de α y
   * présente une hauteur h / cos α. Prendre h laissait la semelle haute de la
   * traverse dépasser de la platine d'une dizaine de millimètres.
   */
  const cosA = Math.max(0.2, Math.hypot(d.x, d.y));
  const demiTraverse = tr.h / 2 / cosA;
  const zHaut = racine.z + demiTraverse;
  const sousJarret = avecJarret ? Math.max(0, p.frame.haunch.depth - tr.h) : 0;
  const zBas = racine.z - demiTraverse - sousJarret;

  /*
   * La platine AFFLEURE le dessus de traverse et ne déborde que vers le bas. Un
   * débord en tête aurait dépassé de la tête de poteau, coupée dans le plan de
   * la couverture, et heurté l'échantignolle de la panne sablière.
   */
  const hauteurUtile = zHaut - zBas;
  const hauteur = hauteurUtile + ep.overhang;
  const centre = v3(
    travail.x,
    travail.y + signe * (po.h / 2 + ep.thickness / 2),
    zHaut - hauteur / 2,
  );
  const haut = hautDeTraverse(d);

  return {
    coupeTraverse: {
      point: v3(travail.x, yCoupe, racine.z),
      // Vers l'extérieur de la traverse, c'est-à-dire vers le poteau.
      normal: v3(0, -signe, 0),
    },
    racineJarret: racine,
    coupePoteau: { point: add(travail, scale(haut, tr.h / 2)), normal: haut },
    platine: {
      centre,
      hauteur,
      largeur: po.b + 2 * ep.overhang,
      hauteurUtile,
      zGrille: (zHaut + zBas) / 2,
    },
  };
}

/**
 * CONSOLE DE DÉBORD : le porte-à-faux de toiture, du nu extérieur du poteau à
 * la rive. Pièce à part, boulonnée par sa platine sur la semelle extérieure.
 */
export interface Console {
  readonly coupe: CutPlane;
  readonly platine: {
    readonly centre: Vec3;
    readonly hauteur: number;
    readonly largeur: number;
    readonly hauteurUtile: number;
    readonly zGrille: number;
  };
}

export function consoleDeDebord(
  p: ProjectParams,
  travail: Vec3,
  versRive: Vec3,
  profilPoteau: string,
  profilTraverse: string,
): Console {
  const ep = p.connections.rafterToColumn;
  const po = getProfile(profilPoteau);
  const tr = getProfile(profilTraverse);
  const d = normalize(versRive);
  const signe = d.y >= 0 ? 1 : -1;
  const yCoupe = travail.y + signe * (po.h / 2 + ep.thickness);
  const racine = surLAxeEnY(travail, d, yCoupe);
  const cosA = Math.max(0.2, Math.hypot(d.x, d.y));
  const hauteurUtile = tr.h / cosA;
  const hauteur = hauteurUtile + ep.overhang;
  const zHaut = racine.z + hauteurUtile / 2;
  return {
    coupe: { point: v3(travail.x, yCoupe, racine.z), normal: v3(0, -signe, 0) },
    // Affleurante en tête, comme celle du genou : même tête de poteau.
    platine: {
      centre: v3(travail.x, travail.y + signe * (po.h / 2 + ep.thickness / 2), zHaut - hauteur / 2),
      hauteur,
      largeur: po.b + 2 * ep.overhang,
      hauteurUtile,
      zGrille: racine.z,
    },
  };
}

/**
 * Débord STRUCTUREL, en projection horizontale depuis l'axe du poteau (mm) :
 * jusqu'où va la pièce qui porte le débord de toiture.
 *
 * ⚠ Plus loin que la panne de rive, de la largeur de son échantignolle. La
 * console s'arrêtait SOUS l'axe de cette panne : la moitié de sa semelle et de
 * son échantignolle étaient en l'air, et l'échantignolle cherchait en vain un
 * acier où être soudée.
 */
export function debordStructurel(p: ProjectParams): number {
  const pu = p.secondary.purlins;
  if (!pu.enabled || pu.eaveOverhang <= 0) return 0;
  const c = p.connections.purlinCleat;
  return pu.eaveOverhang + (c.enabled ? getProfile(c.profile).b : 0);
}

/**
 * Point de rive d'un porte-à-faux : `debord` est mesuré en PROJECTION
 * HORIZONTALE, comme un débord de toiture se lit sur un plan, donc la longueur
 * suivant le rampant est plus grande de 1/cos(pente).
 */
export function pointDeRive(genouOuAppui: Vec3, versLeFaitage: Vec3, debord: number): Vec3 {
  if (debord <= 0) return genouOuAppui;
  const horizontal = Math.hypot(versLeFaitage.y, versLeFaitage.x);
  if (horizontal < 1e-9) return genouOuAppui;
  return sub(genouOuAppui, scale(versLeFaitage, debord / horizontal));
}

/** Point de la droite (origine, d) d'ordonnée `y`. */
function surLAxeEnY(origine: Vec3, d: Vec3, y: number): Vec3 {
  if (Math.abs(d.y) < 1e-9) return origine;
  return add(origine, scale(d, (y - origine.y) / d.y));
}
