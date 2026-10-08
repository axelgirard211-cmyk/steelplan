import { getProfile } from '../catalog/index';
import type { Member } from '../geometry/member';
import { pt, type DrawScene, type Pt } from './scene';
import { appliquer, project, type Transform2D, type ViewDir } from './view';

/**
 * REPÉRAGE DES PIÈCES SUR UNE ÉLÉVATION.
 *
 * ⚠ C'est ce qui fait la différence entre un dessin et un PLAN. Une élévation
 * qui montre des traits sans les nommer oblige à retrouver chaque pièce dans la
 * nomenclature en comptant les travées ; celui qui monte sur la nacelle, lui, a
 * besoin de lire « PO1 · IPE 400 » à côté du poteau qu'il regarde.
 *
 * Chaque étiquette porte le REPÈRE et le PROFIL. Le repère seul renvoie à un
 * document qu'on n'a pas toujours sous la main ; le profil seul ne dit pas quelle
 * pièce commander. Les deux ensemble suffisent à travailler sans rien d'autre.
 *
 * ⚠⚠ LE PROBLÈME RÉEL EST L'ENCOMBREMENT, pas le tracé. Un hangar courant compte
 * trois cent cinquante barres : les étiqueter toutes sans précaution donne une
 * bouillie illisible où l'on ne distingue plus rien — pire que pas d'étiquettes
 * du tout, parce qu'elle cache le dessin. D'où le placement par essais successifs
 * avec refus des chevauchements, et l'ordre de priorité : un exemplaire de chaque
 * repère d'abord, les répétitions ensuite s'il reste de la place.
 */

export interface OptionsReperage {
  /** Hauteur du texte du repère (mm papier). */
  readonly hauteur?: number;
  /** Longueurs de ligne de rappel essayées, dans l'ordre (mm papier). */
  readonly rappels?: readonly number[];
  /** Porter le profil sous le repère. */
  readonly avecProfil?: boolean;
  /** Boîtes déjà occupées sur la planche : cotations, titres, cartouche. */
  readonly occupe?: readonly Boite[];
  /**
   * Étiqueter TOUS les exemplaires d'un même repère, et non un seul.
   *
   * ⚠ Faux par défaut, et c'est un choix de lisibilité éprouvé : sur un hangar
   * de cinq travées, étiqueter chaque exemplaire donnait dix « PA1 · IPE 160 »
   * empilés sur la ligne de pannes, au point qu'on ne lisait plus ni les
   * étiquettes ni le dessin dessous. Or dix pannes identiques portent le même
   * repère précisément pour n'être nommées qu'une fois : la répétition
   * n'apprend rien et coûte la lisibilité de toute la planche.
   */
  readonly repetitions?: boolean;
}

export interface Boite {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface ResultatReperage {
  /** Nombre de pièces effectivement étiquetées. */
  readonly posees: number;
  /** Repères distincts qui n'ont reçu aucune étiquette, faute de place. */
  readonly manquants: readonly string[];
  /** Boîtes occupées après coup, pour enchaîner un autre repérage. */
  readonly boites: readonly Boite[];
}

/**
 * Largeur approchée d'un texte (mm).
 *
 * ⚠ Approchée par construction : la police n'est connue qu'au rendu, et le
 * calque ne sait pas mesurer. Le facteur est pris LARGE — mieux vaut refuser une
 * étiquette qui serait passée que d'en poser une qui déborde sur sa voisine.
 */
function largeurTexte(texte: string, hauteur: number): number {
  /*
   * ⚠ 0,70 et non 0,62 : le premier facteur, calé sur une largeur moyenne de
   * caractère, sous-estimait les libellés longs. « L 80x80x8 » et
   * « CHS 60.3x4 » se retrouvaient collés bout à bout, chacun croyant l'autre
   * hors de sa boîte. Sur une estimation de largeur, l'erreur sûre est celle
   * qui refuse une étiquette de trop, pas celle qui en accepte une de trop.
   */
  return texte.length * hauteur * 0.7;
}

/**
 * Boîtes des textes déjà présents dans la scène.
 *
 * ⚠ Le cartouche et le cadre sont EXCLUS : ils vivent hors de la fenêtre de
 * dessin, et les compter rognerait inutilement la place disponible sur les bords
 * de la planche.
 */
function textesDeLaScene(s: DrawScene): Boite[] {
  const out: Boite[] = [];
  for (const e of s.entities) {
    if (e.kind !== 'texte') continue;
    if (e.layer === 'cartouche' || e.layer === 'cadre') continue;
    const l = largeurTexte(e.texte, e.hauteur);
    const x0 =
      e.ancrage === 'droite' ? e.at.x - l : e.ancrage === 'centre' ? e.at.x - l / 2 : e.at.x;
    const y0 =
      e.ligneDeBase === 'haut'
        ? e.at.y - e.hauteur
        : e.ligneDeBase === 'milieu'
          ? e.at.y - e.hauteur / 2
          : e.at.y;
    out.push({ x0, y0, x1: x0 + l, y1: y0 + e.hauteur });
  }
  return out;
}

function chevauche(a: Boite, b: Boite, marge: number): boolean {
  return (
    a.x0 - marge < b.x1 && b.x0 - marge < a.x1 && a.y0 - marge < b.y1 && b.y0 - marge < a.y1
  );
}

/** Marge de respiration entre deux étiquettes voisines (mm papier). */
const MARGE = 1.2;

/**
 * Un segment traverse-t-il la boîte ? (Liang–Barsky sur un rectangle aligné.)
 *
 * Sert à écarter les étiquettes des traits du dessin. Tester seulement les deux
 * extrémités laisserait passer toute barre qui TRAVERSE la boîte de part en
 * part — c'est-à-dire précisément la longue panne au-dessus de laquelle on
 * essaie d'écrire.
 */
function segmentCoupeBoite(a: Pt, b: Pt, r: Boite): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const bornes: [number, number][] = [
    [-dx, a.x - r.x0],
    [dx, r.x1 - a.x],
    [-dy, a.y - r.y0],
    [dy, r.y1 - a.y],
  ];
  for (const [p, q] of bornes) {
    if (p === 0) {
      if (q < 0) return false; // parallèle et hors de la bande
      continue;
    }
    const u = q / p;
    if (p < 0) {
      if (u > t1) return false;
      if (u > t0) t0 = u;
    } else {
      if (u < t0) return false;
      if (u < t1) t1 = u;
    }
  }
  return true;
}

