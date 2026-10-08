import { haunchMassKg, plateMassKg } from '../../build/buildProject';
import { getProfile } from '../../catalog/index';
import { LIBELLE_TOLE } from '../../build/types';
import { cutLengths, memberMassKg } from '../../geometry/member';
import { roundMm } from '../../math/tolerance';
import { designationFinition, teinteFinition, type FinitionParams } from '../../model/finition';
import { pt, type Bbox, type DrawScene, type Pt } from '../scene';
import { encombrementTole, tolesDistinctes, type ElementFabrication } from './element';
import type { EtapeGamme } from './gamme';

/**
 * LES DEUX BLOCS ÉCRITS DE LA PLANCHE DE FABRICATION.
 *
 * ⚠ Un plan d'atelier n'est pas qu'un dessin. Le dessin dit la FORME ; il ne dit
 * ni ce qu'il faut sortir du stock, ni dans quel ordre travailler. Ces deux
 * blocs le disent :
 *  - la NOMENCLATURE, qui liste tout ce qui compose la pièce, avec les masses ;
 *  - la GAMME, qui donne la suite des postes, du débit à la peinture.
 *
 * Ils sont ici plutôt que dans le tracé des vues parce qu'ils n'ont rien de
 * géométrique : ce sont des tableaux, et les mêlerait à la projection rendrait
 * les deux illisibles.
 */

const H_TEXTE = 2.0;
const H_TITRE = 2.6;
const PAS_LIGNE = 3.3;
/** Largeur approchée d'un caractère, en fraction de la hauteur du texte. */
const CHASSE = 0.55;


/* ------------------------------------------------------------------ */
/* Nomenclature                                                        */
/* ------------------------------------------------------------------ */

/**
 * Tout ce qui compose la pièce, ligne à ligne, et ce qu'elle pèse.
 *
 * ⚠ La masse est donnée pour UNE pièce finie ET pour le lot. C'est la seule
 * façon de savoir à la fois ce qu'il faut lever à la grue et ce qu'il faut
 * charger sur le camion — deux questions qui se posent le même jour.
 *
 * Renvoie l'ordonnée du bas du tableau : la gamme se pose dessous.
 */
export function dessinerNomenclature(
  s: DrawScene,
  e: ElementFabrication,
  zone: Bbox,
): number {
  const largeur = zone.max.x - zone.min.x;
  const parts = [0.1, 0.37, 0.27, 0.1, 0.05, 0.11];
  const bornes: number[] = [zone.min.x];
  for (const p of parts) bornes.push((bornes[bornes.length - 1] as number) + p * largeur);

  const profil = getProfile(e.membre.profileId);
  const l = cutLengths(e.membre);

  const lignes: string[][] = [
    [
      e.membre.mark,
      profil.id,
      `L = ${roundMm(l.axis)}${Math.abs(l.max - l.min) > 1 ? ` (maxi ${roundMm(l.max)})` : ''}`,
      e.membre.grade,
      '1',
      masse(masseBarre(e)),
    ],
  ];
  for (const { pl, nombre } of tolesDistinctes(e)) {
    const d = encombrementTole(pl);
    lignes.push([
      pl.mark,
      LIBELLE_TOLE[pl.kind],
      `${roundMm(d.largeur)} × ${roundMm(d.hauteur)} × ${pl.thickness}`,
      pl.grade,
      `${nombre}`,
      masse(plateMassKg(pl) * nombre),
    ]);
  }
  for (const j of e.jarrets) {
    lignes.push([
      j.mark,
      `Jarret ${getProfile(j.profileId).id}`,
      `h racine ${roundMm(j.rootDepth)}`,
      j.grade,
      '1',
      masse(haunchMassKg(j)),
    ]);
  }
  /*
   * Pièces soudées — les échantignolles d'une traverse. ⚠ Elles manquaient : la
   * nomenclature de l'élément ne listait que la barre, les tôles et le jarret,
   * et l'assembleur cherchait sur le dessin six cornières dont rien ne disait
   * le repère ni la quantité à sortir du magasin.
   */
  const parRepere = new Map<string, { m: (typeof e.pieces)[number]; n: number }>();
  for (const x of e.pieces) {
    const deja = parRepere.get(x.mark);
    if (deja) deja.n += 1;
    else parRepere.set(x.mark, { m: x, n: 1 });
  }
  for (const [mark, { m: x, n }] of parRepere) {
    lignes.push([
      mark,
      getProfile(x.profileId).id,
      `L = ${roundMm(cutLengths(x).axis)}`,
      x.grade,
      `${n}`,
      masse(memberMassKg(x) * n),
    ]);
  }

  let y = zone.max.y - H_TITRE - 1;
  s.texte(pt(zone.min.x, y), 'NOMENCLATURE DE L’ÉLÉMENT', { hauteur: H_TITRE, gras: true });
  y -= 4.6;

  rangee(s, bornes, y, ['Rep.', 'Désignation', 'Dimensions (mm)', 'Nuance', 'Nb', 'kg'], true);
  y -= 1.6;
  s.ligne(pt(zone.min.x, y), pt(zone.max.x, y), 'cotation');
  y -= PAS_LIGNE;

  for (const ligne of lignes) {
    rangee(s, bornes, y, ligne, false);
    y -= PAS_LIGNE;
  }

  y += PAS_LIGNE - 1.6;
  s.ligne(pt(zone.min.x, y), pt(zone.max.x, y), 'cotation');
  y -= PAS_LIGNE + 0.6;

  totalise(s, bornes, y, 'Masse d’une pièce finie', masse(e.masseUnitaire));
  y -= PAS_LIGNE;
  if (e.quantite > 1) {
    totalise(
      s,
      bornes,
      y,
      `Masse du lot — ${e.quantite} pièces`,
      masse(e.masseUnitaire * e.quantite),
    );
    y -= PAS_LIGNE;
  }
  return y;
}

