import type { Bbox } from './scene';

/**
 * Échelles NORMALISÉES (NF EN ISO 5455). Une cote se mesure à la règle sur un
 * plan d'atelier : une échelle « qui tombe bien » comme 1:37 rendrait le plan
 * inexploitable. On choisit donc toujours dans cette liste, et jamais autre
 * chose.
 */
export const ECHELLES: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500];

/** Libellé d'échelle tel qu'il figure au cartouche. */
export function libelleEchelle(denominateur: number): string {
  return `1:${denominateur}`;
}

/**
 * Plus grande échelle normalisée à laquelle l'emprise tient dans la fenêtre.
 * « Plus grande » signifie le plus petit dénominateur : on remplit la feuille,
 * car un dessin trop petit est un dessin qu'on ne peut pas coter.
 */
export function choisirEchelle(emprise: Bbox, fenetre: Bbox, marge = 1.0): number {
  const l = (emprise.max.x - emprise.min.x) * marge;
  const h = (emprise.max.y - emprise.min.y) * marge;
  const L = fenetre.max.x - fenetre.min.x;
  const H = fenetre.max.y - fenetre.min.y;
  if (l <= 0 || h <= 0) return 1;

  for (const d of ECHELLES) {
    if (l / d <= L && h / d <= H) return d;
  }
  return ECHELLES[ECHELLES.length - 1] as number;
}
