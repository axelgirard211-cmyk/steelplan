import type { CategorieTerrain, ZoneVent } from '../climat/vent';
import type { ZoneNeige } from '../climat/neige';

/**
 * LE SITE : où le bâtiment est construit.
 *
 * ⚠ Quatre données, et elles suffisent à déduire toutes les charges climatiques.
 * Elles manquaient au modèle : neige et vent étaient saisis en kN/m² sans qu'on
 * sache d'où venaient les nombres. Or une région de neige se lit sur une carte
 * et se vérifie ; un « 0,45 kN/m² » saisi ne se vérifie pas.
 */
export interface SiteParams {
  /**
   * ⚠ `manuel` est le mode par DÉFAUT, et c'est délibéré : un fichier enregistré
   * avant ce module n'a pas de site, et ses charges ne doivent pas changer sous
   * son auteur au premier rechargement. Le passage à `eurocode` est un acte
   * explicite.
   */
  readonly mode: 'manuel' | 'eurocode';
  readonly zoneNeige: ZoneNeige;
  readonly zoneVent: ZoneVent;
  readonly terrain: CategorieTerrain;
  /** Altitude du site (m) : elle majore la neige au-delà de 200 m. */
  readonly altitude: number;
}

export const SITE_PAR_DEFAUT: SiteParams = {
  mode: 'manuel',
  zoneNeige: 'A1',
  zoneVent: '2',
  terrain: 'II',
  altitude: 150,
};