/**
 * Masse de la seule barre. ⚠ Lue sur la barre, et non déduite du total de
 * l'élément moins ses tôles : chaque nouvelle sorte de pièce soudée — les
 * échantignolles — devait être retranchée à son tour, et la barre héritait de
 * leur masse tant qu'on l'oubliait.
 */
function masseBarre(e: ElementFabrication): number {
  return memberMassKg(e.membre);
}

const masse = (kg: number): string => kg.toFixed(1).replace('.', ',');

function rangee(
  s: DrawScene,
  bornes: readonly number[],
  y: number,
  cellules: readonly string[],
  gras: boolean,
): void {
  for (const [i, c] of cellules.entries()) {
    // Les deux dernières colonnes sont des nombres : alignés à droite, ils se
    // comparent d'un coup d'œil ; alignés à gauche, il faut les lire.
    const droite = i >= cellules.length - 2;
    // Un libellé plus long que sa colonne se resserre au lieu de mordre sur la suivante.
    const place = (bornes[i + 1] as number) - (bornes[i] as number) - 1.2;
    s.texte(pt(droite ? (bornes[i + 1] as number) - 1 : (bornes[i] as number), y), c, {
      hauteur: Math.max(1.4, Math.min(H_TEXTE, place / (Math.max(1, c.length) * 0.6))),
      gras,
      ancrage: droite ? 'droite' : 'gauche',
    });
  }
}

function totalise(
  s: DrawScene,
  bornes: readonly number[],
  y: number,
  libelle: string,
  valeur: string,
): void {
  s.texte(pt(bornes[0] as number, y), libelle, { hauteur: H_TEXTE, gras: true });
  s.texte(pt((bornes[bornes.length - 1] as number) - 1, y), valeur, {
    hauteur: H_TEXTE,
    gras: true,
    ancrage: 'droite',
  });
}

/* ------------------------------------------------------------------ */
/* Gamme                                                               */
/* ------------------------------------------------------------------ */

/**
 * La suite des postes, telle qu'elle se lit au pied de l'établi.
 *
 * Le pas des lignes s'adapte à la place disponible : une pièce à quatre platines
 * a une gamme deux fois plus longue qu'une panne, et un pas figé ferait déborder
 * l'une ou laisserait l'autre à moitié vide.
 */
/**
 * NOTES du plan d'assemblage — ce qui vaut pour toute la planche et ne se
 * dessine pas : unités, projection, tolérances, soudage, traitement, renvois.
 */
