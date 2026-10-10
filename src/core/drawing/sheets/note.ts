import { AVERTISSEMENT, RATIO_LABELS, type ChecksReport } from '../../checks/types';
import { dessinerCadre, fenetreDe, type CartoucheData } from '../layout';
import { DrawScene, pt } from '../scene';
import type { Sheet } from '../sheet';
import {
  HAUTEUR_LIGNE,
  HAUTEUR_TETE,
  TEXTE,
  dessinerTableau,
  lignesParPage,
  type Colonne,
} from './nomenclature';

/**
 * NOTE DE PRÉ-DIMENSIONNEMENT.
 *
 * ⚠ Elle fait partie du dossier de plans, avec le même cartouche et le même
 * indice de révision. Un tableau de taux de travail imprimé séparément se
 * retrouve, six mois plus tard, à côté de plans qui ont changé — et personne ne
 * peut plus dire à quelle version il correspond.
 *
 * L'avertissement de pré-dimensionnement figure sur CHAQUE planche, pas seulement
 * sur la première : les feuilles se séparent, se photocopient et se transmettent
 * à l'unité. C'est le cartouche qui le porte, donc toutes les planches du dossier
 * l'ont — il n'y a rien à ajouter ici, et surtout pas une seconde copie du texte.
 */

export interface NoteOptions {
  readonly page: number;
  readonly total: number;
  readonly meta: CartoucheData['meta'];
}

const COLONNES: Colonne[] = [
  { titre: 'Rep.', poids: 5 },
  { titre: 'Profil', poids: 10 },
  { titre: 'Nuance', poids: 6 },
  { titre: 'Cl.', poids: 3, aDroite: true },
  { titre: 'N (kN)', poids: 7, aDroite: true },
  { titre: 'My (kN·m)', poids: 8, aDroite: true },
  { titre: 'Mz (kN·m)', poids: 8, aDroite: true },
  { titre: 'V (kN)', poids: 7, aDroite: true },
  { titre: 'Section', poids: 6, aDroite: true },
  { titre: 'Cisail.', poids: 6, aDroite: true },
  { titre: 'Flamb.', poids: 6, aDroite: true },
  { titre: 'Stab. N+M', poids: 8, aDroite: true },
  { titre: 'Flèche', poids: 6, aDroite: true },
  { titre: 'Élanc.', poids: 6, aDroite: true },
  { titre: 'Taux', poids: 6, aDroite: true },
  { titre: 'Gouverné par', poids: 14 },
  { titre: 'Combinaison', poids: 20 },
];

const n = (v: number, d = 0): string =>
  v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const taux = (v: number): string => (v <= 0 ? '—' : v.toFixed(2).replace('.', ','));

/**
 * Largeur d'un caractère, en fraction de la hauteur de texte.
 *
 * ⚠ Mesurée sur le rendu réel, pas estimée : 1,356 mm pour une hauteur de 2,2 mm,
 * soit 0,616. Une valeur trop faible fait croire qu'une ligne tient alors qu'elle
 * dépasse le cadre — et ce qui déborde ici, ce sont les hypothèses de calcul,
 * précisément ce qu'on ne peut pas se permettre de perdre à l'impression. La marge
 * portée à 0,65 couvre les chaînes riches en majuscules.
 */
export const LARGEUR_CARACTERE = 0.65;

/** Nombre de caractères qui tiennent sur une largeur donnée. */
export function caracteresParLigne(largeur: number, hauteur = TEXTE): number {
  return Math.max(10, Math.floor(largeur / (hauteur * LARGEUR_CARACTERE)));
}