/**
 * Étiquette les pièces d'une vue.
 *
 * L'ordre de passage décide de ce qui survit à l'encombrement : on pose d'abord
 * UN exemplaire de chaque repère — pour qu'aucune pièce du bâtiment ne reste
 * anonyme — puis les répétitions tant qu'il reste de la place.
 */
export function etiqueterPieces(
  s: DrawScene,
  t: Transform2D,
  v: ViewDir,
  membres: readonly Member[],
  opts: OptionsReperage = {},
): ResultatReperage {
  const hauteur = opts.hauteur ?? 2.0;
  const rappels = opts.rappels ?? [6, 10, 15, 21, 28];
  const avecProfil = opts.avecProfil ?? true;
  /*
   * ⚠ TOUT TEXTE DÉJÀ POSÉ est un obstacle, quel que soit son calque. La
   * première version n'évitait que les étiquettes entre elles et les traits du
   * dessin : elle écrivait donc « TR1 · IPE 360 » par-dessus l'annotation
   * « pente 10 % » et par-dessus les cotes de niveau. Aller les chercher dans la
   * scène plutôt que de les déclarer à chaque appel supprime la classe entière
   * de collisions — et surtout, aucun futur ajout de texte ne pourra l'oublier.
   */
  const boites: Boite[] = [...(opts.occupe ?? []), ...textesDeLaScene(s)];

  /*
   * ⚠ Le DESSIN LUI-MÊME est un obstacle, au même titre qu'une étiquette
   * voisine. Ne se garder que des collisions entre étiquettes les posait
   * proprement les unes à côté des autres — et toutes par-dessus les barres,
   * qu'elles masquaient. Une étiquette qui cache la pièce qu'elle désigne ne
   * sert à rien.
   */
  const traits = membres.map((m) => {
    const a = appliquer(t, project(m.start, v));
    const b = appliquer(t, project(m.end, v));
    return [pt(a.x, a.y), pt(b.x, b.y)] as const;
  });

  /*
   * ⚠ On RÉPARTIT les étiquettes sur la longueur au lieu de prendre le premier
   * exemplaire venu. Sans cela, toutes se groupaient à gauche — là où tombe le
   * premier exemplaire de chaque repère — laissant les quatre cinquièmes de
   * l'élévation nus alors que les mêmes pièces s'y répètent. Chaque repère va
   * donc chercher l'exemplaire le plus proche de la place qui lui est assignée
   * le long de la façade.
   */
  /*
   * ⚠ Les pièces sont repérées par leur repère d'ASSEMBLAGE — celui qui est
   * peint dessus et que le monteur cherche sur le plan —, et les pièces soudées
   * sur une autre ne le sont pas : une échantignolle arrive au chantier soudée
   * sur sa traverse, elle n'a pas à être cherchée seule.
   */
  const parMark = new Map<string, Member[]>();
  for (const m of membres) {
    if (m.assemblage === '' || m.porteur !== null) continue;
    parMark.set(m.assemblage, [...(parMark.get(m.assemblage) ?? []), m]);
  }
  const vus = new Set(parMark.keys());

  const abscisse = (m: Member): number => {
    const a = appliquer(t, project(m.start, v));
    const b = appliquer(t, project(m.end, v));
    return (a.x + b.x) / 2;
  };
  const toutes = membres.map(abscisse);
  const xMin = Math.min(...toutes);
  const xMax = Math.max(...toutes);

  const marks = [...parMark.keys()];
  const premiers: Member[] = [];
  const suivants: Member[] = [];
  for (const [i, mk] of marks.entries()) {
    const cible = xMin + ((i + 0.5) / marks.length) * (xMax - xMin);
    const liste = [...(parMark.get(mk) as Member[])].sort(
      (a, b) => Math.abs(abscisse(a) - cible) - Math.abs(abscisse(b) - cible),
    );
    premiers.push(liste[0] as Member);
    suivants.push(...liste.slice(1));
  }

  let posees = 0;
  const etiquetes = new Set<string>();
  const candidats = opts.repetitions ? [...premiers, ...suivants] : premiers;
  for (const m of candidats) {
    if (poser(s, t, v, m, hauteur, rappels, avecProfil, boites, traits)) {
      posees += 1;
      etiquetes.add(m.assemblage);
    }
  }

  return {
    posees,
    manquants: [...vus].filter((mk) => !etiquetes.has(mk)),
    boites,
  };
}

