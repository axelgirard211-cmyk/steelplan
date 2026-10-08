import { roundMm } from '../../math/tolerance';
import { coteLineaire } from '../dimension';
import { pt, type DrawScene, type Pt } from '../scene';
import type { Axial } from './axial';
import { ECART_LISIBLE } from './axial';
import type { Vue } from './vue';

/**
 * COTATION D'UNE VUE DE BARRE.
 *
 * ⚠ Cotation CUMULÉE depuis l'about d'origine, et non chaîne de cotes
 * partielles. Sur une barre percée en vingt endroits, une chaîne accumule les
 * arrondis — vingt cotes au millimètre, c'est jusqu'à un centimètre d'erreur au
 * bout — et oblige le traceur à additionner. La cote cumulée se reporte au mètre
 * ruban depuis un seul point, et c'est aussi ainsi que le fichier de la machine
 * repère ses trous.
 */

const TEXTE = 2.0;

export interface CoteCumulee {
  /** Abscisse modèle cotée. */
  readonly s: number;
  /** Point papier coté, sur la vue. */
  readonly vise: Pt;
}

/**
 * Ligne de cotes cumulées sous (ou sur) une vue. `yLigne` est l'ordonnée papier
 * de la ligne d'origine ; les valeurs sont écrites verticalement, et décalées
 * sur un petit renvoi quand deux abscisses sont trop proches pour deux textes.
 */
export function cotesCumulees(
  s: DrawScene,
  origine: { s: number; x: number },
  points: readonly CoteCumulee[],
  yLigne: number,
  sens: 1 | -1,
): number {
  const uniques = [...new Map(points.map((p) => [Math.round(p.s), p])).values()].sort((a, b) => a.s - b.s);
  if (uniques.length === 0) return yLigne;

  // Origine : le petit cercle et le zéro, comme on le dessine à la main.
  const yO = yLigne;
  s.cercle(pt(origine.x, yO), 0.9, 'cotation');
  s.texte(pt(origine.x - 1.5, yO - sens * 1.2), '0', { hauteur: TEXTE, ancrage: 'droite', ligneDeBase: 'milieu' });
  const xMax = Math.max(origine.x, ...uniques.map((p) => p.vise.x));
  s.ligne(pt(origine.x, yO), pt(xMax, yO), 'cotation');

  let xTexte = -Infinity;
  for (const p of uniques) {
    const x = p.vise.x;
    // Ligne d'attache, de la vue jusqu'à la ligne de cote.
    s.ligne(pt(x, p.vise.y - sens * 1.5), pt(x, yO + sens * 0.8), 'cotation');
    // Le texte se range à droite du précédent s'il le toucherait.
    const xt = Math.max(x, xTexte + ECART_LISIBLE);
    if (xt > x + 0.05) {
      s.ligne(pt(x, yO + sens * 0.8), pt(xt, yO + sens * 2.4), 'cotation');
    }
    s.texte(pt(xt + 0.7, yO + sens * 2.4), `${roundMm(p.s - origine.s)}`, {
      hauteur: TEXTE,
      rotation: 90,
      ancrage: sens > 0 ? 'gauche' : 'droite',
      ligneDeBase: 'milieu',
    });
    xTexte = xt;
  }
  // Encombrement de la cotation : la ligne, plus la hauteur du plus long texte.
  const long = Math.max(...uniques.map((p) => `${roundMm(p.s - origine.s)}`.length));
  return yO + sens * (2.4 + long * TEXTE * 0.62 + 1);
}

/**
 * Chaîne transversale d'un groupe de perçages : du bord de la pièce au premier
 * trou, d'un trou au suivant, du dernier au bord opposé. C'est elle qui donne
 * les pinces et l'entraxe des files — la cote cumulée ne dit que l'abscisse.
 */
export function chaineTransversale(
  s: DrawScene,
  v: Vue,
  sCote: number,
  positions: readonly number[],
  xCote: number,
): void {
  const ts = [...new Set(positions.map((t) => Math.round(t * 10) / 10))].sort((a, b) => a - b);
  if (ts.length === 0) return;
  const bornes = [v.tMin, ...ts, v.tMax];
  /*
   * ⚠ Les valeurs s'écrivent HORIZONTALEMENT, à gauche de la chaîne, au milieu
   * de chaque intervalle. Une cote linéaire classique les reportait hors de
   * la ligne dès que l'intervalle était plus court que son texte — le cas
   * d'une pince de 40 mm au 1:20 — et les trois textes s'empilaient au-dessus
   * de la vue, l'un sur l'autre.
   */
  const x0 = xCote;
  const yDe = (t: number): number => v.P(sCote, t).y;
  s.ligne(pt(x0, yDe(v.tMin)), pt(x0, yDe(v.tMax)), 'cotation');
  let dernier = -Infinity;
  for (let i = 0; i < bornes.length; i++) {
    const y = yDe(bornes[i] as number);
    s.ligne(pt(x0 - 1, y - 1), pt(x0 + 1, y + 1), 'cotation');
    if (i === 0) continue;
    const a = bornes[i - 1] as number;
    const b = bornes[i] as number;
    if (b - a < 0.5) continue;
    // Les textes trop proches s'écartent vers le haut, sans jamais se toucher.
    const yt = Math.max((yDe(a) + yDe(b)) / 2, dernier + 2.2);
    s.texte(pt(x0 - 1.6, yt), `${roundMm(b - a)}`, { hauteur: 1.8, ancrage: 'droite', ligneDeBase: 'milieu' });
    dernier = yt;
  }
  // Lignes d'attache horizontales, des trous à la chaîne.
  for (const t of ts) {
    const p = v.P(sCote, t);
    s.ligne(pt(x0 + 1, p.y), pt(p.x - 1.5, p.y), 'cotation');
  }
}

/**
 * Longueur hors-tout, au-dessus de l'élévation. Elle traverse les
 * interruptions : sa valeur est la vraie, et seul le trait est raccourci.
 */
export function coteDeLongueur(
  s: DrawScene,
  a: Pt,
  b: Pt,
  y: number,
  valeur: number,
  ax: Axial,
  xOrigine: number,
  prefixe = '',
  hauteur = 2.6,
): void {
  coteLineaire(s, pt(a.x, y), pt(b.x, y), 0, valeur, { hauteurTexte: hauteur, attaches: false, prefixe });
  for (const p of [a, b]) s.ligne(pt(p.x, p.y), pt(p.x, y + Math.sign(y - p.y) * 2), 'cotation');
  // Marque d'interruption sur la ligne de cote elle-même — sauf là où elle
  // barrerait le chiffre, que la cote écrit en son milieu.
  const milieu = (a.x + b.x) / 2;
  const demiTexte = (`${prefixe}${roundMm(valeur)}`.length * hauteur * 0.62) / 2 + 1.5;
  for (const c of ax.coupures) {
    const xm = xOrigine + (c.x0 + c.x1) / 2;
    if (Math.abs(xm - milieu) < demiTexte) continue;
    s.ligne(pt(xm - 1, y - 1.5), pt(xm + 1, y + 1.5), 'cotation');
  }
}
