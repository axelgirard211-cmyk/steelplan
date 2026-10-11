import type { Vec3 } from '../math/vec3';

/**
 * Soudures.
 *
 * Un cordon n'est pas un détail de dessin : c'est une donnée de fabrication. Il
 * porte sa GORGE (la hauteur du triangle inscrit dans le cordon, `a` sur les
 * plans), sa longueur, et son caractère continu ou interrompu. Le symbole
 * normalisé tracé sur les plans n'est qu'une projection de ces valeurs — comme
 * une cote, il ne les invente pas.
 */
export type WeldType = 'angle' | 'angle-double' | 'bout-a-bout' | 'bouchon';

export interface Weld {
  readonly id: string;
  readonly type: WeldType;
  /** Gorge du cordon (mm) : la cote `a` du symbole. */
  readonly throat: number;
  /**
   * Longueur d'UN brin de cordon (mm). Pour un cordon de pourtour, c'est le
   * périmètre du profil : il compte déjà les deux faces de l'âme et des semelles.
   */
  readonly length: number;
  readonly continuous: boolean;
  /**
   * Cordon « sur le pourtour » de la pièce — symbole ○ au coude de la ligne de
   * repère. Un tel cordon est UN brin, de la longueur du contour.
   */
  readonly pourtour: boolean;
  /** Identifiants des deux pièces assemblées. */
  readonly between: readonly [string, string];
  /** Point d'amorce, pour poser la ligne de repère sur les plans. */
  readonly at: Vec3;
  readonly note: string;
}

/**
 * Gorge minimale d'un cordon d'angle assemblant deux tôles.
 *
 * Règle d'atelier : a ≈ 0,7 × la plus faible des deux épaisseurs, arrondie au
 * millimètre, avec un minimum de 3 mm. En dessous, le cordon refroidit trop vite
 * et se fissure ; au-dessus de l'épaisseur assemblée, on dépose du métal pour
 * rien.
 */
export function gorgeUsuelle(epaisseurA: number, epaisseurB: number): number {
  const mini = Math.min(epaisseurA, epaisseurB);
  return Math.max(3, Math.round(0.7 * mini));
}

/** Soudure des semelles d'une barre sur sa platine d'about. */
export type SoudureSemelles = 'angle' | 'pleine-penetration';

export interface CordonsDePlatine {
  readonly semelle: { readonly type: WeldType; readonly gorge: number };
  readonly ame: { readonly type: WeldType; readonly gorge: number };
}

/**
 * Cordons d'une barre en I ou en U sur sa platine d'about : SEMELLES et ÂME,
 * chacune à sa gorge.
 *
 * ⚠ La règle UNIQUE du modèle et du calcul. Le modèle posait un seul cordon de
 * pourtour à la gorge de l'âme (a6 sur un IPE 360) quand la vérification
 * créditait les semelles d'un cordon à la gorge de la semelle (a9) : le plan
 * d'atelier demandait moins que ce que le calcul avait supposé. Et un a9 tout
 * autour aurait brûlé une âme de 8 mm.
 *
 * À pleine pénétration, la semelle est soudée bout à bout sur toute son
 * épaisseur : sa résistance est celle de la semelle (EN 1993-1-8 § 4.7.1).
 */
export function cordonsDePlatine(tp: number, tf: number, tw: number, soudure: SoudureSemelles): CordonsDePlatine {
  return {
    semelle: soudure === 'pleine-penetration' ? { type: 'bout-a-bout', gorge: Math.round(tf) } : { type: 'angle-double', gorge: gorgeUsuelle(tp, tf) },
    ame: { type: 'angle-double', gorge: gorgeUsuelle(tp, tw) },
  };
}

/**
 * ⚠ `between[0]` est TOUJOURS la pièce PORTEUSE, `between[1]` la pièce soudée
 * sur elle. C'est ce qui permet de dire, d'un cordon, quelle pièce part de
 * l'atelier avec l'autre.
 */
export function weld(
  id: string,
  type: WeldType,
  throat: number,
  length: number,
  between: readonly [string, string],
  at: Vec3,
  note: string,
  options: { continu?: boolean; pourtour?: boolean } = {},
): Weld {
  return {
    id,
    type,
    throat,
    length,
    continuous: options.continu ?? true,
    pourtour: options.pourtour ?? false,
    between,
    at,
    note,
  };
}

/** Nombre de brins déposés : deux pour un angle double, un sinon. */
export function brins(w: Weld): number {
  return w.type === 'angle-double' ? 2 : 1;
}

/**
 * Longueur de cordon RÉELLEMENT déposée (mm), tous brins compris.
 *
 * ⚠ La seule fonction qui réponde à cette question. Le « × 2 de l'angle
 * double » était réécrit à quatre endroits — nomenclature, gamme, statistiques,
 * chiffrage — et un pourtour déclaré angle double y était compté deux fois
 * partout à la fois, ce qui le rendait cohérent et faux.
 */
export function longueurDeposee(w: Weld): number {
  return Math.max(0, w.length) * brins(w);
}

/**
 * Désignation textuelle d'un cordon, telle qu'elle figure dans une nomenclature
 * de soudure : « a5 — angle double — 2 × 350 mm ».
 */
export function designationSoudure(w: Weld): string {
  const forme = {
    angle: 'angle',
    'angle-double': 'angle double',
    'bout-a-bout': 'bout à bout',
    bouchon: 'bouchon',
  }[w.type];
  const nb = w.type === 'angle-double' ? '2 × ' : '';
  const longueur = w.pourtour
    ? `pourtour ${Math.round(w.length)} mm`
    : `${nb}${Math.round(w.length)} mm`;
  return `a${w.throat} — ${forme} — ${longueur}${w.continuous ? '' : ' (interrompu)'}`;
}

/** Volume de métal déposé (mm³), pour estimer la consommation de fil. */
export function volumeDepose(w: Weld): number {
  // Section d'un cordon d'angle ≈ a²  (triangle isocèle de hauteur a).
  const section = w.throat * w.throat;
  return section * longueurDeposee(w);
}
