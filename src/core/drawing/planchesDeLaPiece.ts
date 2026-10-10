import type { Sheet, SheetKind } from './sheet';

/**
 * OÙ EST DESSINÉE UNE PIÈCE — de la 3D aux planches.
 *
 * ⚠ Une pièce cliquée en 3D a sa place sur une dizaine de planches : son plan
 * d'assemblage, son plan de pièce, les détails de ses nœuds, le repérage, les
 * élévations. Les chercher une à une dans un dossier de cent planches, c'est
 * précisément ce que le lien entre le modèle et ses plans doit éviter.
 *
 * Une planche « montre » une pièce quand elle porte son repère — de débit ou
 * d'assemblage. Les tableaux (nomenclatures, listes, ordre de montage) le
 * portent aussi, mais n'y DESSINENT rien : ils sont écartés.
 */

export interface PlancheDeLaPiece {
  readonly sheet: Sheet;
  /** Repères de la pièce présents sur la planche. */
  readonly reperes: readonly string[];
}

/**
 * Ordre d'utilité, après le plan d'assemblage et le plan de pièce de LA pièce :
 * ses nœuds, sa place sur l'ouvrage, puis la tôlerie. Les AUTRES assemblages
 * qui emploient la même pièce de débit viennent en dernier : ils montrent la
 * pièce, mais pas celle qu'on a cliquée.
 */
const ORDRE: readonly SheetKind[] = ['detail', 'montage', 'elevation', 'coupe', 'ensemble', 'fondations', 'atelier', 'fabrication', 'debit'];

/** Planches qui dessinent sans être des tableaux. */
function dessine(s: Sheet): boolean {
  if (!ORDRE.includes(s.kind)) return false;
  if (s.id === 'montage-ordre') return false;
  // Documents de poste : seule la tôlerie dessine les pièces (imbrication, découpe).
  return s.kind !== 'atelier' || s.id.startsWith('tolerie');
}

/** Index des textes du dossier : quel texte figure sur quelles planches. */
export function indexDesTextes(dossier: readonly Sheet[]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  for (const [i, s] of dossier.entries()) {
    if (!dessine(s)) continue;
    for (const e of s.scene.entities) {
      if (e.kind !== 'texte') continue;
      const l = index.get(e.texte);
      if (l) l.add(i);
      else index.set(e.texte, new Set([i]));
    }
  }
  return index;
}

/**
 * Planches qui montrent la pièce, les plus utiles d'abord : son plan
 * d'assemblage, son plan de pièce, puis les autres par nature, dans l'ordre du
 * dossier.
 */
export function planchesDeLaPiece(
  dossier: readonly Sheet[],
  index: ReadonlyMap<string, ReadonlySet<number>>,
  piece: { readonly debit: string; readonly assemblage: string },
): PlancheDeLaPiece[] {
  const reperes = [...new Set([piece.assemblage, piece.debit].filter((r) => r !== ''))];
  const trouvees = new Map<number, string[]>();
  for (const r of reperes) {
    for (const i of index.get(r) ?? []) trouvees.set(i, [...(trouvees.get(i) ?? []), r]);
  }
  const rang = (s: Sheet): number => {
    if (s.id === `fabrication-${piece.assemblage}`) return -2;
    if (s.id === `debit-${piece.debit}`) return -1;
    return ORDRE.indexOf(s.kind);
  };
  return [...trouvees.entries()]
    .map(([i, r]) => ({ i, sheet: dossier[i] as Sheet, reperes: r }))
    .sort((a, b) => rang(a.sheet) - rang(b.sheet) || a.i - b.i)
    .map(({ sheet, reperes: r }) => ({ sheet, reperes: r }));
}