export function sheetsNote(rapport: ChecksReport, opts: NoteOptions): Sheet[] {
  const format = 'A3' as const;
  const fenetre = fenetreDe(format);
  const parPage = lignesParPage();
  const lignes = rapport.lines.map((l) => [
    l.mark,
    l.profileId,
    l.grade,
    String(l.cls),
    n(l.nEd),
    n(l.myEd, 1),
    n(l.mzEd, 2),
    n(l.vEd),
    taux(l.ratios.section),
    taux(l.ratios.cisaillement),
    taux(l.ratios.flambement),
    taux(l.ratios.stabilite),
    taux(l.ratios.fleche),
    taux(l.ratios.elancement),
    l.ratio.toFixed(2).replace('.', ','),
    RATIO_LABELS[l.gouverne],
    l.combinaison,
  ]);

  const pages = Math.max(1, Math.ceil(lignes.length / parPage));
  const out: Sheet[] = [];
  let page = opts.page;

  for (let i = 0; i < pages; i++) {
    const titre =
      pages > 1
        ? `Note de pré-dimensionnement — taux de travail (${i + 1}/${pages})`
        : 'Note de pré-dimensionnement — taux de travail';
    const s = new DrawScene();
    dessinerCadre(s, format, {
      meta: opts.meta,
      titre,
      echelle: 1,
      page: page++,
      total: opts.total,
    });
    dessinerTableau(s, COLONNES, lignes.slice(i * parPage, (i + 1) * parPage), fenetre);
    out.push({
      id: pages > 1 ? `note-taux-${i + 1}` : 'note-taux',
      kind: 'nomenclature',
      titre,
      format,
      echelle: 1,
      scene: s,
    });
  }

  if (rapport.assemblages.length > 0) {
    out.push(planchAssemblages(rapport, { ...opts, page: page++ }));
  }
  out.push(planchHypotheses(rapport, { ...opts, page: page++ }));
  return out;
}

/* ------------------------------------------------------------------ */

/**
 * Planche des assemblages.
 *
 * ⚠ Elle porte TOUTES les vérifications de chaque assemblage, et la liste de ce
 * que le calcul ne couvre pas. Le taux gouvernant seul dirait « 0,93 » sans dire
 * s'il faut épaissir la platine, grossir les boulons ou allonger les cordons.
 * Et une planche qui tairait les modes non examinés laisserait croire
 * l'assemblage entièrement vérifié — ce qu'il n'est pas.
 */
function planchAssemblages(rapport: ChecksReport, opts: NoteOptions): Sheet {
  const format = 'A3' as const;
  const fenetre = fenetreDe(format);
  const s = new DrawScene();
  const titre = 'Note de pré-dimensionnement — assemblages (EN 1993-1-8)';
  dessinerCadre(s, format, {
    meta: opts.meta,
    titre,
    echelle: 1,
    page: opts.page,
    total: opts.total,
  });

  const largeur = fenetre.max.x - fenetre.min.x;
  let y = fenetre.max.y - HAUTEUR_TETE;
  const ligne = (x: number, t: string, gras = false, hauteur = TEXTE): void => {
    s.texte(pt(fenetre.min.x + x, y), t, { hauteur, gras });
  };

  for (const a of rapport.assemblages) {
    if (y < fenetre.min.y + HAUTEUR_LIGNE * 6) break;

    y -= HAUTEUR_LIGNE * 1.6;
    ligne(0, `${a.libelle} — ${a.boulon}`, true, TEXTE * 1.25);
    y -= 1.5;
    s.ligne(pt(fenetre.min.x, y), pt(fenetre.max.x, y), 'contour');

    y -= HAUTEUR_LIGNE;
    ligne(0, `${a.sollicitations}   sous ${a.combinaison}`);
    y -= HAUTEUR_LIGNE;
    ligne(
      0,
      `Taux ${a.ratio.toFixed(2).replace('.', ',')} — gouverné par : ${a.gouverne}`,
      true,
    );

    for (const v of a.verifs) {
      y -= HAUTEUR_LIGNE;
      ligne(4, v.nom);
      s.texte(pt(fenetre.min.x + largeur * 0.62, y), `${n(v.ed, 1)} / ${n(v.rd, 1)} ${v.unite}`, {
        hauteur: TEXTE,
        ancrage: 'droite',
      });
      s.texte(pt(fenetre.min.x + largeur * 0.72, y), v.ratio.toFixed(2).replace('.', ','), {
        hauteur: TEXTE,
        gras: v.ratio > 1,
        ancrage: 'droite',
      });
    }

    for (const nc of a.nonCouvert) {
      const cars = caracteresParLigne(largeur - 8);
      for (const [i, morceau] of couper(nc, cars).entries()) {
        y -= HAUTEUR_LIGNE;
        ligne(4, i === 0 ? `⚠ non couvert : ${morceau}` : `   ${morceau}`);
      }
    }
  }

  return { id: 'note-assemblages', kind: 'nomenclature', titre, format, echelle: 1, scene: s };
}

