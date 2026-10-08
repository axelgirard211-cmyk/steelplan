import { ouverturesValides, repereFacade } from '../build/secondaire/ouvertures';
import { LIBELLE_TYPE, type FaceOuverture, type Ouverture } from '../model/ouvertures';
import type { ProjectParams } from '../model/project';
import { pt, type DrawScene, type Pt } from './scene';
import { appliquer, project, type Transform2D, type ViewDir } from './view';

/**
 * OUVERTURES SUR UNE ÉLÉVATION.
 *
 * ⚠ Une ouverture DOIT se voir sur la façade, et pas seulement dans le modèle.
 * Le chevêtre seul ne la montre pas : trois barres qui bordent un rectangle vide
 * se lisent comme un renfort de bardage, pas comme un portail de 4 mètres. C'est
 * pourtant la façade qui sert à situer une ouverture — c'est le document qu'on
 * envoie au menuisier et sur lequel le bardeur cale son calepinage.
 *
 * Le tracé retenu est celui du métier : le RECTANGLE DU VIDE en trait fort, sa
 * désignation et ses dimensions à l'intérieur. Pas de hachure, pas de croix :
 * une ouverture est une absence de matière, la laisser vide est ce qui la dit.
 */

/** Rectangle et étiquette de chaque ouverture percée dans cette façade. */
export function dessinerOuvertures(
  s: DrawScene,
  t: Transform2D,
  v: ViewDir,
  p: ProjectParams,
  face: FaceOuverture,
): void {
  for (const o of ouverturesValides(p).filter((x) => x.face === face)) {
    const coins = coinsDe(o, p, face).map((q) => appliquer(t, project(q, v)));
    s.polyligne(
      coins.map((q) => pt(q.x, q.y)),
      true,
      'contour',
    );
    etiqueter(s, coins, o);
  }
}

/**
 * Les quatre coins de l'ouverture, en coordonnées du modèle.
 *
 * ⚠ Le plan de façade vient de `repereFacade`, la MÊME fonction qui pose les
 * montants. Le recalculer ici — demi-poteau plus demi-lisse, c'est vite
 * réécrit — donnerait deux plans qu'un changement de profil suffirait à
 * désaccorder : le rectangle glisserait devant son chevêtre, et le dessin
 * resterait plausible tout en étant faux.
 */
function coinsDe(
  o: Ouverture,
  p: ProjectParams,
  face: FaceOuverture,
): { x: number; y: number; z: number }[] {
  const { point } = repereFacade(p, face);
  const s1 = o.position + o.largeur;
  const z1 = o.allege + o.hauteur;
  return [
    point(o.position, o.allege),
    point(s1, o.allege),
    point(s1, z1),
    point(o.position, z1),
  ];
}

/**
 * Désignation et dimensions, au centre du vide.
 *
 * ⚠ Les DIMENSIONS figurent sur la façade, pas seulement le repère. Renvoyer à
 * une nomenclature pour connaître la largeur d'un portail oblige à changer de
 * feuille au moment précis où l'on mesure — et c'est là que naissent les
 * ouvertures percées à la mauvaise cote.
 */
function etiqueter(s: DrawScene, coins: readonly Pt[], o: Ouverture): void {
  const cx = coins.reduce((a, q) => a + q.x, 0) / coins.length;
  const cy = coins.reduce((a, q) => a + q.y, 0) / coins.length;
  const hauteurTexte = 2.2;

  s.texte(pt(cx, cy + hauteurTexte * 0.7), o.id, {
    hauteur: hauteurTexte,
    gras: true,
    ancrage: 'centre',
    ligneDeBase: 'milieu',
    layer: 'texte',
  });
  s.texte(
    pt(cx, cy - hauteurTexte * 0.9),
    `${LIBELLE_TYPE[o.type]} ${o.largeur} × ${o.hauteur}`,
    {
      hauteur: hauteurTexte * 0.85,
      ancrage: 'centre',
      ligneDeBase: 'milieu',
      layer: 'texte',
    },
  );
}
