/**
 * `DrawScene` : représentation vectorielle NEUTRE d'un dessin.
 *
 * C'est la pièce maîtresse de l'architecture des plans. Les générateurs de
 * planches produisent une `DrawScene`, et trois moteurs de rendu la consomment :
 * SVG pour l'écran, PDF pour l'impression, DXF pour l'export. Aucun d'eux ne
 * refait de géométrie — ils traduisent. Une cote ne peut donc pas différer entre
 * ce qu'on voit et ce qui sort de l'imprimante.
 *
 * ⚠ Toutes les coordonnées d'une `DrawScene` sont en MILLIMÈTRES PAPIER, origine
 * en bas à gauche de la feuille, Y vers le haut. La conversion depuis le modèle
 * est faite en amont par la vue et son échelle : à ce stade, plus aucune notion
 * de modèle ne subsiste, ce qui rend le rendu trivial et non ambigu.
 */

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export const pt = (x: number, y: number): Pt => ({ x, y });

/**
 * Calques normalisés du dessin technique. Ils portent l'épaisseur et le style de
 * trait : le rendu n'a aucune décision à prendre.
 */
export type Layer =
  | 'contour' // arêtes vues, trait fort
  | 'contour-fin' // arêtes secondaires
  | 'cachee' // arêtes cachées, tireté
  | 'axe' // axes et lignes de centre, mixte
  | 'cotation'
  | 'hachure'
  | 'texte'
  | 'reperage' // repères de pièces
  | 'cartouche'
  | 'cadre';

export interface LayerStyle {
  /** Épaisseur de trait sur le papier (mm). */
  readonly width: number;
  /** Motif de tireté (mm), vide pour un trait continu. */
  readonly dash: readonly number[];
}

/**
 * Épaisseurs de la série normalisée (ISO 128) : 0,18 / 0,25 / 0,35 / 0,5 / 0,7.
 * Le rapport 2 entre trait fort et trait fin est ce qui rend un plan lisible
 * après photocopie en atelier.
 */
export const LAYER_STYLES: Readonly<Record<Layer, LayerStyle>> = {
  contour: { width: 0.5, dash: [] },
  'contour-fin': { width: 0.25, dash: [] },
  cachee: { width: 0.25, dash: [4, 2] },
  axe: { width: 0.18, dash: [12, 2, 2, 2] },
  cotation: { width: 0.18, dash: [] },
  hachure: { width: 0.18, dash: [] },
  texte: { width: 0.18, dash: [] },
  reperage: { width: 0.35, dash: [] },
  cartouche: { width: 0.25, dash: [] },
  cadre: { width: 0.7, dash: [] },
};

export type TextAnchor = 'gauche' | 'centre' | 'droite';
export type TextBaseline = 'bas' | 'milieu' | 'haut';

export type DrawEntity =
  | { readonly kind: 'ligne'; readonly a: Pt; readonly b: Pt; readonly layer: Layer }
  | {
      readonly kind: 'polyligne';
      readonly points: readonly Pt[];
      readonly fermee: boolean;
      readonly layer: Layer;
    }
  | { readonly kind: 'cercle'; readonly c: Pt; readonly r: number; readonly layer: Layer }
  | {
      readonly kind: 'arc';
      readonly c: Pt;
      readonly r: number;
      /** Angles en radians, sens trigonométrique. */
      readonly a0: number;
      readonly a1: number;
      readonly layer: Layer;
    }
  | {
      readonly kind: 'texte';
      readonly at: Pt;
      readonly texte: string;
      /** Hauteur de caractère sur le papier (mm). */
      readonly hauteur: number;
      readonly ancrage: TextAnchor;
      readonly ligneDeBase: TextBaseline;
      /** Rotation en degrés, sens trigonométrique. */
      readonly rotation: number;
      readonly gras: boolean;
      readonly layer: Layer;
    }
  | {
      readonly kind: 'hachure';
      readonly contour: readonly Pt[];
      readonly trous: readonly (readonly Pt[])[];
      /** Écartement des hachures sur le papier (mm). */
      readonly pas: number;
      /** Inclinaison en degrés. */
      readonly angle: number;
      readonly layer: Layer;
    }
  | {
      readonly kind: 'remplissage';
      readonly contour: readonly Pt[];
      readonly trous: readonly (readonly Pt[])[];
      /** Niveau de gris de 0 (noir) à 1 (blanc). */
      readonly gris: number;
      readonly layer: Layer;
    };

