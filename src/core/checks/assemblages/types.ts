/**
 * RÉSULTATS DE VÉRIFICATION D'ASSEMBLAGE.
 *
 * ⚠ Un assemblage n'a pas UN taux de travail mais une demi-douzaine, et ils ne
 * décrivent pas le même mode de ruine : un boulon qui casse en cisaillement, une
 * tôle qui s'ovalise, une platine qui plie, un cordon qui se déchire, du béton
 * qui s'écrase. Les résumer à leur maximum ferait perdre la seule information
 * utile — CE QU'IL FAUT CHANGER. On les garde tous, nommés.
 */

export interface VerifAssemblage {
  /** Ce qui est vérifié, en clair : « pression diamétrale sur le poteau ». */
  readonly nom: string;
  /** Sollicitation et résistance, dans l'unité indiquée. */
  readonly ed: number;
  readonly rd: number;
  readonly unite: string;
  readonly ratio: number;
}

export interface AssemblageCheck {
  readonly id: string;
  readonly libelle: string;
  /** Boulonnerie employée, telle qu'elle figure à la nomenclature. */
  readonly boulon: string;
  /** Sollicitations retenues, déjà mises en forme pour la lecture. */
  readonly sollicitations: string;
  readonly combinaison: string;
  readonly verifs: readonly VerifAssemblage[];
  readonly ratio: number;
  /** Nom de la vérification qui gouverne. */
  readonly gouverne: string;
  /**
   * Modes de ruine NON couverts par ce calcul.
   *
   * ⚠ Ils sont affichés avec le résultat, jamais relégués dans une
   * documentation. Un assemblage annoncé « vérifié » alors qu'un mode entier
   * n'a pas été regardé est plus dangereux qu'un assemblage non vérifié : dans
   * le second cas, on sait qu'il reste à faire.
   */
  readonly nonCouvert: readonly string[];
}

/** Assemble les vérifications en un résultat, taux gouvernant compris. */
export function assembler(
  base: Omit<AssemblageCheck, 'ratio' | 'gouverne'>,
): AssemblageCheck {
  let ratio = 0;
  let gouverne = '—';
  for (const v of base.verifs) {
    if (v.ratio > ratio) {
      ratio = v.ratio;
      gouverne = v.nom;
    }
  }
  return { ...base, ratio, gouverne };
}

/** Fabrique une ligne de vérification, le taux calculé une seule fois. */
export function verif(nom: string, ed: number, rd: number, unite: string): VerifAssemblage {
  return {
    nom,
    ed,
    rd,
    unite,
    // Une résistance nulle n'est pas un taux nul : c'est un assemblage
    // impossible, et il doit sauter aux yeux.
    ratio: rd > 0 ? Math.abs(ed) / rd : Math.abs(ed) > 0 ? Infinity : 0,
  };
}