/** Découpe un texte à la largeur utile, aux espaces. */
function couper(texte: string, cars: number): string[] {
  const out: string[] = [];
  let ligne = '';
  for (const mot of texte.split(' ')) {
    if (ligne.length + mot.length + 1 > cars) {
      if (ligne) out.push(ligne);
      ligne = mot;
    } else ligne = ligne ? `${ligne} ${mot}` : mot;
  }
  if (ligne) out.push(ligne);
  return out;
}

/* ------------------------------------------------------------------ */

/** Planche des hypothèses, des combinaisons et des pièces non vérifiées. */
function planchHypotheses(rapport: ChecksReport, opts: NoteOptions): Sheet {
  const format = 'A3' as const;
  const fenetre = fenetreDe(format);
  const s = new DrawScene();
  const titre = 'Note de pré-dimensionnement — hypothèses et combinaisons';
  dessinerCadre(s, format, {
    meta: opts.meta,
    titre,
    echelle: 1,
    page: opts.page,
    total: opts.total,
  });

  const largeur = fenetre.max.x - fenetre.min.x;
  let y = fenetre.max.y - HAUTEUR_TETE;

  const section = (t: string): void => {
    y -= HAUTEUR_LIGNE * 1.4;
    s.texte(pt(fenetre.min.x, y), t, { hauteur: TEXTE * 1.3, gras: true });
    y -= 1.5;
    s.ligne(pt(fenetre.min.x, y), pt(fenetre.max.x, y), 'contour');
    y -= HAUTEUR_LIGNE * 0.4;
  };

  const paragraphe = (texte: string, puce = '—'): void => {
    // Découpe à la largeur utile. Les lignes de continuation sont décalées de
    // 4 mm : la largeur disponible en est réduite d'autant.
    const cars = caracteresParLigne(largeur - 4);
    const mots = texte.split(' ');
    let ligne = '';
    let premiere = true;
    for (const mot of mots) {
      if (ligne.length + mot.length + 1 > cars) {
        y -= HAUTEUR_LIGNE;
        s.texte(pt(fenetre.min.x + (premiere ? 0 : 4), y), (premiere ? `${puce} ` : '') + ligne, {
          hauteur: TEXTE,
        });
        premiere = false;
        ligne = mot;
      } else ligne = ligne ? `${ligne} ${mot}` : mot;
    }
    if (ligne) {
      y -= HAUTEUR_LIGNE;
      s.texte(pt(fenetre.min.x + (premiere ? 0 : 4), y), (premiere ? `${puce} ` : '') + ligne, {
        hauteur: TEXTE,
      });
    }
  };

  section('Avertissement');
  paragraphe(AVERTISSEMENT, '⚠');
  paragraphe(
    'Les valeurs de neige et de vent sont celles saisies par l’utilisateur : elles ne sont ' +
      'ni calculées ni vérifiées par le logiciel.',
  );

  section('Synthèse');
  paragraphe(
    `Taux de travail maximal ${rapport.maxRatio.toFixed(2).replace('.', ',')} sur ` +
      `${rapport.lines.length} repères vérifiés ; ${rapport.nonVerifies} repère(s) au-delà de 1,00.`,
  );

  section('Hypothèses de calcul');
  for (const h of rapport.hypotheses) paragraphe(h);

  section('Combinaisons examinées');
  for (const c of rapport.combinations) {
    paragraphe(
      `${c.id} : ${c.label}${c.windDirection < 0 && !c.vent ? ' (vent en sens inverse)' : ''}`,
      '·',
    );
  }

  if (rapport.nonVerifiables.length > 0) {
    section('Pièces non vérifiées par le logiciel');
    for (const x of rapport.nonVerifiables) paragraphe(`${x.mark} : ${x.raison}`);
  }

  return { id: 'note-hypotheses', kind: 'nomenclature', titre, format, echelle: 1, scene: s };
}
