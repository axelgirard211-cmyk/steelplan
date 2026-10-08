import * as THREE from 'three';

/**
 * JAUGE DE MESURE — deux points cliqués, leur distance.
 *
 * Isolée de la scène parce qu'elle n'en dépend que par deux choses : le groupe
 * où elle dessine et la taille des billes, proportionnée au bâtiment pour rester
 * visible sans masquer l'assemblage qu'on mesure.
 */
export class Jauge {
  readonly groupe = new THREE.Group();
  private points: THREE.Vector3[] = [];

  constructor(private readonly onMesure: (distance: number | null) => void) {}

  /** Efface les points et la ligne, et annonce qu'il n'y a plus de mesure. */
  effacer(): void {
    this.points = [];
    for (const enfant of [...this.groupe.children]) {
      this.groupe.remove(enfant);
      if (enfant instanceof THREE.Mesh || enfant instanceof THREE.Line) {
        enfant.geometry.dispose();
        (enfant.material as THREE.Material).dispose();
      }
    }
    this.onMesure(null);
  }

  /**
   * Ajoute un point. Au second, trace la ligne et donne la distance ; un
   * troisième clic recommence une nouvelle mesure.
   */
  ajouter(p: THREE.Vector3, rayonBille: number): void {
    if (this.points.length === 2) this.effacer();
    this.points.push(p.clone());

    const bille = new THREE.Mesh(
      new THREE.SphereGeometry(rayonBille, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb300 }),
    );
    bille.position.copy(p);
    this.groupe.add(bille);

    if (this.points.length === 2) {
      const [a, b] = this.points as [THREE.Vector3, THREE.Vector3];
      const ligne = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: 0xffb300 }),
      );
      this.groupe.add(ligne);
      this.onMesure(a.distanceTo(b));
    }
  }
}
