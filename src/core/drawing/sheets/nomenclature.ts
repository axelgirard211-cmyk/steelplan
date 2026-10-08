import type { Bom } from '../../bom/index';
import { roundMm } from '../../math/tolerance';
import { dessinerCadre, fenetreDe, type CartoucheData, type SheetFormat } from '../layout';
import { DrawScene, pt } from '../scene';
import type { Sheet } from '../sheet';

/**
 * PLANCHES DE NOMENCLATURE.
 *
 * Les nomenclatures font partie du dossier de plans, pas d'un fichier à côté :
 * une liste de débit imprimée séparément se perd, ou se retrouve à un indice
 * différent de celui des plans. Elles portent donc le même cartouche, avec le
 * même indice de révision et la même pagination.
 *
 * Les tableaux sont paginés : on n'écrase pas trois cents lignes sur une feuille.
 */

/** Colonne d'un tableau : largeur relative et alignement. */
export interface Colonne {
  readonly titre: string;
  /** Largeur relative ; la somme est ramenée à la largeur utile. */
  readonly poids: number;
  readonly aDroite?: boolean;
}

export const HAUTEUR_LIGNE = 4.6;
export const HAUTEUR_TETE = 6;
export const TEXTE = 2.2;

export interface NomenclatureOptions {
  readonly format?: SheetFormat;
  /** Numéro de la première planche du lot. */
  readonly page: number;
  readonly total: number;
  readonly meta: CartoucheData['meta'];
}

/** Construit les planches de nomenclature du dossier, dans l'ordre d'un DCE. */
export function sheetsNomenclature(bom: Bom, opts: NomenclatureOptions): Sheet[] {
  const out: Sheet[] = [];
  let page = opts.page;
  const suivante = (): NomenclatureOptions => ({ ...opts, page: page++ });

  out.push(...tableau('nomenclature-debit', 'Liste de débit', COLONNES_DEBIT, lignesDebit(bom), suivante));
  if (bom.toles.length > 0) {
    out.push(...tableau('nomenclature-toles', 'Liste des tôles d’assemblage', COLONNES_TOLES, lignesToles(bom), suivante));
  }
  if (bom.bolts.length > 0) {
    out.push(...tableau('nomenclature-boulons', 'Liste de boulonnerie', COLONNES_BOULONS, lignesBoulons(bom), suivante));
  }
  out.push(syntheseSheet(bom, suivante()));
  return out;
}

/** Nombre de lignes qu'accepte une feuille A3, en-tête déduit. */
export function lignesParPage(): number {
  const fenetre = fenetreDe('A3');
  const hauteurUtile = fenetre.max.y - fenetre.min.y - HAUTEUR_TETE - 6;
  return Math.max(1, Math.floor(hauteurUtile / HAUTEUR_LIGNE));
}

/* ------------------------------------------------------------------ */

const COLONNES_DEBIT: Colonne[] = [
  { titre: 'Rep.', poids: 5 },
  { titre: 'Désignation', poids: 16 },
  { titre: 'Profil', poids: 12 },
  { titre: 'Nuance', poids: 7 },
  { titre: 'Qté', poids: 5, aDroite: true },
  { titre: 'Long. (mm)', poids: 9, aDroite: true },
  { titre: 'Maxi (mm)', poids: 9, aDroite: true },
  { titre: 'Coupes (°)', poids: 9, aDroite: true },
  { titre: 'Perç.', poids: 5, aDroite: true },
  { titre: 'Grug.', poids: 5, aDroite: true },
  { titre: 'kg/u', poids: 7, aDroite: true },
  { titre: 'kg total', poids: 8, aDroite: true },
];

function lignesDebit(bom: Bom): string[][] {
  return bom.debit.map((l) => [
    l.mark,
    l.designation,
    l.profileId,
    l.grade,
    String(l.quantity),
    String(roundMm(l.length)),
    String(roundMm(l.lengthMax)),
    `${l.angleStart.toFixed(1)} / ${l.angleEnd.toFixed(1)}`,
    l.holes > 0 ? String(l.holes) : '—',
    l.notches > 0 ? String(l.notches) : '—',
    l.massUnit.toFixed(1),
    l.massTotal.toFixed(1),
  ]);
}

