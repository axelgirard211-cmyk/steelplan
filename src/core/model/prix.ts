/**
 * GRILLE DE PRIX DU CHIFFRAGE.
 *
 * ⚠ Elle voyage AVEC le projet : un chiffrage remis au client doit pouvoir se
 * refaire à l'identique en rouvrant le fichier six mois plus tard, quels que
 * soient les prix du jour. La grille de l'entreprise, elle, est mémorisée sur
 * le poste et reprise par chaque nouveau projet.
 *
 * Fourniture et atelier sont toujours chiffrés ; transport, montage, frais
 * généraux, aléas et marge ne le sont que si l'entreprise les renseigne — à
 * zéro, ils sont dits « non chiffrés », pas comptés pour rien en silence.
 */
export interface GrillePrix {
  /** Prix de l'acier au kilo, par nuance (€/kg) ; une nuance absente prend celui du S235. */
  readonly acier: Readonly<Record<string, number>>;
  /** Boulonnerie, prix moyen par boulon posé (€). */
  readonly boulon: number;
  /** Coût horaire d'atelier, débit et perçage compris (€/h). */
  readonly heureAtelier: number;
  /** Temps de préparation par pièce débitée (h). */
  readonly heureParPiece: number;
  /** Cadence de soudure (m de cordon par heure). */
  readonly cadenceSoudure: number;
  /** Traitement de surface (€/m²). */
  readonly peinture: number;
  readonly galvanisation: number;
  /** Transport jusqu'au chantier, par tonne livrée (€/t) ; 0 = non chiffré. */
  readonly transport: number;
  /** Montage sur chantier, levage compris, par tonne montée (€/t) ; 0 = non chiffré. */
  readonly montage: number;
  /** Frais généraux, en % du déboursé sec. */
  readonly fraisGeneraux: number;
  /** Aléas, en % du déboursé sec. */
  readonly aleas: number;
  /** Marge, en % du prix de revient (déboursé, frais généraux et aléas). */
  readonly marge: number;
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
  boulon: 2.4,
  heureAtelier: 55,
  heureParPiece: 0.25,
  cadenceSoudure: 6,
  peinture: 14,
  galvanisation: 22,
  transport: 0,
  montage: 0,
  fraisGeneraux: 0,
  aleas: 0,
  marge: 0,
};
