import { rad2deg, roundMm } from '../math/tolerance';
import { pt, type DrawScene, type Pt } from './scene';

/**
 * Primitives de cotation.
 *
 * ⚠ Règle absolue : les POINTS sont en millimètres papier, la VALEUR inscrite est
 * en millimètres modèle. Les deux sont dissociés exprès. Si la cote se déduisait
 * de la distance papier, toute erreur d'échelle ou de cadrage se transformerait
 * en cote fausse sur le plan ; en portant la valeur du modèle, un défaut de
 * cadrage reste un défaut de présentation, jamais une cote fausse.
 */

/** Dimensions d'habillage, constantes sur le papier quelle que soit l'échelle. */
const FLECHE_L = 3.2;
const FLECHE_D = 1.0;
const JEU_ATTACHE = 1.5;
const DEPASSEMENT = 2.0;
const HAUTEUR_TEXTE = 2.5;

export interface CoteOptions {
  readonly hauteurTexte?: number;
  readonly prefixe?: string;
  readonly suffixe?: string;
  /** Remplace la valeur mesurée par un texte libre (ex. « 6 × 1675 = 10050 »). */
  readonly texte?: string;
  /** Trace les lignes d'attache jusqu'à l'objet coté. */
  readonly attaches?: boolean;
}

const norme = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Cote linéaire entre deux points, ligne de cote décalée de `decalage`
 * (positif = à gauche du sens a→b).
 */
export function coteLineaire(
  s: DrawScene,
  a: Pt,
  b: Pt,
  decalage: number,
  valeur: number,
  opts: CoteOptions = {},
): void {
  const l = norme(a, b);
  if (l < 1e-9) return;
  const ux = (b.x - a.x) / l;
  const uy = (b.y - a.y) / l;
  const nx = -uy;
  const ny = ux;

  const a2 = pt(a.x + nx * decalage, a.y + ny * decalage);
  const b2 = pt(b.x + nx * decalage, b.y + ny * decalage);

  // Lignes d'attache : elles partent de l'objet, avec un jeu, et dépassent la
  // ligne de cote — c'est ce dépassement qui rend la cote lisible.
  if (opts.attaches !== false) {
    const signe = Math.sign(decalage) || 1;
    for (const [p, p2] of [
      [a, a2],
      [b, b2],
    ] as const) {
      s.ligne(
        pt(p.x + nx * signe * JEU_ATTACHE, p.y + ny * signe * JEU_ATTACHE),
        pt(p2.x + nx * signe * DEPASSEMENT, p2.y + ny * signe * DEPASSEMENT),
        'cotation',
      );
    }
  }

  const texte = opts.texte ?? `${opts.prefixe ?? ''}${roundMm(valeur)}${opts.suffixe ?? ''}`;
  const hauteur = opts.hauteurTexte ?? HAUTEUR_TEXTE;
  const placeInterieure = l > 2 * FLECHE_L + texte.length * hauteur * 0.6;

  if (placeInterieure) {
    s.ligne(a2, b2, 'cotation');
    fleche(s, a2, ux, uy);
    fleche(s, b2, -ux, -uy);
  } else {
    // Cote serrée : flèches tournées vers l'extérieur et texte reporté à côté.
    s.ligne(pt(a2.x - ux * FLECHE_L * 2, a2.y - uy * FLECHE_L * 2), a2, 'cotation');
    s.ligne(b2, pt(b2.x + ux * FLECHE_L * 2, b2.y + uy * FLECHE_L * 2), 'cotation');
    s.ligne(a2, b2, 'cotation');
    fleche(s, a2, -ux, -uy);
    fleche(s, b2, ux, uy);
  }

  // Rotation ramenée dans (−90°, 90°] : une cote se lit toujours de gauche à
  // droite ou de bas en haut, jamais tête en bas.
  let angle = rad2deg(Math.atan2(uy, ux));
  while (angle > 90) angle -= 180;
  while (angle <= -90) angle += 180;
  const milieu = placeInterieure
    ? pt((a2.x + b2.x) / 2, (a2.y + b2.y) / 2)
    : pt(b2.x + ux * (FLECHE_L * 2 + 1), b2.y + uy * (FLECHE_L * 2 + 1));

  const dTexte = placeInterieure ? 1.0 : 0;
  s.texte(pt(milieu.x + nx * dTexte, milieu.y + ny * dTexte), texte, {
    hauteur,
    ancrage: placeInterieure ? 'centre' : 'gauche',
    ligneDeBase: placeInterieure ? 'bas' : 'milieu',
    rotation: angle,
  });
}

