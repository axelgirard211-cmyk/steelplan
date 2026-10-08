import { pt, type DrawScene, type Pt } from './scene';

/**
 * TRAIT DE COUPE — le symbole normalisé qui dit OÙ une coupe est prise.
 *
 * ⚠ Sans lui, une planche intitulée « Coupe transversale — file 3 » oblige le
 * lecteur à compter les files sur la vue en plan pour savoir ce qu'il regarde.
 * C'est exactement le genre de comptage dont on se trompe, et c'est la raison
 * pour laquelle la convention existe : le trait de coupe et le titre de la
 * planche portent la MÊME lettre, et le lien se lit sans réfléchir.
 *
 * Le symbole suit l'ISO 128 : deux amorces en trait fort aux extrémités du plan
 * de coupe, une flèche perpendiculaire à chaque amorce indiquant le SENS DU
 * REGARD, et la lettre repère à côté de chaque flèche.
 */

/** Longueur des amorces en trait fort (mm papier). */
const AMORCE = 9;
/** Longueur de la flèche de sens du regard (mm papier). */
const FLECHE = 7;
const TETE = 2.4;

/**
 * Trace un trait de coupe entre `a` et `b`, la flèche pointant du côté `regard`.
 *
 * `regard` est un vecteur unitaire PAPIER perpendiculaire à la coupe : il donne
 * le côté vers lequel l'observateur regarde. Se tromper de sens retourne la
 * coupe, et un bâtiment dissymétrique s'en trouve dessiné en miroir.
 */
export function traitDeCoupe(
  s: DrawScene,
  a: Pt,
  b: Pt,
  lettre: string,
  regard: { x: number; y: number },
): void {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l < 1e-6) return;
  const ux = (b.x - a.x) / l;
  const uy = (b.y - a.y) / l;
  const n = Math.hypot(regard.x, regard.y) || 1;
  const rx = regard.x / n;
  const ry = regard.y / n;

  /*
   * Le trait n'est PAS continu d'un bout à l'autre : la convention ne trace que
   * les amorces, pour ne pas barrer le dessin qu'on est en train de couper. Un
   * trait plein masquerait précisément les pièces que la coupe doit montrer.
   */
  for (const [origine, sens] of [
    [a, 1],
    [b, -1],
  ] as const) {
    const fin = pt(origine.x + ux * AMORCE * sens, origine.y + uy * AMORCE * sens);
    s.ligne(origine, fin, 'contour');

    // Flèche du sens du regard, posée sur l'amorce, à son extrémité extérieure.
    const p0 = origine;
    const p1 = pt(p0.x + rx * FLECHE, p0.y + ry * FLECHE);
    s.ligne(p0, p1, 'contour');
    s.polyligne(
      [
        p1,
        pt(p1.x - rx * TETE + ux * TETE * 0.45, p1.y - ry * TETE + uy * TETE * 0.45),
        pt(p1.x - rx * TETE - ux * TETE * 0.45, p1.y - ry * TETE - uy * TETE * 0.45),
      ],
      true,
      'contour',
    );

    // La lettre, au-delà de la flèche, du côté du regard.
    s.texte(pt(p1.x + rx * 4, p1.y + ry * 4), lettre, {
      hauteur: 4,
      gras: true,
      ancrage: 'centre',
      ligneDeBase: 'milieu',
      layer: 'reperage',
    });
  }
}

/**
 * Lettre de coupe à partir de son rang : A, B, C…
 *
 * ⚠ Les lettres I et O sont écartées : sur un tirage, « Coupe I-I » se lit comme
 * un chiffre et « O-O » comme un zéro. C'est la règle de tous les bureaux de
 * dessin, et elle coûte une ligne.
 */
const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function lettreDeCoupe(rang: number): string {
  return LETTRES[rang % LETTRES.length] ?? 'Z';
}

/**
 * RENVOI DE DÉTAIL — le cercle qui dit « ce nœud est dessiné en grand ailleurs ».
 *
 * ⚠ Sans lui, les planches de détail flottaient dans le dossier sans attache :
 * « Détail — assemblage traverse / poteau » ne disait pas QUEL genou, ni où le
 * trouver sur l'ouvrage. Le renvoi relie les deux par une même lettre, comme le
 * trait de coupe relie la vue en plan à sa coupe.
 *
 * Le symbole est celui des planches de bureau d'études : un cercle fin autour de
 * la zone détaillée, une ligne de rappel vers l'extérieur, et une bulle portant
 * la lettre, suivie du mot « Détail ». La ligne part VERS L'EXTÉRIEUR de
 * l'ouvrage (`dehors`), là où il y a de la place, plutôt que de traverser la
 * charpente qu'elle désigne.
 *
 * Renvoie l'emprise occupée par la bulle et son libellé, pour que le repérage
 * des pièces ne vienne pas écrire par-dessus.
 */
export function renvoiDeDetail(
  s: DrawScene,
  centre: Pt,
  rayonZone: number,
  lettre: string,
  dehors: { x: number; y: number },
): { x0: number; y0: number; x1: number; y1: number } {
  const n = Math.hypot(dehors.x, dehors.y) || 1;
  const ux = dehors.x / n;
  const uy = dehors.y / n;

  // Cercle de zone, fin et en trait mixte : il désigne, il ne dessine pas.
  s.cercle(centre, rayonZone, 'axe');

  const depart = pt(centre.x + ux * rayonZone, centre.y + uy * rayonZone);
  const bulle = pt(centre.x + ux * (rayonZone + RAPPEL), centre.y + uy * (rayonZone + RAPPEL));
  s.ligne(depart, pt(bulle.x - ux * RAYON_BULLE, bulle.y - uy * RAYON_BULLE), 'reperage');
  s.cercle(bulle, RAYON_BULLE, 'reperage');
  s.texte(bulle, lettre, {
    hauteur: 3.4,
    gras: true,
    ancrage: 'centre',
    ligneDeBase: 'milieu',
    layer: 'reperage',
  });

  // Le mot « Détail » se pose du côté libre de la bulle.
  const aDroite = ux >= 0;
  const libelle = pt(bulle.x + (aDroite ? 1 : -1) * (RAYON_BULLE + 1.5), bulle.y);
  s.texte(libelle, 'Détail', {
    hauteur: 2.4,
    ancrage: aDroite ? 'gauche' : 'droite',
    ligneDeBase: 'milieu',
    layer: 'reperage',
  });

  const largeurLibelle = 11;
  return {
    x0: Math.min(bulle.x - RAYON_BULLE, aDroite ? bulle.x : libelle.x - largeurLibelle),
    y0: bulle.y - RAYON_BULLE,
    x1: Math.max(bulle.x + RAYON_BULLE, aDroite ? libelle.x + largeurLibelle : bulle.x),
    y1: bulle.y + RAYON_BULLE,
  };
}

/** Rayon de la bulle de renvoi (mm papier). */
const RAYON_BULLE = 4;
/** Longueur de la ligne de rappel, du cercle de zone au centre de la bulle (mm papier). */
const RAPPEL = 14;