function poser(
  s: DrawScene,
  t: Transform2D,
  v: ViewDir,
  m: Member,
  hauteur: number,
  rappels: readonly number[],
  avecProfil: boolean,
  boites: Boite[],
  traits: readonly (readonly [Pt, Pt])[],
): boolean {
  const a = appliquer(t, project(m.start, v));
  const b = appliquer(t, project(m.end, v));
  const milieu = pt((a.x + b.x) / 2, (a.y + b.y) / 2);

  /*
   * ⚠ La ligne de rappel part PERPENDICULAIREMENT à la pièce. Une ligne
   * parallèle longerait la barre et l'on ne saurait plus laquelle elle désigne —
   * c'est précisément l'ambiguïté qu'une ligne de rappel doit lever.
   */
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  // Une pièce vue en bout n'a pas de direction sur le papier : on part en biais.
  const nx = l > 0.5 ? -dy / l : 0.707;
  const ny = l > 0.5 ? dx / l : 0.707;

  const lignes = avecProfil
    ? [m.assemblage, getProfile(m.profileId).id]
    : [m.assemblage];
  const largeur = Math.max(...lignes.map((x) => largeurTexte(x, hauteur)));
  const haut = lignes.length * hauteur * 1.25;

  for (const r of rappels) {
    for (const sens of [1, -1]) {
      const bout = pt(milieu.x + nx * r * sens, milieu.y + ny * r * sens);
      // Le texte s'écarte du côté où part la ligne : il ne repasse pas dessus.
      const gauche = nx * sens < 0;
      const x0 = gauche ? bout.x - largeur - 1 : bout.x + 1;
      const boite: Boite = { x0, y0: bout.y - haut / 2, x1: x0 + largeur, y1: bout.y + haut / 2 };
      if (boites.some((q) => chevauche(boite, q, MARGE))) continue;
      if (traits.some(([a2, b2]) => segmentCoupeBoite(a2, b2, boite))) continue;

      s.ligne(milieu, bout, 'reperage');
      // Point de départ marqué : il désigne la pièce sans ambiguïté.
      s.cercle(milieu, 0.5, 'reperage');
      for (const [i, texte] of lignes.entries()) {
        s.texte(
          pt(gauche ? bout.x - 1 : bout.x + 1, boite.y1 - (i + 0.8) * hauteur * 1.25),
          texte,
          {
            hauteur,
            gras: i === 0,
            ancrage: gauche ? 'droite' : 'gauche',
            ligneDeBase: 'bas',
            layer: 'reperage',
          },
        );
      }
      boites.push(boite);
      return true;
    }
  }
  return false;
}

/**
 * Bulle de file : le cercle repéré au pied d'une élévation.
 *
 * ⚠ C'est par elles que le chantier situe une pièce — « le poteau de la file 3 »
 * — et non par une abscisse en millimètres. Une élévation sans bulles oblige à
 * compter les travées depuis le bord pour savoir de quoi on parle.
 */
export function bulleDeFile(s: DrawScene, at: Pt, libelle: string, rayon = 4): void {
  s.cercle(at, rayon, 'reperage');
  s.texte(at, libelle, {
    hauteur: rayon * 0.8,
    gras: true,
    ancrage: 'centre',
    ligneDeBase: 'milieu',
    layer: 'reperage',
  });
}

/**
 * Repérage des files d'une élévation, bulles et trait d'axe.
 *
 * Les files transversales portent des CHIFFRES et les longitudinales des
 * LETTRES : c'est la convention qui permet de désigner un poteau par un couple
 * — « B3 » — sans jamais confondre les deux sens.
 */
export function filesDElevation(
  s: DrawScene,
  positions: readonly number[],
  yBulle: number,
  yHaut: number,
  numerotation: 'chiffres' | 'lettres',
): void {
  for (const [i, x] of positions.entries()) {
    const libelle =
      numerotation === 'chiffres' ? `${i + 1}` : String.fromCharCode(65 + (i % 26));
    s.ligne(pt(x, yBulle + 4), pt(x, yHaut), 'axe');
    bulleDeFile(s, pt(x, yBulle), libelle);
  }
}
