import * as THREE from 'three';
import type { Eclairage } from './eclairage';

/**
 * Rendu À LA DEMANDE.
 *
 * ⚠ Une boucle continue redessinait soixante fois par seconde une scène
 * immobile — ombres en 2048², anticrénelage — et tenait la carte graphique
 * occupée pendant qu'on saisissait dans l'onglet voisin. On ne dessine plus
 * qu'une image par changement : caméra, modèle, couleurs, taille du cadre.
 * Plusieurs demandes dans la même trame ne donnent qu'une image.
 */
export class RenduADemande {
  /** Image demandée et pas encore dessinée (0 : aucune). */
  private image = 0;
  private arrete = false;

  /**
   * @param dessiner dessine une image. S'il redemande une image — l'amortissement
   * des contrôles qui fait encore glisser la vue —, elle suivra à la trame d'après.
   */
  constructor(private readonly dessiner: () => void) {}

  demander(): void {
    if (this.image !== 0 || this.arrete) return;
    this.image = requestAnimationFrame(this.trame);
  }

  /** Définitif : la scène est libérée, plus rien ne doit être dessiné. */
  arreter(): void {
    this.arrete = true;
    cancelAnimationFrame(this.image);
    this.image = 0;
  }

  private readonly trame = (): void => {
    this.image = 0;
    this.dessiner();
  };
}

/**
 * Libère le décor de la scène : environnement préfiltré (PMREM), carte d'ombres
 * du soleil, sol récepteur d'ombres et grille. Rien de cela ne passe par les
 * pièces, et rien ne serait libéré avec elles.
 */
export function libererDecor(scene: THREE.Scene, eclairage: Eclairage, grille: THREE.GridHelper): void {
  scene.environment?.dispose();
  scene.environment = null;
  eclairage.soleil.dispose();
  eclairage.sol.geometry.dispose();
  (eclairage.sol.material as THREE.Material).dispose();
  grille.geometry.dispose();
  (grille.material as THREE.Material).dispose();
}
