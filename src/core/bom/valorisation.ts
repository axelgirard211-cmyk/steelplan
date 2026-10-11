import type { Bom } from './index';
import type { FinitionParams } from '../model/finition';
import { GRILLE_PAR_DEFAUT, type GrillePrix } from '../model/prix';

/**
 * VALORISATION — ce que l'ouvrage coûte.
 *
 * ⚠ Toutes les quantités existaient déjà : le tonnage par nuance, les mètres de
 * cordon, les mètres carrés à peindre, le nombre de boulons. Il ne manquait que
 * la grille de prix pour en faire un chiffre. Sans elle, un chiffrage se refait
 * sur un tableur à côté — et le tableur ne se met pas à jour quand la portée
 * change.
 *
 * Le résultat n'est PAS un devis tant que la grille n'est pas celle de
 * l'entreprise : transport, montage, frais généraux, aléas et marge n'y entrent
 * que s'ils sont renseignés, et ce qui manque est nommé (`nonChiffres`).
 */

export { GRILLE_PAR_DEFAUT, type GrillePrix } from '../model/prix';

export interface LigneValorisation {
  readonly poste: string;
  readonly quantite: number;
  readonly unite: string;
  /** Prix unitaire (€), ou taux (%) pour une ligne `taux`. */
  readonly prixUnitaire: number;
  readonly montant: number;
  /** Ligne en pourcentage : la quantité est une base en €, le prix un taux en %. */
  readonly taux?: boolean;
}

export interface Valorisation {
  readonly lignes: readonly LigneValorisation[];
  /** Fourniture, atelier, traitement, boulonnerie, transport et montage. */
  readonly deboursSec: number;
  readonly total: number;
  /** Postes à zéro dans la grille, donc absents du total — à dire avec le chiffre. */
  readonly nonChiffres: readonly string[];
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

  /*
   * Chantier : à la tonne, sur ce que le camion emporte — boulonnerie comprise —
   * pour le transport, sur l'acier monté pour le montage.
   */
  const nonChiffres: string[] = [];
  const tonnes = bom.totals.massTotal / 1000;
  if (grille.transport > 0) ajouter('Transport', tonnes, 't', grille.transport);
  else nonChiffres.push('transport');
  if (grille.montage > 0) ajouter('Montage et levage', masseKg / 1000, 't', grille.montage);
  else nonChiffres.push('montage');

  const deboursSec = lignes.reduce((s, l) => s + l.montant, 0);
  /*
   * ⚠ Frais généraux et aléas sur le DÉBOURSÉ SEC, la marge sur le PRIX DE
   * REVIENT qui les comprend : prendre la marge sur le seul déboursé la
   * sous-estime d'autant que les frais sont lourds.
   */
  const pourcent = (poste: string, base: number, taux: number, absent: string): void => {
    if (taux > 0) lignes.push({ poste, quantite: base, unite: '€', prixUnitaire: taux, montant: (base * taux) / 100, taux: true });
    else nonChiffres.push(absent);
  };
  pourcent('Frais généraux', deboursSec, grille.fraisGeneraux, 'frais généraux');
  pourcent('Aléas', deboursSec, grille.aleas, 'aléas');
  const revient = lignes.reduce((s, l) => s + l.montant, 0);
  pourcent('Marge', revient, grille.marge, 'marge');

  const total = lignes.reduce((s, l) => s + l.montant, 0);
  return { lignes, deboursSec, total, nonChiffres, parKg: masseKg > 0 ? total / masseKg : 0, masseKg };
}
