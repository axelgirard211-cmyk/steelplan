/**
 * TRAITEMENT DE SURFACE.
 *
 * Dernier poste de l'atelier, et le seul que le dossier ne portait pas : une
 * pièce sort débitée, percée, assemblée, soudée — puis part au traitement sans
 * qu'aucun document ne dise lequel. Or le peintre a besoin de trois choses que
 * personne d'autre ne peut lui donner : le degré de préparation, le système et
 * ses épaisseurs, la surface à traiter.
 *
 * Les valeurs par défaut suivent l'EN ISO 12944 pour la peinture et l'EN ISO
 * 1461 pour la galvanisation à chaud.
 */

/** Nature du traitement appliqué à l'ouvrage. */
export type TypeFinition = 'peinture' | 'galvanisation' | 'brut';

/**
 * Degré de préparation de surface, EN ISO 8501-1.
 *
 * `Sa 2½` — décapage par projection très soigné — est le degré courant en
 * charpente peinte : c'est celui qu'exigent les systèmes époxy. `St 2` (brossage
 * mécanique) ne se justifie que sur des reprises.
 */
export type PreparationSurface = 'Sa 3' | 'Sa 2½' | 'Sa 2' | 'St 3' | 'St 2';

/** Une couche du système : sa nature, sa teinte, son épaisseur sèche. */
export interface CouchePeinture {
  readonly nom: string;
  /** Épaisseur sèche nominale (µm). */
  readonly epaisseur: number;
  /** Teinte RAL, vide pour un primaire dont la teinte est imposée. */
  readonly ral: string;
}

export interface FinitionParams {
  readonly type: TypeFinition;
  readonly preparation: PreparationSurface;
  /**
   * Catégorie de corrosivité EN ISO 12944-2 : C1 intérieur sec, C3 urbain,
   * C4 industriel, C5 bord de mer. Elle justifie l'épaisseur totale demandée.
   */
  readonly categorie: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  readonly couches: readonly CouchePeinture[];
  /**
   * Épaisseur minimale de zinc (µm) pour la galvanisation.
   *
   * ⚠ L'EN ISO 1461 la fait dépendre de l'ÉPAISSEUR DE L'ACIER : 45 µm sous
   * 1,5 mm, 55 µm de 1,5 à 3 mm, 70 µm de 3 à 6 mm, 85 µm au-delà. Annoncer une
   * valeur unique reviendrait à promettre au galvanisateur quelque chose qu'il ne
   * peut pas tenir sur les pièces minces.
   */
  readonly zincMicrons: number;
  /** Consigne particulière : zones à réserver, reprises sur chantier… */
  readonly note: string;
}

export const FINITION_PAR_DEFAUT: FinitionParams = {
  type: 'peinture',
  preparation: 'Sa 2½',
  categorie: 'C3',
  couches: [
    { nom: 'Primaire époxy zinc', epaisseur: 60, ral: '' },
    { nom: 'Finition polyuréthane', epaisseur: 60, ral: 'RAL 7016' },
  ],
  zincMicrons: 85,
  note: 'Réserver les surfaces de contact des assemblages boulonnés précontraints.',
};

/** Épaisseur sèche totale du système (µm). */
export function epaisseurTotale(f: FinitionParams): number {
  if (f.type === 'galvanisation') return f.zincMicrons;
  if (f.type === 'brut') return 0;
  return f.couches.reduce((s, c) => s + c.epaisseur, 0);
}

/**
 * Désignation courte du traitement, telle qu'elle figure sur un cartouche.
 *
 * Exemple : « Peinture EN ISO 12944 C3 — Sa 2½ — 120 µm (2 couches) ».
 */
export function designationFinition(f: FinitionParams): string {
  if (f.type === 'brut') return 'Acier brut — aucun traitement';
  if (f.type === 'galvanisation') {
    return `Galvanisation à chaud EN ISO 1461 — ${f.zincMicrons} µm mini`;
  }
  const n = f.couches.length;
  return (
    `Peinture EN ISO 12944 ${f.categorie} — ${f.preparation} — ` +
    `${epaisseurTotale(f)} µm (${n} couche${n > 1 ? 's' : ''})`
  );
}

/** Teinte de finition, ou une chaîne vide si le système n'en impose pas. */
export function teinteFinition(f: FinitionParams): string {
  for (let i = f.couches.length - 1; i >= 0; i--) {
    const ral = f.couches[i]?.ral;
    if (ral) return ral;
  }
  return '';
}

/**
 * Épaisseur de zinc exigible pour une épaisseur d'acier donnée (µm),
 * EN ISO 1461 tableau 3.
 */
export function zincExigible(epaisseurAcier: number): number {
  if (epaisseurAcier < 1.5) return 45;
  if (epaisseurAcier < 3) return 55;
  if (epaisseurAcier < 6) return 70;
  return 85;
}
