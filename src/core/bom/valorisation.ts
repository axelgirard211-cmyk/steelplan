import type { Bom } from './index';
import type { FinitionParams } from '../model/finition';

/**
 * VALORISATION — ce que l'ouvrage coûte.
 *
 * ⚠ Toutes les quantités existaient déjà : le tonnage par nuance, les mètres de
 * cordon, les mètres carrés à peindre, le nombre de boulons. Il ne manquait que
 * la grille de prix pour en faire un chiffre. Sans elle, un chiffrage se refait
 * sur un tableur à côté — et le tableur ne se met pas à jour quand la portée
 * change.
 *
 * Le résultat n'est PAS un devis : il ne contient ni frais de chantier, ni
 * transport, ni marge, ni aléas. C'est un coût de fourniture et de main-d'œuvre
 * d'atelier, à quoi sert un ordre de grandeur en phase d'esquisse.
 */

export interface GrillePrix {
  /** Prix de l'acier au kilo, par nuance (€/kg). */
  readonly acier: Readonly<Record<string, number>>;
  /** Coût horaire d'atelier, débit et perçage compris (€/h). */
  readonly heureAtelier: number;
  /** Cadence de soudure (m de cordon par heure). */
  readonly cadenceSoudure: number;
  /** Temps de préparation par pièce débitée (h). */
  readonly heureParPiece: number;
  /** Traitement de surface (€/m²). */
  readonly peinture: number;
  readonly galvanisation: number;
  /** Boulonnerie, prix moyen par boulon posé (€). */
  readonly boulon: number;
}

/**
 * Grille par défaut, ordres de grandeur français 2026.
 *
 * ⚠ Ce sont des ordres de grandeur, PAS des prix de marché. Ils bougent d'un
 * fournisseur à l'autre et d'un mois à l'autre ; la grille est là pour être
 * remplacée par celle de l'entreprise, pas pour être crue.
 */
export const GRILLE_PAR_DEFAUT: GrillePrix = {
  acier: { S235: 1.15, S275: 1.2, S355: 1.25, S420: 1.45, S460: 1.55 },
  heureAtelier: 55,
  cadenceSoudure: 6,
  heureParPiece: 0.25,
  peinture: 14,
  galvanisation: 22,
  boulon: 2.4,
};

export interface LigneValorisation {
  readonly poste: string;
  readonly quantite: number;
  readonly unite: string;
  readonly prixUnitaire: number;
  readonly montant: number;
}

export interface Valorisation {
  readonly lignes: readonly LigneValorisation[];
  readonly total: number;
  /** Coût ramené au kilo d'acier : le ratio que tout le métier emploie. */
  readonly parKg: number;
  readonly masseKg: number;
}

export function valoriser(
  bom: Bom,
  finition: FinitionParams,
  grille: GrillePrix = GRILLE_PAR_DEFAUT,
): Valorisation {
  const lignes: LigneValorisation[] = [];
  const ajouter = (
    poste: string,
    quantite: number,
    unite: string,
    prixUnitaire: number,
  ): void => {
    if (quantite <= 0) return;
    lignes.push({ poste, quantite, unite, prixUnitaire, montant: quantite * prixUnitaire });
  };

  /*
   * ⚠ L'acier se valorise PAR NUANCE, pas au tonnage global. Un S355 coûte 10 %
   * de plus qu'un S235 : mélanger les deux dans un prix moyen fait perdre
   * exactement l'arbitrage qu'on cherche à éclairer quand on change de nuance.
   */
  const parNuance = new Map<string, number>();
  for (const d of bom.debit) {
    parNuance.set(d.grade, (parNuance.get(d.grade) ?? 0) + d.massTotal);
  }
  for (const t of bom.toles) {
    parNuance.set(t.grade, (parNuance.get(t.grade) ?? 0) + t.massTotal);
  }
  for (const [nuance, masse] of [...parNuance].sort((a, b) => b[1] - a[1])) {
    ajouter(`Acier ${nuance}`, masse, 'kg', grille.acier[nuance] ?? grille.acier['S235'] ?? 1.15);
  }
  const masseKg = [...parNuance.values()].reduce((s, m) => s + m, 0);

  /*
   * Main-d'œuvre d'atelier : une part par PIÈCE — manutention, réglage, contrôle —
   * et une part par mètre de cordon. Les deux comptent : cinq cents pannes sans
   * une soudure coûtent malgré tout des heures d'atelier.
   */
  const nbPieces = bom.debit.reduce((s, d) => s + d.quantity, 0);
  ajouter('Débit, perçage et manutention', nbPieces, 'pièce', grille.heureParPiece * grille.heureAtelier);

  const metresCordon = bom.welds.reduce((s, w) => s + w.metres, 0);
  ajouter(
    'Soudure',
    metresCordon,
    'm de cordon',
    grille.heureAtelier / Math.max(0.1, grille.cadenceSoudure),
  );

  /* Traitement de surface : la surface développée est déjà à la nomenclature. */
  const m2 = bom.totals.paintM2;
  if (finition.type === 'peinture') ajouter('Peinture', m2, 'm²', grille.peinture);
  else if (finition.type === 'galvanisation') ajouter('Galvanisation', m2, 'm²', grille.galvanisation);

  const nbBoulons = bom.totals.boltCount;
  ajouter('Boulonnerie posée', nbBoulons, 'boulon', grille.boulon);

  const total = lignes.reduce((s, l) => s + l.montant, 0);
  return { lignes, total, parKg: masseKg > 0 ? total / masseKg : 0, masseKg };
}
