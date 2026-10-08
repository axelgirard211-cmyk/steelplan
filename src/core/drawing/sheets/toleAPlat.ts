import type { Plate } from '../../build/types';
import { contourDeTrou, designationDeTrou } from '../../geometry/holes';
import type { Pt2 } from '../../geometry/section';
import { chaineDeCotes, coteLineaire, coteRepetee } from '../dimension';
import { choisirEchelle } from '../scale';
import { pt, type Bbox, type DrawScene, type Pt } from '../scene';
import { appliquer, cadrer } from '../view';
import { marquerAxe } from './debit';
import { LARGEUR_CARACTERE } from './note';
import { cotesCumulees } from '../barre/cotes';
import { ECART_LISIBLE } from '../barre/axial';

/**
 * LA TÔLE À PLAT — le plan de découpe d'une platine.
 *
 * ⚠ C'est le seul document qui rende une tôle fabricable. La nomenclature donne
 * ses dimensions hors-tout et le NOMBRE de ses perçages, jamais leur position :
 * on ne découpe pas une platine avec « 4 trous Ø22 ». Cette vue porte le contour
 * et la chaîne de cotes sur les deux axes.
 */

const TEXTE = 2.2;
/** Décalage papier des lignes de cote, de part et d'autre du contour (mm). */
const DECAL = 7;
/**
 * Bande papier à réserver autour de la tôle pour ses cotations (mm).
 *
 * ⚠ En millimètres PAPIER, pas en millimètres du modèle. Une marge exprimée
 * dans le modèle vaut d'autant moins sur la feuille que l'échelle est réduite :
 * à 1:20 les 54 mm réservés ne faisaient plus que 2,7 mm de papier, et les
 * chaînes de cotes de deux platines voisines se chevauchaient.
 *
 * Elle couvre la ligne de cote ET son libellé, qui s'écrit à l'horizontale même
 * sur une cote verticale et déborde donc de la moitié de sa largeur — « 5 × 122
 * = 610 » fait à lui seul une quinzaine de millimètres.
 */
export const MARGE_COTES = DECAL + 9;

/**
 * Largeur PAPIER dont une tôle a besoin si on lui donne `hauteurBox` de haut.
 *
 * ⚠ Les bandes de cotation en font partie. Dimensionner le cadre sur le seul
 * élancement de la tôle donnait à une platine de 260 × 780 un cadre de 26 mm :
 * il ne restait rien pour les cotes, l'échelle tombait à 1:100 et les six
 * entraxes s'écrivaient les uns sur les autres.
 */
export function largeurNecessaire(
  largeur: number,
  hauteur: number,
  hauteurBox: number,
): number {
  const utile = Math.max(8, hauteurBox - 2 * MARGE_COTES);
  return (largeur * utile) / Math.max(1, hauteur) + 2 * MARGE_COTES;
}

/**
 * Une tôle à plat, contour et perçages cotés : c'est son plan de découpe.
 *
 * ⚠ Sans les positions de perçage, une platine ne peut pas être faite. La
 * nomenclature n'en donne que le nombre — d'où cette vue, qui porte la chaîne de
 * cotes sur les deux axes du contour.
 */
export function dessinerToleAPlat(s: DrawScene, pl: Plate, nombre: number, zone: Bbox): void {
  const pts = pl.outline.map((p) => pt(p.y, p.z));
  // L'emprise dépend de l'échelle, qui dépend de l'emprise : on itère jusqu'au
  // point fixe, comme pour les vues d'élément.
  const emprise = (ech: number): Bbox => englobant(pts, MARGE_COTES * ech);
  let echelle = choisirEchelle(emprise(1), zone, 1.05);
  for (let i = 0; i < 3; i++) echelle = choisirEchelle(emprise(echelle), zone, 1.05);
  const t = cadrer(emprise(echelle), zone, echelle);
  const P = (p: Pt2): Pt => appliquer(t, pt(p.y, p.z));

  s.polyligne(pl.outline.map(P), true, 'contour');
  for (const h of pl.holes) {
    if (h.oblong) s.polyligne(contourDeTrou(h).map(P), true, 'contour');
    else s.cercle(P(h.at), h.d / 2 / echelle, 'contour');
    marquerAxe(s, P(h.at), Math.max(h.d / 2 / echelle + 1.5, 2));
  }

  const bbox = englobant(pts, 0);
  const [y0, y1, z0, z1] = [bbox.min.x, bbox.max.x, bbox.min.y, bbox.max.y];

  coteLineaire(s, P({ y: y0, z: z0 }), P({ y: y1, z: z0 }), -DECAL, y1 - y0, { hauteurTexte: 1.9 });
  coteLineaire(s, P({ y: y1, z: z0 }), P({ y: y1, z: z1 }), -DECAL, z1 - z0, { hauteurTexte: 1.9 });

  /*
   * ⚠ Trous nombreux ou serrés — un gousset de treillis — : cotation CUMULÉE
   * depuis le bord, libellés écartés quand ils se toucheraient. La chaîne de
   * cotes partielles y écrivait « 11 », « 17 », « 20 » les uns sur les autres.
   */
  const ys = distinctesTriees(pl.holes.map((h) => h.at.y));
  const zs = distinctesTriees(pl.holes.map((h) => h.at.z));
  const serre = (valeurs: readonly number[], bord: number, papier: (v: number) => number): boolean => {
    const p = [bord, ...valeurs].map(papier).sort((a, b) => a - b);
    return valeurs.length > 3 || p.some((v, i) => i > 0 && v - (p[i - 1] as number) < ECART_LISIBLE + 1);
  };
  if (serre(ys, y0, (y) => P({ y, z: z1 }).x)) {
    const o = P({ y: y0, z: z1 });
    cotesCumulees(s, { s: y0, x: o.x }, ys.map((y) => ({ s: y, vise: P({ y, z: z1 }) })), o.y + DECAL, 1);
  } else {
    coterAxe(s, ys, y0, (y) => P({ y, z: z1 }));
  }
  if (serre(zs, z0, (z) => P({ y: y0, z }).y)) {
    cotesCumuleesVerticales(s, z0, zs, (z) => P({ y: y0, z }), P({ y: y0, z: z0 }).x - DECAL);
  } else {
    coterAxe(s, zs, z0, (z) => P({ y: y0, z }));
  }

  /*
   * ⚠ Deux lignes, chacune ramenée à la largeur de sa vue. Sur une seule ligne,
   * les libellés de six tôles côte à côte s'écrivaient les uns sur les autres :
   * repère, épaisseur et perçage — ce que lit le découpeur — devenaient
   * illisibles précisément là où les tôles sont petites et nombreuses.
   */
  const trous = [...new Set(pl.holes.map((h) => designationDeTrou(h)))];
  const largeurVue = zone.max.x - zone.min.x;
  const lignes = [
    `${pl.mark} — ${nombre}× ép. ${pl.thickness} mm`,
    ...(trous.length > 0 ? [`${pl.holes.length} × ${trous.join(' / ')}`] : []),
  ];
  for (const [i, l] of lignes.entries()) {
    const hauteur = Math.max(1.4, Math.min(TEXTE, largeurVue / (l.length * LARGEUR_CARACTERE)));
    s.texte(pt((zone.min.x + zone.max.x) / 2, zone.min.y - 1 - i * (TEXTE + 0.8)), l, {
      hauteur,
      gras: i === 0,
      ancrage: 'centre',
    });
  }
}