const COLONNES_TOLES: Colonne[] = [
  { titre: 'Rep.', poids: 6 },
  { titre: 'Désignation', poids: 20 },
  { titre: 'Nuance', poids: 8 },
  { titre: 'Dimensions (mm)', poids: 20 },
  { titre: 'Perçages', poids: 12, aDroite: true },
  { titre: 'Qté', poids: 7, aDroite: true },
  { titre: 'kg/u', poids: 9, aDroite: true },
  { titre: 'kg total', poids: 10, aDroite: true },
];

function lignesToles(bom: Bom): string[][] {
  return bom.toles.map((l) => [
    l.mark,
    l.designation,
    l.grade,
    `${roundMm(l.width)} × ${roundMm(l.height)} × ${l.thickness}`,
    l.holes > 0 ? `${l.holes} × Ø${l.holeDiameter}` : '—',
    String(l.quantity),
    l.massUnit.toFixed(2),
    l.massTotal.toFixed(1),
  ]);
}

const COLONNES_BOULONS: Colonne[] = [
  { titre: 'Désignation', poids: 20 },
  { titre: 'Classe', poids: 8 },
  { titre: 'Serrage (mm)', poids: 12, aDroite: true },
  { titre: 'Quantité', poids: 10, aDroite: true },
  { titre: 'Emploi', poids: 28 },
  { titre: 'kg/u', poids: 9, aDroite: true },
  { titre: 'kg total', poids: 10, aDroite: true },
];

function lignesBoulons(bom: Bom): string[][] {
  return bom.bolts.map((l) => [
    l.designation,
    l.cls,
    l.grip.toFixed(1),
    String(l.count),
    l.usage,
    l.massUnit.toFixed(3),
    l.massTotal.toFixed(1),
  ]);
}

/* ------------------------------------------------------------------ */

/**
 * Trace un tableau, paginé autant que nécessaire. Chaque page reprend la ligne
 * d'en-tête : une page de nomenclature doit se lire seule.
 */
function tableau(
  id: string,
  titre: string,
  colonnes: readonly Colonne[],
  lignes: readonly (readonly string[])[],
  suivante: () => NomenclatureOptions,
): Sheet[] {
  const format = 'A3' as const;
  const fenetre = fenetreDe(format);
  const parPage = lignesParPage();
  const pages = Math.max(1, Math.ceil(lignes.length / parPage));

  const out: Sheet[] = [];
  for (let i = 0; i < pages; i++) {
    const opts = suivante();
    const tranche = lignes.slice(i * parPage, (i + 1) * parPage);
    const titreComplet = pages > 1 ? `${titre} (${i + 1}/${pages})` : titre;

    const s = new DrawScene();
    dessinerCadre(s, format, {
      meta: opts.meta,
      titre: titreComplet,
      echelle: 1,
      page: opts.page,
      total: opts.total,
    });
    dessinerTableau(s, colonnes, tranche, fenetre);

    out.push({
      id: pages > 1 ? `${id}-${i + 1}` : id,
      kind: 'nomenclature',
      titre: titreComplet,
      format,
      // Une nomenclature n'est pas à l'échelle : c'est un tableau, pas un dessin.
      echelle: 1,
      scene: s,
    });
  }
  return out;
}