/**
 * Chaîne de cotes : les cotes partielles alignées sur une même ligne, plus la
 * cote totale au-dessus. C'est la présentation attendue sur un plan d'atelier.
 */
export function chaineDeCotes(
  s: DrawScene,
  points: readonly Pt[],
  decalage: number,
  valeurs: readonly number[],
  opts: { readonly total?: boolean; readonly decalageTotal?: number } = {},
): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length - 1; i++) {
    coteLineaire(
      s,
      points[i] as Pt,
      points[i + 1] as Pt,
      decalage,
      valeurs[i] ?? 0,
      { attaches: true },
    );
  }
  if (opts.total !== false && points.length > 2) {
    const total = valeurs.reduce((a, b) => a + b, 0);
    coteLineaire(
      s,
      points[0] as Pt,
      points[points.length - 1] as Pt,
      opts.decalageTotal ?? decalage + 10,
      total,
      { attaches: false },
    );
  }
}

/**
 * Cote d'entraxes répétés, notée « n × entraxe = total ». Une seule cote
 * remplace n cotes identiques : c'est plus court à lire et sans ambiguïté.
 */
export function coteRepetee(
  s: DrawScene,
  a: Pt,
  b: Pt,
  decalage: number,
  nombre: number,
  entraxe: number,
): void {
  coteLineaire(s, a, b, decalage, nombre * entraxe, {
    texte: `${nombre} × ${roundMm(entraxe)} = ${roundMm(nombre * entraxe)}`,
  });
}

/** Cote angulaire : arc entre deux directions partant d'un sommet. */
export function coteAngulaire(
  s: DrawScene,
  sommet: Pt,
  angleDebut: number,
  angleFin: number,
  rayon: number,
  valeurDeg: number,
  opts: { readonly hauteurTexte?: number } = {},
): void {
  s.arc(sommet, rayon, angleDebut, angleFin, 'cotation');
  const milieu = (angleDebut + angleFin) / 2;
  const r = rayon + 1.8;
  s.texte(
    pt(sommet.x + Math.cos(milieu) * r, sommet.y + Math.sin(milieu) * r),
    `${valeurDeg.toFixed(1)}°`,
    {
      hauteur: opts.hauteurTexte ?? 2.2,
      ancrage: 'centre',
      ligneDeBase: 'milieu',
    },
  );
}

/**
 * Cote de niveau : le triangle normalisé posé sur la ligne, avec l'altitude en
 * mètres. C'est la notation utilisée pour les hauteurs d'un bâtiment.
 */
export function coteNiveau(s: DrawScene, at: Pt, altitudeMm: number, longueurTrait = 18): void {
  const t = 2.4;
  s.polyligne([pt(at.x, at.y), pt(at.x - t, at.y + t * 1.6), pt(at.x + t, at.y + t * 1.6)], true, 'cotation');
  s.ligne(at, pt(at.x + longueurTrait, at.y), 'cotation');
  s.texte(pt(at.x + longueurTrait - 1, at.y + 1.2), formatNiveau(altitudeMm), {
    hauteur: 2.2,
    ancrage: 'droite',
  });
}

/** Altitude en mètres avec trois décimales et signe explicite : « +7.000 ». */
export function formatNiveau(mm: number): string {
  const m = mm / 1000;
  const signe = m >= 0 ? '+' : '−';
  return `${signe}${Math.abs(m).toFixed(3)}`;
}

/** Bulle de repère : le cercle contenant le repère de la pièce, et son attache. */
export function bulleRepere(
  s: DrawScene,
  at: Pt,
  vers: Pt,
  repere: string,
  rayon = 4.5,
): void {
  const l = norme(at, vers);
  if (l > 1e-9) {
    const ux = (vers.x - at.x) / l;
    const uy = (vers.y - at.y) / l;
    s.ligne(pt(at.x + ux * rayon, at.y + uy * rayon), vers, 'reperage');
  }
  s.cercle(at, rayon, 'reperage');
  s.texte(at, repere, {
    hauteur: 2.5,
    ancrage: 'centre',
    ligneDeBase: 'milieu',
    gras: true,
    layer: 'reperage',
  });
}

/** Pointe de flèche pleine, orientée par (ux, uy). */
function fleche(s: DrawScene, at: Pt, ux: number, uy: number): void {
  const bx = at.x + ux * FLECHE_L;
  const by = at.y + uy * FLECHE_L;
  const nx = -uy * FLECHE_D;
  const ny = ux * FLECHE_D;
  s.remplissage(
    [pt(at.x, at.y), pt(bx + nx, by + ny), pt(bx - nx, by - ny)],
    [],
    0,
    'cotation',
  );
}
