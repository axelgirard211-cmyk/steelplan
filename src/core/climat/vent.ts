/**
 * ACTION DU VENT — EN 1991-1-4 et son annexe nationale française.
 *
 * ⚠ Le vent était SAISI en deux nombres : « pression » et « dépression », en
 * kN/m², uniformes. Le rapport le disait lui-même — « les coefficients de
 * pression par zone ne sont pas calculés, les valeurs saisies les résument ».
 * Or ils ne se résument pas : la succion en rive de toiture vaut deux à trois
 * fois celle du milieu, et c'est en rive que le bac s'arrache.
 *
 * Ce module calcule la pression dynamique de pointe qp(z) et les coefficients de
 * pression extérieure par zone. Ce qui en sort n'est plus un chiffre choisi mais
 * un chiffre déduit de la commune, du terrain et de la géométrie.
 */

/** Régions de vent de la carte française, NF EN 1991-1-4/NA. */
export type ZoneVent = '1' | '2' | '3' | '4';

export const ZONES_VENT: readonly ZoneVent[] = ['1', '2', '3', '4'];

/** Vitesse de référence vb,0 (m/s) par région. */
const VITESSE_REFERENCE: Readonly<Record<ZoneVent, number>> = {
  '1': 22,
  '2': 24,
  '3': 26,
  '4': 28,
};

/**
 * Catégories de terrain, EN 1991-1-4 tableau 4.1 complété par l'annexe française.
 *
 * ⚠ Le choix du terrain pèse autant que celui de la région : entre la mer
 * (catégorie 0) et la ville dense (IV), la pression de pointe varie du simple au
 * double à hauteur d'égout. Une erreur de catégorie coûte plus cher qu'une
 * erreur de région.
 */
export type CategorieTerrain = '0' | 'II' | 'IIIa' | 'IIIb' | 'IV';

export const TERRAINS: readonly CategorieTerrain[] = ['0', 'II', 'IIIa', 'IIIb', 'IV'];

export const LIBELLE_TERRAIN: Readonly<Record<CategorieTerrain, string>> = {
  '0': '0 — mer, zone côtière exposée aux vents de mer',
  II: 'II — rase campagne, obstacles isolés',
  IIIa: 'IIIa — campagne avec haies, bocage',
  IIIb: 'IIIb — zone urbanisée ou industrielle',
  IV: 'IV — ville dense, au moins 15 % de bâti de plus de 15 m',
};

const TERRAIN: Readonly<Record<CategorieTerrain, { z0: number; zmin: number }>> = {
  '0': { z0: 0.005, zmin: 1 },
  II: { z0: 0.05, zmin: 2 },
  IIIa: { z0: 0.2, zmin: 5 },
  IIIb: { z0: 0.5, zmin: 9 },
  IV: { z0: 1.0, zmin: 15 },
};

/** Masse volumique de l'air (kg/m³), EN 1991-1-4 § 4.5. */
const RHO = 1.225;
/** Longueur de rugosité de la catégorie II, référence du coefficient kr. */
const Z0_II = 0.05;

export interface PressionDynamique {
  /** Vitesse de référence de la région (m/s). */
  readonly vb: number;
  /** Vitesse moyenne à la hauteur retenue (m/s). */
  readonly vm: number;
  /** Intensité de turbulence. */
  readonly iv: number;
  /** Pression dynamique de pointe (kN/m²). */
  readonly qp: number;
  /** Hauteur de référence effectivement employée (m). */
  readonly ze: number;
}

/**
 * Pression dynamique de pointe qp(z), EN 1991-1-4 § 4.5.
 *
 * ⚠ La hauteur est PLAFONNÉE PAR LE BAS à zmin. Sous cette hauteur le profil
 * logarithmique n'a plus de sens — il donnerait une vitesse nulle au sol, puis
 * négative. Un auvent de 3 m en terrain IV serait calculé sans vent.
 */
export function pressionDynamique(
  zone: ZoneVent,
  terrain: CategorieTerrain,
  hauteur: number,
  cdir = 1,
  cSaison = 1,
): PressionDynamique {
  const t = TERRAIN[terrain];
  const ze = Math.max(t.zmin, hauteur);
  const vb = cdir * cSaison * VITESSE_REFERENCE[zone];

  const kr = 0.19 * (t.z0 / Z0_II) ** 0.07;
  const cr = kr * Math.log(ze / t.z0);
  // co : coefficient d'orographie, 1,00 hors relief marqué.
  const co = 1;
  const vm = cr * co * vb;
  const iv = 1 / (co * Math.log(ze / t.z0));

  // qp en N/m², ramenée en kN/m² pour rester dans les unités du modèle.
  const qp = ((1 + 7 * iv) * 0.5 * RHO * vm * vm) / 1000;
  return { vb, vm, iv, qp, ze };
}