export function dessinerNotes(s: DrawScene, e: ElementFabrication, f: FinitionParams, zone: Bbox): number {
  const largeur = zone.max.x - zone.min.x;
  let y = zone.max.y - H_TITRE - 1;
  s.texte(pt(zone.min.x, y), 'NOTES', { hauteur: H_TITRE, gras: true });
  y -= 1.6;
  s.ligne(pt(zone.min.x, y), pt(zone.max.x, y), 'cotation');
  y -= 4.2;
  const notes = [
    'Cotes en millimètres. Projection européenne.',
    'Implantations cotées en cumulé depuis l’about d’origine (repère 0) ; coupes cotées depuis l’axe du profil.',
    'Tolérances : NF EN 1090-2, tolérances essentielles (annexe B), sauf plan qualité du fabricant.',
    'Soudures : symboles EN ISO 2553, gorge a en mm, cordons continus. Mode opératoire et soudeurs qualifiés (EN ISO 15614 / 9606-1).',
    `TRAITEMENT DE SURFACE : ${designationFinition(f)}${f.type === 'peinture' ? ` — teinte ${teinteFinition(f)}` : ''}.`,
    `Trous et perçages de la barre : plan de pièce ${e.membre.mark}. Tôles : planches « Tôles à plat ». Ordre d’exécution : gamme ${e.repere}.`,
    'Flèches A, B… : vues de bout, dessinées sous l’extrémité qu’elles montrent. Une coupe vaut pour toutes les pièces du même type.',
  ];
  for (const n of notes) {
    // La chasse réelle des majuscules et des accents dépasse la chasse moyenne.
    for (const [i, l] of couper(n, (largeur - 6) * 0.8, H_TEXTE).entries()) {
      if (y < zone.min.y + 14) break;
      s.texte(pt(zone.min.x + (i === 0 ? 0 : 3), y), `${i === 0 ? '— ' : ''}${l}`, { hauteur: H_TEXTE });
      y -= PAS_LIGNE;
    }
  }
  const ySymbole = Math.max(zone.min.y + 6, y - 4);
  symboleProjectionEuropeenne(s, pt(zone.max.x - 16, ySymbole));
  return ySymbole - 6;
}

/**
 * Symbole de la projection européenne (ISO 128-30) : le tronc de cône vu de
 * face, et sa vue de gauche placée à DROITE — deux cercles concentriques.
 */
export function symboleProjectionEuropeenne(s: DrawScene, centre: Pt): void {
  const h = 6;
  const x0 = centre.x - 9;
  s.polyligne([pt(x0, centre.y - h / 4), pt(x0 + 9, centre.y - h / 2), pt(x0 + 9, centre.y + h / 2), pt(x0, centre.y + h / 4)], true, 'contour');
  s.cercle(pt(centre.x + 6, centre.y), h / 2, 'contour');
  s.cercle(pt(centre.x + 6, centre.y), h / 4, 'contour');
  s.ligne(pt(x0 - 2, centre.y), pt(centre.x + 6 + h / 2 + 2, centre.y), 'axe');
}

export function dessinerGamme(s: DrawScene, etapes: readonly EtapeGamme[], zone: Bbox): void {
  const largeur = zone.max.x - zone.min.x;
  let y = zone.max.y - H_TITRE - 1;
  s.texte(pt(zone.min.x, y), 'GAMME DE FABRICATION', { hauteur: H_TITRE, gras: true });
  y -= 1.6;
  s.ligne(pt(zone.min.x, y), pt(zone.max.x, y), 'cotation');
  y -= 4.4;

  // Découpe d'abord, comptage ensuite : c'est le nombre de lignes RÉELLES, une
  // fois les longues repliées, qui commande le pas.
  const blocs = etapes.map((e) => ({
    titre: `${e.numero}. ${e.poste}`,
    lignes: e.lignes.flatMap((t) => couper(t, largeur - 3, H_TEXTE)),
  }));
  const nb = blocs.reduce((n, b) => n + 1 + b.lignes.length, 0);
  const pas = Math.min(PAS_LIGNE, Math.max(2.4, (y - zone.min.y - blocs.length * 1.8) / nb));
  const h = Math.min(H_TEXTE, pas * 0.66);

  for (const b of blocs) {
    s.texte(pt(zone.min.x, y), b.titre, { hauteur: h * 1.1, gras: true });
    y -= pas;
    for (const t of b.lignes) {
      s.texte(pt(zone.min.x + 1, y), `— ${t}`, { hauteur: h });
      y -= pas;
    }
    y -= 1.8;
  }
}

/** Replie un texte trop long sur plusieurs lignes, aux espaces. */
export function couper(texte: string, largeurMax: number, hauteur: number): string[] {
  const maxCar = Math.max(12, Math.floor(largeurMax / (hauteur * CHASSE)));
  if (texte.length <= maxCar) return [texte];

  const out: string[] = [];
  let courante = '';
  for (const mot of texte.split(' ')) {
    const essai = courante === '' ? mot : `${courante} ${mot}`;
    if (essai.length <= maxCar) courante = essai;
    else {
      if (courante !== '') out.push(courante);
      courante = mot;
    }
  }
  if (courante !== '') out.push(courante);
  return out;
}
