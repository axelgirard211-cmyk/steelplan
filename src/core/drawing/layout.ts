import { AVERTISSEMENT } from '../checks/types';
import type { ProjectMeta } from '../model/project';
import { libelleEchelle } from './scale';
import { pt, type Bbox, type DrawScene } from './scene';

/**
 * Mise en page atelier : format, cadre, cartouche.
 *
 * Formats en PAYSAGE, cadre suivant NF EN ISO 5457 : marge de 20 mm côté
 * classement (à gauche) et 10 mm sur les trois autres bords. Le cartouche est en
 * bas à droite, sa case titre lisible dans le sens de lecture de la feuille.
 */
export type SheetFormat = 'A4' | 'A3' | 'A2' | 'A1';

/**
 * Formats ISO 216, en paysage.
 *
 * ⚠ A2 et A1 ne sont pas du confort : une planche d'élévations porte SIX vues
 * du même bâtiment, et les tasser sur une A3 les rendrait toutes trop petites
 * pour qu'on y lise un repère. C'est le format que prend un bureau d'études
 * pour ce document, précisément parce qu'il faut voir tout l'ouvrage d'un coup
 * d'œil sans changer de feuille.
 */
export const FORMATS: Readonly<Record<SheetFormat, { largeur: number; hauteur: number }>> = {
  A4: { largeur: 297, hauteur: 210 },
  A3: { largeur: 420, hauteur: 297 },
  A2: { largeur: 594, hauteur: 420 },
  A1: { largeur: 841, hauteur: 594 },
};

const MARGE_CLASSEMENT = 20;
const MARGE = 10;
const CARTOUCHE_L = 180;
const CARTOUCHE_H = 40;

export interface CartoucheData {
  readonly meta: ProjectMeta;
  readonly titre: string;
  readonly echelle: number;
  readonly page: number;
  /** 0 : la planche sera numérotée quand le dossier entier sera connu. */
  readonly total: number;
}

/**
 * Marqueur du numéro de planche, remplacé en fin de constitution du dossier.
 *
 * ⚠ Le dossier comptait ses planches À L'AVANCE pour écrire « n/N » au
 * cartouche : chaque nouvelle sorte de planche devait être ajoutée au compte, et
 * chaque planche conditionnelle retirée à la main. Le compte a déjà été faux —
 * « 12/56 » sur un dossier de 55. On numérote désormais APRÈS : le compte ne
 * peut plus diverger de ce qu'il compte.
 */
export const PAGE_A_NUMEROTER = '§page§';

/**
 * Trace le cadre et le cartouche, et renvoie la FENÊTRE DE DESSIN restante.
 * C'est cette fenêtre, et non la feuille entière, que les générateurs de planches
 * doivent remplir : rien ne doit venir sous le cartouche.
 */
export function dessinerCadre(
  s: DrawScene,
  format: SheetFormat,
  c: CartoucheData,
): Bbox {
  const f = FORMATS[format];

  // Cadre.
  const x0 = MARGE_CLASSEMENT;
  const y0 = MARGE;
  const x1 = f.largeur - MARGE;
  const y1 = f.hauteur - MARGE;
  s.rectangle(pt(x0, y0), pt(x1, y1), 'cadre');

  // Cartouche, ancré dans l'angle bas-droit du cadre.
  const cx0 = x1 - CARTOUCHE_L;
  const cy0 = y0;
  s.rectangle(pt(cx0, cy0), pt(x1, cy0 + CARTOUCHE_H), 'cartouche');

  const ligne = (y: number): void => {
    s.ligne(pt(cx0, y), pt(x1, y), 'cartouche');
  };
  const colonne = (x: number, ya: number, yb: number): void => {
    s.ligne(pt(x, ya), pt(x, yb), 'cartouche');
  };

  const yTitre = cy0 + CARTOUCHE_H - 14;
  const yInfos = cy0 + 8;
  ligne(yTitre);
  ligne(yInfos);

  // Bandeau du haut : projet et client.
  champ(s, pt(cx0 + 2, cy0 + CARTOUCHE_H - 4), 'PROJET', c.meta.nom || '—');
  colonne(cx0 + CARTOUCHE_L / 2, yTitre, cy0 + CARTOUCHE_H);
  champ(s, pt(cx0 + CARTOUCHE_L / 2 + 2, cy0 + CARTOUCHE_H - 4), 'CLIENT', c.meta.client || '—');

  // Bandeau central : le titre de la planche, en gros.
  s.texte(pt(cx0 + 2, yInfos + 2.5), c.titre, { hauteur: 4, gras: true, layer: 'cartouche' });

  // Bandeau du bas : les informations de gestion du document.
  const cases: [string, string][] = [
    ['ÉCHELLE', libelleEchelle(c.echelle)],
    ['DATE', formatDate(c.meta.date)],
    ['INDICE', c.meta.indice || 'A'],
    ['DESSINÉ PAR', c.meta.dessinateur || '—'],
    ['PAGE', c.total > 0 ? `${c.page}/${c.total}` : PAGE_A_NUMEROTER],
  ];
  const largeurCase = CARTOUCHE_L / cases.length;
  for (const [i, [libelle, valeur]] of cases.entries()) {
    const x = cx0 + i * largeurCase;
    if (i > 0) colonne(x, cy0, yInfos);
    s.texte(pt(x + 1.5, cy0 + 5.2), libelle, { hauteur: 1.8, layer: 'cartouche' });
    s.texte(pt(x + 1.5, cy0 + 1.5), valeur, { hauteur: 2.5, gras: true, layer: 'cartouche' });
  }

  dessinerIndices(s, x0, cx0, cy0, c.meta);

  // Mention permanente : ce logiciel ne remplace pas une note de calcul. Le texte
  // vient de la même constante que l'interface et la note de calcul — deux
  // formulations divergentes laisseraient croire à deux portées différentes.
  s.texte(pt(x0 + 1, y0 - 6.5), AVERTISSEMENT, { hauteur: 2, layer: 'cartouche' });

  return {
    min: pt(x0 + 4, cy0 + CARTOUCHE_H + 4),
    max: pt(x1 - 4, y1 - 4),
  };
}