/* ------------------------------------------------------------------ */
/* Coefficients de pression extérieure                                 */
/* ------------------------------------------------------------------ */

/**
 * Parois verticales, EN 1991-1-4 tableau 7.1.
 *
 * D est la face AU VENT (pression, positive), E la face SOUS LE VENT (succion).
 * A, B, C sont les zones des pignons, du bord au fond.
 */
export interface CoefficientsParoi {
  readonly A: number;
  readonly B: number;
  readonly C: number;
  readonly D: number;
  readonly E: number;
}

export function coefficientsParoi(h: number, d: number): CoefficientsParoi {
  const r = d > 0 ? h / d : 1;
  /*
   * ⚠ Seules D et E dépendent de h/d ; A, B et C n'en dépendent pas. Les faire
   * varier toutes reviendrait à inventer une dépendance que le tableau ne donne
   * pas.
   */
  const entre = (bas: number, haut: number, r0: number, r1: number): number =>
    r <= r0 ? bas : r >= r1 ? haut : bas + ((haut - bas) * (r - r0)) / (r1 - r0);

  /*
   * ⚠ E s'interpole sur DEUX intervalles, −0,3 → −0,5 puis −0,5 → −0,7. Une
   * première version passait directement à −0,5 dès que h/d dépassait 0,25 :
   * le coefficient sautait d'un cran au franchissement du seuil, et un hangar de
   * h/d = 0,26 était calculé comme un h/d = 1. C'est le genre de discontinuité
   * qu'un tableau interpolé ne doit jamais produire.
   */
  return {
    A: -1.2,
    B: -0.8,
    C: -0.5,
    D: entre(0.7, 0.8, 0.25, 1),
    E: r <= 1 ? entre(-0.3, -0.5, 0.25, 1) : entre(-0.5, -0.7, 1, 5),
  };
}

/**
 * Toiture à deux versants, vent perpendiculaire au faîtage (θ = 0°),
 * EN 1991-1-4 tableau 7.4a.
 *
 * ⚠ Chaque zone porte DEUX valeurs entre 5° et 45° : la norme impose d'examiner
 * les deux, parce que le signe de la pression sur un versant peu pentu n'est pas
 * déterminé. Ne retenir que la succion laisserait de côté le cas où la toiture
 * est POUSSÉE — celui qui gouverne les pannes du versant au vent.
 */
export interface CoefficientsToiture {
  /** Angle interpolé (degrés). */
  readonly pente: number;
  /** Rive du versant au vent : la zone la plus aspirée de toute la toiture. */
  readonly F: readonly [number, number];
  /** Courant du versant au vent, hors rive. */
  readonly G: readonly [number, number];
  /** Reste du versant au vent. */
  readonly H: readonly [number, number];
  /** Versant sous le vent, près du faîtage. */
  readonly I: readonly [number, number];
  /** Versant sous le vent, au-delà. */
  readonly J: readonly [number, number];
}

/** Table 7.4a : angle → [F, G, H, I, J], chaque zone en [négatif, positif]. */
const TABLE_TOITURE: readonly {
  a: number;
  z: Readonly<Record<'F' | 'G' | 'H' | 'I' | 'J', readonly [number, number]>>;
}[] = [
  { a: 5, z: { F: [-1.7, 0], G: [-1.2, 0], H: [-0.6, 0], I: [-0.6, 0], J: [-0.6, 0.2] } },
  { a: 15, z: { F: [-0.9, 0.2], G: [-0.8, 0.2], H: [-0.3, 0.2], I: [-0.4, 0], J: [-1.0, 0] } },
  { a: 30, z: { F: [-0.5, 0.7], G: [-0.5, 0.7], H: [-0.2, 0.4], I: [-0.4, 0], J: [-0.5, 0] } },
  { a: 45, z: { F: [0, 0.7], G: [0, 0.7], H: [0, 0.6], I: [-0.2, 0], J: [-0.3, 0] } },
  { a: 60, z: { F: [0, 0.7], G: [0, 0.7], H: [0, 0.7], I: [-0.2, 0], J: [-0.3, 0] } },
];