export function dessinerTableau(
  s: DrawScene,
  colonnes: readonly Colonne[],
  lignes: readonly (readonly string[])[],
  fenetre: { min: { x: number; y: number }; max: { x: number; y: number } },
): void {
  const largeurUtile = fenetre.max.x - fenetre.min.x;
  const sommePoids = colonnes.reduce((t, c) => t + c.poids, 0);

  // Abscisses de début de chaque colonne.
  const bords: number[] = [fenetre.min.x];
  for (const c of colonnes) {
    bords.push((bords[bords.length - 1] as number) + (c.poids / sommePoids) * largeurUtile);
  }

  let y = fenetre.max.y - HAUTEUR_TETE;

  // En-tête : trait fort dessus et dessous, c'est ce qui la détache.
  s.ligne(pt(fenetre.min.x, fenetre.max.y), pt(fenetre.max.x, fenetre.max.y), 'contour');
  s.ligne(pt(fenetre.min.x, y), pt(fenetre.max.x, y), 'contour');
  for (const [i, c] of colonnes.entries()) {
    const x0 = bords[i] as number;
    const x1 = bords[i + 1] as number;
    s.texte(pt(c.aDroite ? x1 - 1.5 : x0 + 1.5, y + 1.8), c.titre, {
      hauteur: TEXTE,
      ancrage: c.aDroite ? 'droite' : 'gauche',
      gras: true,
    });
  }

  // Lignes.
  for (const ligne of lignes) {
    y -= HAUTEUR_LIGNE;
    for (const [i, valeur] of ligne.entries()) {
      const c = colonnes[i];
      if (!c) continue;
      const x0 = bords[i] as number;
      const x1 = bords[i + 1] as number;
      s.texte(pt(c.aDroite ? x1 - 1.5 : x0 + 1.5, y + 1.4), valeur, {
        hauteur: TEXTE,
        ancrage: c.aDroite ? 'droite' : 'gauche',
      });
    }
    s.ligne(pt(fenetre.min.x, y), pt(fenetre.max.x, y), 'contour-fin');
  }

  // Filets verticaux, jusqu'à la dernière ligne écrite seulement.
  for (const x of bords) {
    s.ligne(pt(x, fenetre.max.y), pt(x, y), 'contour-fin');
  }
}

/** Feuille de synthèse : les grandeurs qu'on lit en premier sur un devis. */
function syntheseSheet(bom: Bom, opts: NomenclatureOptions): Sheet {
  const format = 'A4' as const;
  const fenetre = fenetreDe(format);
  const s = new DrawScene();
  dessinerCadre(s, format, {
    meta: opts.meta,
    titre: 'Synthèse du projet',
    echelle: 1,
    page: opts.page,
    total: opts.total,
  });

  const t = bom.totals;
  const blocs: [string, [string, string][]][] = [
    [
      'MASSES',
      [
        ['Barres', `${t.massMembers.toFixed(0)} kg`],
        ['Tôles d’assemblage', `${t.massPlates.toFixed(0)} kg`],
        ['Acier de charpente', `${t.massSteel.toFixed(0)} kg`],
        ['Boulonnerie', `${t.massBolts.toFixed(1)} kg`],
        ['TOTAL À LIVRER', `${t.massTotal.toFixed(0)} kg`],
        ...Object.entries(t.massByGrade).map(
          ([n, m]) => [`dont ${n}`, `${(m ?? 0).toFixed(0)} kg`] as [string, string],
        ),
      ],
    ],
    [
      'QUANTITÉS',
      [
        ['Pièces', String(t.pieceCount)],
        ['Repères distincts', String(t.markCount)],
        ['Boulons', String(t.boltCount)],
        ['Cordons de soudure', `${t.weldMetres.toFixed(1)} m`],
        ['Métal d’apport', `${t.weldMassKg.toFixed(2)} kg`],
      ],
    ],
    [
      'SURFACES',
      [
        ['Emprise au sol', `${t.footprintM2.toFixed(1)} m²`],
        ['Toiture développée', `${t.roofM2.toFixed(1)} m²`],
        ['À peindre ou galvaniser', `${t.paintM2.toFixed(1)} m²`],
        ['Ratio de charpente', `${t.kgPerM2.toFixed(1)} kg/m²`],
      ],
    ],
  ];

  let y = fenetre.max.y - 6;
  for (const [titre, valeurs] of blocs) {
    s.texte(pt(fenetre.min.x, y), titre, { hauteur: 2.8, gras: true });
    s.ligne(pt(fenetre.min.x, y - 1.8), pt(fenetre.min.x + 110, y - 1.8), 'contour');
    y -= 6.5;
    for (const [k, v] of valeurs) {
      s.texte(pt(fenetre.min.x + 2, y), k, { hauteur: 2.4 });
      s.texte(pt(fenetre.min.x + 108, y), v, { hauteur: 2.4, ancrage: 'droite', gras: true });
      y -= 4.4;
    }
    y -= 4;
  }

  return {
    id: 'nomenclature-synthese',
    kind: 'nomenclature',
    titre: 'Synthèse du projet',
    format,
    echelle: 1,
    scene: s,
  };
}
