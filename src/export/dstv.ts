import { getProfile } from '../core/catalog/index';
import type { Profile } from '../core/catalog/types';
import type { PieceDeDebit } from '../core/drawing/sheets/element';
import type { Hole } from '../core/geometry/holes';
import {
  cutAngleDeg,
  cutLengths,
  fibreAbscissa,
  memberFrame,
  type Member,
} from '../core/geometry/member';
import type { ProjectMeta } from '../core/model/project';
import { sectionOutline } from '../core/geometry/section';

/**
 * EXPORT DSTV (NC1) — le format que lisent les perceuses-scies à commande
 * numérique.
 *
 * ⚠ C'est le fichier qui fait passer du plan papier à la fabrication
 * automatisée. Sans lui, un atelier équipé d'une ligne de perçage doit ressaisir
 * à la main les abscisses de chaque trou de chaque barre, en les relevant sur un
 * plan — et une halle courante en compte plusieurs centaines. C'est là que se
 * fabriquent les erreurs qui ne se voient qu'au montage.
 *
 * ⚠⚠ LIMITE DE VÉRIFICATION, à connaître avant d'employer ces fichiers. Le
 * format est écrit conformément à la spécification DSTV 1998, et les contrôles
 * automatiques vérifient la structure des blocs, la position des perçages dans
 * les limites du profil et la concordance avec le modèle. Mais AUCUN de ces
 * fichiers n'a été lu par une machine réelle. Avant de lancer une série,
 * contrôler une pièce : la faire percer, la mesurer, comparer au plan de débit.
 */

/**
 * Longueur maximale des champs d'identification de l'en-tête ST.
 *
 * ⚠ Volontairement large : tronquer court (10 caractères) pouvait donner le
 * MÊME repère à deux pièces différentes, ce qui est pire qu'un champ long que
 * la machine coupera elle-même. Seul l'emballement est borné ici.
 */
export const LONGUEUR_IDENTIFIANT = 64;
/** Longueur maximale du champ nuance de l'en-tête ST. */
const LONGUEUR_NUANCE = 16;

/**
 * Texte saisi par l'utilisateur, rendu sûr pour une ligne de l'en-tête ST.
 *
 * ⚠ L'en-tête est positionnel : un retour à la ligne dans le nom du projet
 * créait une ligne de plus et DÉCALAIT tous les champs suivants — la machine
 * lisait alors la quantité comme une désignation et la longueur comme une
 * hauteur. Caractères de contrôle et séparateurs de ligne sont remplacés par
 * une espace, le champ est tronqué à la longueur du format, et un champ vide
 * reçoit son repli plutôt que de laisser une ligne blanche.
 */