/**
 * Cotes cumulées sur un axe VERTICAL de la tôle : la ligne à gauche de la vue,
 * les valeurs écrites à l'horizontale, écartées vers le haut quand deux
 * ordonnées sont trop proches pour deux textes.
 */
function cotesCumuleesVerticales(
  s: DrawScene,
  origine: number,
  valeurs: readonly number[],
  papierDe: (v: number) => Pt,
  xLigne: number,
): void {
  if (valeurs.length === 0) return;
  const o = papierDe(origine);
  s.cercle(pt(xLigne, o.y), 0.9, 'cotation');
  s.texte(pt(xLigne - 2.4, o.y), '0', { hauteur: 1.9, ancrage: 'droite', ligneDeBase: 'milieu' });
  const yMax = Math.max(...valeurs.map((v) => papierDe(v).y));
  s.ligne(pt(xLigne, o.y), pt(xLigne, yMax), 'cotation');
  let dernier = o.y;
  for (const v of valeurs) {
    const p = papierDe(v);
    s.ligne(pt(p.x - 1.5, p.y), pt(xLigne - 0.8, p.y), 'cotation');
    const yt = Math.max(p.y, dernier + 2.6);
    if (yt > p.y + 0.05) s.ligne(pt(xLigne - 0.8, p.y), pt(xLigne - 2.2, yt), 'cotation');
    s.texte(pt(xLigne - 2.4, yt), `${Math.round(v - origine)}`, { hauteur: 1.9, ancrage: 'droite', ligneDeBase: 'milieu' });
    dernier = yt;
  }
}

/**
 * Cotation des perçages sur un axe : la pince, puis les entraxes.
 *
 * ⚠ Quand les entraxes sont réguliers — le cas d'une platine d'about — on écrit
 * UNE cote « n × e » au lieu de n cotes identiques. C'est la règle déjà tenue
 * sur le plan de débit, et elle vaut ici pour la même raison : six rangées à
 * 122 mm sur une vue de 40 mm produisaient six textes empilés au même endroit,
 * illisibles là où la précision compte le plus.
 */
function coterAxe(
  s: DrawScene,
  abscisses: readonly number[],
  bord: number,
  papierDe: (v: number) => Pt,
): void {
  if (abscisses.length === 0) return;
  const premier = abscisses[0] as number;
  // La pince sur sa propre ligne, un cran plus au large que les entraxes : sur
  // une vue de tôle réduite, les deux libellés se recouvraient.
  coteLineaire(s, papierDe(bord), papierDe(premier), DECAL + 6, premier - bord, {
    hauteurTexte: 1.9,
  });

  const pas = ecarts(abscisses);
  if (pas.length === 0) return;
  const dernier = abscisses[abscisses.length - 1] as number;
  const regulier = pas.length >= 2 && pas.every((e) => Math.abs(e - (pas[0] as number)) <= 1);
  if (regulier) {
    coteRepetee(s, papierDe(premier), papierDe(dernier), DECAL, pas.length, pas[0] as number);
  } else {
    chaineDeCotes(s, abscisses.map(papierDe), DECAL, pas, { total: false });
  }
}

/* ------------------------------------------------------------------ */

function englobant(points: readonly Pt[], marge: number): Bbox {
  if (points.length === 0) return { min: pt(0, 0), max: pt(1, 1) };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    min: pt(Math.min(...xs) - marge, Math.min(...ys) - marge),
    max: pt(Math.max(...xs) + marge, Math.max(...ys) + marge),
  };
}

/** Abscisses distinctes, triées : deux perçages alignés ne se cotent qu'une fois. */
function distinctesTriees(valeurs: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of [...valeurs].sort((a, b) => a - b)) {
    if (out.length === 0 || Math.abs((out[out.length - 1] as number) - v) > 0.5) out.push(v);
  }
  return out;
}

function ecarts(valeurs: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < valeurs.length; i++) {
    out.push((valeurs[i] as number) - (valeurs[i - 1] as number));
  }
  return out;
}