export function coefficientsToiture(penteDeg: number): CoefficientsToiture {
  const a = Math.min(60, Math.max(5, Math.abs(penteDeg)));
  let bas = TABLE_TOITURE[0] as (typeof TABLE_TOITURE)[number];
  let haut = bas;
  for (const ligne of TABLE_TOITURE) {
    if (ligne.a <= a) bas = ligne;
    if (ligne.a >= a) {
      haut = ligne;
      break;
    }
  }
  const k = haut.a === bas.a ? 0 : (a - bas.a) / (haut.a - bas.a);
  const lerp = (zone: 'F' | 'G' | 'H' | 'I' | 'J'): readonly [number, number] => [
    bas.z[zone][0] + k * (haut.z[zone][0] - bas.z[zone][0]),
    bas.z[zone][1] + k * (haut.z[zone][1] - bas.z[zone][1]),
  ];

  return { pente: a, F: lerp('F'), G: lerp('G'), H: lerp('H'), I: lerp('I'), J: lerp('J') };
}

/**
 * Succion la plus défavorable de toute la toiture, tous zonages confondus.
 *
 * C'est elle qui décide de l'ancrage et du soulèvement d'ensemble. La zone F —
 * la rive du versant au vent — la porte presque toujours.
 */
export function succionMaximale(c: CoefficientsToiture): number {
  return Math.min(c.F[0], c.G[0], c.H[0], c.I[0], c.J[0]);
}

/* ------------------------------------------------------------------ */
/* Zonage réel de la toiture                                           */
/* ------------------------------------------------------------------ */

export interface ZonageToiture {
  /** Dimension de référence e = min(b, 2h) (m). */
  readonly e: number;
  /** Aire de chaque zone, en projection horizontale (m²). */
  readonly aires: Readonly<Record<'F' | 'G' | 'H' | 'I' | 'J', number>>;
  /** Coefficient MOYEN pondéré par les aires : ce que subit l'ossature. */
  readonly cpeMoyen: number;
  /** Coefficient de POINTE : ce que subit la fixation de bac en rive. */
  readonly cpePointe: number;
}

/**
 * Découpage réel d'une toiture à deux versants, EN 1991-1-4 figure 7.8.
 *
 * ⚠ Ce module existe parce que retenir la succion de RIVE sur toute la toiture
 * était faux, et faux dans une proportion qui condamnait des bâtiments corrects.
 * La zone F ne couvre qu'une bande de e/10 de profondeur aux deux angles au
 * vent : sur un hangar de 30 × 20 m, c'est 10 m² sur 600. Lui donner toute la
 * toiture triplait le soulèvement d'ensemble.
 *
 * Les deux grandeurs ont chacune leur emploi, et les confondre est l'erreur :
 *  - le coefficient MOYEN dimensionne l'ossature et les ancrages, parce que
 *    c'est la résultante qui soulève le bâtiment ;
 *  - le coefficient de POINTE dimensionne la fixation du bac en rive, parce que
 *    c'est là qu'une vis lâche.
 *
 * `b` est la dimension perpendiculaire au vent, `d` celle dans son sens, `h` la
 * hauteur du bâtiment — toutes en mètres.
 */
export function zonageToiture(
  c: CoefficientsToiture,
  b: number,
  d: number,
  h: number,
): ZonageToiture {
  const e = Math.min(b, 2 * h);
  // Profondeur de la bande de rive, plafonnée par le demi-versant.
  const t = Math.min(e / 10, d / 2);
  const largeurF = Math.min(b, e / 2);
  const largeurG = Math.max(0, b - largeurF);

  const aires = {
    F: largeurF * t,
    G: largeurG * t,
    H: b * Math.max(0, d / 2 - t),
    J: b * t,
    I: b * Math.max(0, d / 2 - t),
  };

  const total = Object.values(aires).reduce((s, a) => s + a, 0);
  // On pondère sur la valeur NÉGATIVE de chaque zone : c'est le soulèvement qui
  // décide de l'ancrage, et c'est le cas dimensionnant d'une toiture légère.
  const somme =
    aires.F * c.F[0] + aires.G * c.G[0] + aires.H * c.H[0] + aires.I * c.I[0] + aires.J * c.J[0];

  return {
    e,
    aires,
    cpeMoyen: total > 0 ? somme / total : 0,
    cpePointe: succionMaximale(c),
  };
}

/**
 * Coefficients de pression INTÉRIEURE, EN 1991-1-4 § 7.2.9.
 *
 * ⚠ Ils manquaient entièrement, et ils ne sont pas facultatifs : la pression
 * intérieure s'ajoute à l'extérieure sur toute l'enveloppe. Pour un bâtiment
 * sans face dominante, la norme impose d'examiner LES DEUX valeurs, +0,20 et
 * −0,30, et de retenir chaque fois la plus défavorable. Sur une toiture en
 * dépression c'est le +0,20 qui aggrave, sur une paroi au vent c'est le −0,30.
 */
export const CPI_POSITIF = 0.2;
export const CPI_NEGATIF = -0.3;