export function champTexte(v: string | undefined, repli: string, max = LONGUEUR_IDENTIFIANT): string {
  const propre = (v ?? '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Troncature par points de code : une lettre accentuée ne se coupe pas en deux.
  const tronque = Array.from(propre).slice(0, max).join('').trim();
  return tronque || repli;
}

/** Faces d'un profil, notation DSTV. */
type Face = 'v' | 'o' | 'u' | 'h';

export interface OptionsDstv {
  readonly meta: ProjectMeta;
  /** Phase de fabrication portée à l'en-tête ; « 1 » par défaut. */
  readonly phase?: string;
}

/**
 * Code de profil DSTV.
 *
 * ⚠ Il commande l'interprétation de TOUTES les coordonnées qui suivent : une
 * cornière déclarée « I » verrait ses perçages placés dans une âme qu'elle n'a
 * pas. Les formes que le format ne sait pas décrire sont refusées plutôt que
 * traduites approximativement.
 */
function codeProfil(p: Profile): string | null {
  switch (p.shape) {
    case 'I':
      return 'I';
    case 'U':
      return 'U';
    case 'L':
      return 'L';
    case 'CHS':
      return 'RO';
    case 'BOX':
    case 'RECT':
      return 'M';
    default:
      return null;
  }
}

/** Le profil peut-il être décrit en DSTV ? Sinon la pièce est écartée, nommée. */
export function exportable(profileId: string): boolean {
  return codeProfil(getProfile(profileId)) !== null;
}

/**
 * Fichier NC1 d'une pièce.
 *
 * Un fichier par REPÈRE DE DÉBIT, comme un plan de pièce : toutes les pièces
 * d'un repère sont identiques, la machine en produit la quantité demandée à
 * partir du même programme.
 */
export function elementToDstv(e: PieceDeDebit, opts: OptionsDstv): string | null {
  const m = e.membre;
  const p = getProfile(m.profileId);
  const code = codeProfil(p);
  if (!code) return null;

  const l = cutLengths(m);

  /*
   * ⚠ ORIGINE DES ABSCISSES. La machine mesure tout depuis la FACE DE COUPE ;
   * le modèle, lui, place les perçages depuis le POINT DE TRAVAIL. Sur une barre
   * éboutée les deux diffèrent de plusieurs centimètres, et une barre percée
   * depuis la mauvaise origine sort de la machine inutilisable — les trous ne
   * tombent en face de rien.
   *
   * C'est le même piège que celui qui avait déjà produit des « trous à −14 mm de
   * l'about » sur les plans d'atelier. Sur le projet par défaut l'écart est nul,
   * ce qui rend le défaut invisible : raison de plus pour le corriger ici plutôt
   * que d'attendre le premier projet qui l'expose.
   */
  const f0 = memberFrame(m);
  const origine = fibreAbscissa(f0, m.start, m.cutStart, { y: 0, z: 0 });

  const lignes: string[] = ['ST'];

  /*
   * ⚠ L'en-tête ST est POSITIONNEL : chaque ligne a un sens fixé par son rang,
   * il n'y a pas de nom de champ. Insérer ou omettre une ligne décale tout ce
   * qui suit — la machine lirait l'épaisseur d'âme comme une hauteur de profil.
   */
  lignes.push(
    ...[
      champTexte(opts.meta.nom, 'SteelPlan'), // commande
      champTexte(opts.meta.chantier, champTexte(opts.meta.nom, 'SteelPlan')), // dessin
      champTexte(opts.phase, '1'), // phase
      champTexte(m.mark, '-'), // repère de la pièce
      champTexte(m.grade, '-', LONGUEUR_NUANCE), // nuance
      String(e.quantite), // quantité
      p.id, // désignation du profil
      code, // code de forme
      f(l.axis), // longueur de débit
      f(p.h), // hauteur
      f(p.b), // largeur
      f(epaisseurSemelle(p)),
      f(epaisseurAme(p)),
      f(rayon(p)),
      f(p.G), // masse linéique
      // ⚠ En m² par mètre, unité du format. Le catalogue porte un périmètre en
      // millimètres : le livrer tel quel annoncerait 1466 m² de peinture au mètre.
      f(p.perimeter / 1000),
      /*
       * Angles de coupe aux deux abouts, âme puis semelles. `cutAngleDeg` rend
       * l'écart à l'équerre ; le format attend le même écart, en degrés.
       */
      f(cutAngleDeg(m, 'start')),
      f(cutAngleDeg(m, 'end')),
      f(cutAngleDeg(m, 'start')),
      f(cutAngleDeg(m, 'end')),
      '-', // texte libre 1
      '-', // texte libre 2
      '-', // texte libre 3
      '-', // texte libre 4
    ].map((x) => `  ${x}`),
  );

  const trous = m.holes
    .map((h) => percage(h, p, origine))
    .filter((x): x is LignePercage => x !== null);
  if (trous.length > 0) {
    lignes.push('BO');
    for (const t of trous) {
      lignes.push(`  ${t.face}  ${f(t.x)}${sep}${f(t.y)}${sep}${f(t.d)}${sep}0.00`);
    }
  }

  /*
   * GRUGEAGES : le format les décrit par le CONTOUR de la pièce, bloc AK, et non
   * par un enlèvement de matière. On ne trace donc pas l'entaille, on trace la
   * silhouette de l'âme telle qu'elle sort de la machine.
   */
  for (const bloc of contoursGrugeage(m, p, l.axis, origine)) lignes.push(...bloc);

  lignes.push('EN');
  return `${lignes.join('\n')}\n`;
}

/** Séparateur de colonnes du format : espaces, pas de tabulation. */
const sep = '  ';

/** Nombre au format DSTV : deux décimales, point décimal. */
const f = (v: number): string => v.toFixed(2);

interface LignePercage {
  readonly face: Face;
  readonly x: number;
  readonly y: number;
  readonly d: number;
}

/**
 * Un perçage, traduit dans le repère de sa FACE.
 *
 * ⚠ Chaque face a sa propre origine, et c'est la source d'erreur principale du
 * format. Sur l'âme (face v), y se mesure depuis la fibre INFÉRIEURE du profil ;
 * sur une semelle (faces o et u), depuis le bord de semelle situé du même côté
 * que la face v. Notre modèle, lui, place tout depuis le CENTRE de gravité. Une
 * traduction qui oublierait le décalage percerait tous les trous d'âme une
 * demi-hauteur trop bas.
 */
function percage(h: Hole, p: Profile, origine: number): LignePercage | null {
  const x = h.s - origine;
  /*
   * ⚠ L'ordonnée DSTV se mesure depuis le BORD de la face, pas depuis le centre
   * de gravité. On ajoutait h/2 ou b/2 — juste pour un profil symétrique, faux
   * pour une cornière dont le centre de gravité est à 28 mm du dos : le trou
   * d'une échantignolle sortait à 102 mm sur une aile de 100, et ceux des
   * cornières de treillis 22 mm à côté de leur place, sans sortir du profil —
   * donc sans que rien ne le signale.
   */
  const c = sectionOutline(p, 8).outer;
  const yMin = Math.min(...c.map((q) => q.y));
  const zMin = Math.min(...c.map((q) => q.z));
  if (h.through === 'y') {
    // Traversant la largeur : c'est un trou d'âme, face avant.
    return { face: 'v', x, y: h.at.z - zMin, d: h.d };
  }
  // Traversant la hauteur : semelle supérieure ou inférieure selon le signe.
  return { face: h.at.z >= 0 ? 'o' : 'u', x, y: h.at.y - yMin, d: h.d };
}

/**
 * Contour de l'âme quand la pièce est grugée, bloc AK.
 *
 * ⚠ Un grugeage n'est PAS un trou : c'est un enlèvement de matière en rive, et
 * le format ne le décrit que par la silhouette obtenue. Le décrire autrement — en
 * BO, ou pas du tout — ferait sortir de la machine une pièce non grugée, qui ne
 * s'emboîterait pas.
 *
 * Le contour est parcouru dans le sens direct, en partant de l'origine de la
 * pièce, et il se referme sur son point de départ.
 */
function contoursGrugeage(
  m: Member,
  p: Profile,
  longueur: number,
  origine: number,
): string[][] {
  if (m.notches.length === 0) return [];

  const haut = p.h;
  // Mêmes abscisses que les perçages : ramenées à la face de coupe.
  const a = (s: number): number => s - origine;
  const points: { x: number; y: number }[] = [{ x: 0, y: 0 }];

  // Fibre inférieure, de l'origine vers l'extrémité, entailles comprises.
  for (const n of [...m.notches].filter((n) => n.side === 'inf').sort((x, y) => x.s0 - y.s0)) {
    points.push(
      { x: a(n.s0), y: 0 },
      { x: a(n.s0), y: n.depth },
      { x: a(n.s1), y: n.depth },
      { x: a(n.s1), y: 0 },
    );
  }
  points.push({ x: longueur, y: 0 }, { x: longueur, y: haut });

  // Fibre supérieure, au retour.
  for (const n of [...m.notches].filter((n) => n.side === 'sup').sort((x, y) => y.s0 - x.s0)) {
    points.push(
      { x: a(n.s1), y: haut },
      { x: a(n.s1), y: haut - n.depth },
      { x: a(n.s0), y: haut - n.depth },
      { x: a(n.s0), y: haut },
    );
  }
  points.push({ x: 0, y: haut }, { x: 0, y: 0 });

  return [['AK', ...points.map((q) => `  v  ${f(q.x)}${sep}${f(q.y)}${sep}0.00`)]];
}

/* ------------------------------------------------------------------ */

function epaisseurAme(p: Profile): number {
  if (p.shape === 'I' || p.shape === 'U') return p.tw;
  if (p.shape === 'L' || p.shape === 'CHS' || p.shape === 'BOX' || p.shape === 'RECT') return p.t;
  return p.h;
}

function epaisseurSemelle(p: Profile): number {
  if (p.shape === 'I' || p.shape === 'U') return p.tf;
  return epaisseurAme(p);
}

function rayon(p: Profile): number {
  return p.shape === 'I' || p.shape === 'U' ? p.r : 0;
}

/* ------------------------------------------------------------------ */

export interface FichierDstv {
  readonly nom: string;
  readonly contenu: string;
}

export interface LotDstv {
  readonly fichiers: readonly FichierDstv[];
  /**
   * Repères écartés, avec la raison.
   *
   * ⚠ Nommés, jamais tus. Un repère absent du lot serait un repère que l'atelier
   * croit programmé et qui n'arrivera jamais à la machine.
   */
  readonly ecartes: readonly { readonly mark: string; readonly raison: string }[];
}

/** Le lot complet : un fichier NC1 par repère exportable. */
export function lotDstv(
  elements: readonly PieceDeDebit[],
  opts: OptionsDstv,
): LotDstv {
  const fichiers: FichierDstv[] = [];
  const ecartes: { mark: string; raison: string }[] = [];

  for (const e of elements) {
    const contenu = elementToDstv(e, opts);
    if (contenu === null) {
      ecartes.push({
        mark: e.membre.mark,
        raison: `profil ${getProfile(e.membre.profileId).id} : forme non descriptible en DSTV`,
      });
      continue;
    }
    fichiers.push({ nom: `${e.membre.mark}.nc1`, contenu });
  }
  return { fichiers, ecartes };
}