/**
 * Accumulateur d'entités. Volontairement mutable pendant la construction d'une
 * planche, puis figé : construire un dessin est une suite d'ajouts, en faire un
 * objet immuable à chaque trait n'apporterait rien et coûterait cher.
 */
export class DrawScene {
  private readonly entites: DrawEntity[] = [];

  ligne(a: Pt, b: Pt, layer: Layer = 'contour'): this {
    this.entites.push({ kind: 'ligne', a, b, layer });
    return this;
  }

  polyligne(points: readonly Pt[], fermee = false, layer: Layer = 'contour'): this {
    if (points.length >= 2) this.entites.push({ kind: 'polyligne', points, fermee, layer });
    return this;
  }

  rectangle(a: Pt, b: Pt, layer: Layer = 'contour'): this {
    return this.polyligne(
      [pt(a.x, a.y), pt(b.x, a.y), pt(b.x, b.y), pt(a.x, b.y)],
      true,
      layer,
    );
  }

  cercle(c: Pt, r: number, layer: Layer = 'contour'): this {
    if (r > 0) this.entites.push({ kind: 'cercle', c, r, layer });
    return this;
  }

  arc(c: Pt, r: number, a0: number, a1: number, layer: Layer = 'contour'): this {
    if (r > 0) this.entites.push({ kind: 'arc', c, r, a0, a1, layer });
    return this;
  }

  texte(
    at: Pt,
    texte: string,
    options: {
      hauteur?: number;
      ancrage?: TextAnchor;
      ligneDeBase?: TextBaseline;
      rotation?: number;
      gras?: boolean;
      layer?: Layer;
    } = {},
  ): this {
    if (texte !== '') {
      this.entites.push({
        kind: 'texte',
        at,
        texte,
        hauteur: options.hauteur ?? 2.5,
        ancrage: options.ancrage ?? 'gauche',
        ligneDeBase: options.ligneDeBase ?? 'bas',
        rotation: options.rotation ?? 0,
        gras: options.gras ?? false,
        layer: options.layer ?? 'texte',
      });
    }
    return this;
  }

  hachure(
    contour: readonly Pt[],
    trous: readonly (readonly Pt[])[] = [],
    pas = 2,
    angle = 45,
  ): this {
    if (contour.length >= 3) {
      this.entites.push({ kind: 'hachure', contour, trous, pas, angle, layer: 'hachure' });
    }
    return this;
  }

  remplissage(
    contour: readonly Pt[],
    trous: readonly (readonly Pt[])[] = [],
    gris = 0.85,
    layer: Layer = 'contour-fin',
  ): this {
    if (contour.length >= 3) {
      this.entites.push({ kind: 'remplissage', contour, trous, gris, layer });
    }
    return this;
  }

  /** Ajoute une entité telle quelle — celles que le dessinateur a retouchées. */
  entite(e: DrawEntity): this {
    this.entites.push(e);
    return this;
  }

  /** Ajoute toutes les entités d'une autre scène, telles quelles. */
  fusionner(autre: DrawScene): this {
    this.entites.push(...autre.entities);
    return this;
  }

  /**
   * Remplace un texte posé par un autre — c'est ainsi que le numéro de planche
   * est écrit, une fois le dossier entier connu.
   */
  remplacerTexte(ancien: string, nouveau: string): number {
    let n = 0;
    for (const [i, e] of this.entites.entries()) {
      if (e.kind === 'texte' && e.texte === ancien) {
        this.entites[i] = { ...e, texte: nouveau };
        n += 1;
      }
    }
    return n;
  }

  get entities(): readonly DrawEntity[] {
    return this.entites;
  }

  get length(): number {
    return this.entites.length;
  }
}

/** Rectangle englobant d'un ensemble de points. */
export interface Bbox {
  readonly min: Pt;
  readonly max: Pt;
}

export function bboxDe(points: readonly Pt[]): Bbox {
  if (points.length === 0) return { min: pt(0, 0), max: pt(0, 0) };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { min: pt(x0, y0), max: pt(x1, y1) };
}

export function largeurDe(b: Bbox): number {
  return b.max.x - b.min.x;
}

export function hauteurDe(b: Bbox): number {
  return b.max.y - b.min.y;
}

/** Réunion de deux rectangles englobants. */
export function unionBbox(a: Bbox, b: Bbox): Bbox {
  return {
    min: pt(Math.min(a.min.x, b.min.x), Math.min(a.min.y, b.min.y)),
    max: pt(Math.max(a.max.x, b.max.x), Math.max(a.max.y, b.max.y)),
  };
}