/**
 * Fenêtre de dessin d'une feuille, sans tracer le cadre. Sert à choisir
 * l'échelle avant de savoir ce qu'on va dessiner.
 */
export function fenetreDe(format: SheetFormat): Bbox {
  const f = FORMATS[format];
  return {
    min: pt(MARGE_CLASSEMENT + 4, MARGE + CARTOUCHE_H + 4),
    max: pt(f.largeur - MARGE - 4, f.hauteur - MARGE - 4),
  };
}

function champ(s: DrawScene, at: { x: number; y: number }, libelle: string, valeur: string): void {
  s.texte(pt(at.x, at.y), libelle, { hauteur: 1.8, layer: 'cartouche' });
  s.texte(pt(at.x, at.y - 4.5), valeur, { hauteur: 3, gras: true, layer: 'cartouche' });
}

/** Date ISO → JJ/MM/AAAA, format attendu sur un plan français. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/* ------------------------------------------------------------------ */
/* Tableau des indices                                                 */
/* ------------------------------------------------------------------ */

/** Diffusions affichées au plus : le fichier, lui, garde tout l'historique. */
const INDICES_AFFICHES = 5;
const LARGEUR_INDICES_MAX = 130;

/**
 * TABLEAU DES INDICES, à gauche du cartouche.
 *
 * ⚠ Dans la bande basse de la feuille, que la fenêtre de dessin laisse VIDE sur
 * toute sa largeur : le tableau n'enlève rien à la place du dessin. Le poser
 * au-dessus du cartouche, comme on le voit parfois, aurait mordu dans le coin
 * bas-droit de chaque vue — précisément là où tombent les cotations.
 *
 * Disposition de la planche de bureau d'études prise pour modèle : en-tête EN
 * BAS, la diffusion la plus récente EN HAUT. Une nouvelle diffusion s'ajoute
 * ainsi au-dessus des précédentes, sans déplacer celles déjà lues.
 *
 * Sans historique saisi, une seule ligne : l'indice et la date du cartouche.
 * Rien n'est inventé — pas d'« édition originale » que personne n'a écrite.
 */
function dessinerIndices(
  s: DrawScene,
  xCadre: number,
  xCartouche: number,
  y0: number,
  meta: ProjectMeta,
): void {
  const largeur = Math.min(LARGEUR_INDICES_MAX, xCartouche - xCadre - 4);
  if (largeur < 60) return; // feuille trop étroite : le cartouche suffit
  const xa = xCartouche - largeur;
  const xb = xCartouche;

  const lignes: readonly { indice: string; date: string; objet: string; auteur: string }[] =
    meta.revisions.length > 0
      ? meta.revisions.slice(-INDICES_AFFICHES)
      : [{ indice: meta.indice || 'A', date: meta.date, objet: '', auteur: meta.dessinateur }];

  const hEntete = 5;
  const hLigne = (CARTOUCHE_H - hEntete) / INDICES_AFFICHES;
  const hTotal = hEntete + hLigne * lignes.length;
  s.rectangle(pt(xa, y0), pt(xb, y0 + hTotal), 'cartouche');

  // Colonnes : indice, date, objet (le reste), auteur.
  const cIndice = 11;
  const cDate = 19;
  const cAuteur = Math.min(26, largeur * 0.2);
  const xs = [xa, xa + cIndice, xa + cIndice + cDate, xb - cAuteur, xb];
  for (const x of xs.slice(1, -1)) s.ligne(pt(x, y0), pt(x, y0 + hTotal), 'cartouche');

  // En-tête, en bas.
  s.ligne(pt(xa, y0 + hEntete), pt(xb, y0 + hEntete), 'cartouche');
  for (const [i, t] of ['INDICE', 'DATE', 'OBJET DE LA MODIFICATION', 'AUTEUR'].entries()) {
    s.texte(pt((xs[i] as number) + 1.2, y0 + 1.6), t, { hauteur: 1.6, layer: 'cartouche' });
  }

  // Diffusions, la plus ancienne juste au-dessus de l'en-tête.
  const carMax = Math.floor(((xs[3] as number) - (xs[2] as number) - 2.4) / (2.1 * 0.56));
  for (const [k, r] of lignes.entries()) {
    const yb = y0 + hEntete + k * hLigne;
    if (k > 0) s.ligne(pt(xa, yb), pt(xb, yb), 'cartouche');
    const yt = yb + (hLigne - 2.1) / 2;
    s.texte(pt((xs[0] as number) + 1.2, yt), r.indice || '—', { hauteur: 2.4, gras: true, layer: 'cartouche' });
    s.texte(pt((xs[1] as number) + 1.2, yt), formatDate(r.date), { hauteur: 2.1, layer: 'cartouche' });
    s.texte(pt((xs[2] as number) + 1.2, yt), tronquer(r.objet || '—', carMax), { hauteur: 2.1, layer: 'cartouche' });
    s.texte(pt((xs[3] as number) + 1.2, yt), tronquer(r.auteur || '—', 12), { hauteur: 2.1, layer: 'cartouche' });
  }
}

/** Coupe un libellé trop long, en le signalant : un objet tronqué en silence ment. */
function tronquer(t: string, max: number): string {
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1))}…`;
}
