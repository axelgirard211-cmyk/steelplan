import * as THREE from 'three';
import { COULEUR_SELECTION, type Matiere } from './colorMaps';

/**
 * MATÉRIAUX PARTAGÉS DES PIÈCES.
 *
 * ⚠ Un matériau par pièce, c'était deux mille matériaux pour un hangar : autant
 * d'objets à créer, à libérer et à téléverser, pour une dizaine de teintes
 * réellement distinctes. Ici, un matériau par ASPECT — couleur, matière, état de
 * sélection ou de survol — partagé par toutes les pièces qui l'affichent.
 *
 * La sélection et le survol ne retouchent donc plus la couleur d'un matériau (ce
 * qui teindrait toutes les pièces de la même couleur) : la pièce CHANGE de
 * matériau, et prend celui de l'aspect voulu.
 */

/** Ce qu'une pièce montre dans un mode de lecture donné. */
export interface Teinte {
  /** Couleur de lecture, employée hors du mode réaliste. */
  readonly couleur: number;
  /** Matière réelle en mode réaliste ; `null` dans les modes de lecture. */
  readonly matiere: Matiere | null;
}

/** Lueur de survol : assez pour désigner la pièce, pas pour la dénaturer. */
const LUEUR_SURVOL = 0x222a33;

export class Materiaux {
  private readonly surfaces = new Map<string, THREE.MeshStandardMaterial>();
  private readonly aretes = new Map<boolean, THREE.LineBasicMaterial>();
  /** Plans de coupe en cours : tout matériau, même créé après, les reçoit. */
  private plans: THREE.Plane[] = [];

  /**
   * Matériau de surface d'une pièce.
   *
   * En mode réaliste, la MATIÈRE prime sur la couleur de rôle : c'est elle qui
   * fait la différence entre de l'acier et du plastique teinté. Dans les modes de
   * lecture, on garde une surface mate, pour que la couleur reste franche et
   * comparable d'une pièce à l'autre — un reflet fausserait un code couleur.
   */
  surface(t: Teinte, selectionnee: boolean, survolee: boolean): THREE.MeshStandardMaterial {
    const m = t.matiere;
    const couleur = selectionnee ? COULEUR_SELECTION : m ? m.couleur : t.couleur;
    const metalness = m ? m.metalness : 0.1;
    const roughness = m ? m.roughness : 0.75;
    const lueur = survolee && !selectionnee ? LUEUR_SURVOL : 0x000000;
    const cle = `${couleur}|${metalness}|${roughness}|${lueur}`;
    let mat = this.surfaces.get(cle);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: couleur,
        metalness,
        roughness,
        emissive: lueur,
        clippingPlanes: this.plans,
        side: THREE.DoubleSide,
      });
      this.surfaces.set(cle, mat);
    }
    return mat;
  }

  /**
   * Matériau des arêtes. Elles servent à lire la structure ; en rendu réaliste
   * elles doivent s'effacer, sinon le modèle redevient un dessin.
   */
  arete(reel: boolean): THREE.LineBasicMaterial {
    let mat = this.aretes.get(reel);
    if (!mat) {
      mat = new THREE.LineBasicMaterial({
        color: 0x11151a,
        transparent: true,
        opacity: reel ? 0.12 : 0.35,
        clippingPlanes: this.plans,
      });
      this.aretes.set(reel, mat);
    }
    return mat;
  }

  /** Pose les plans de coupe sur tous les matériaux, présents et à venir. */
  couper(plans: THREE.Plane[]): void {
    this.plans = plans;
    for (const m of this.surfaces.values()) m.clippingPlanes = plans;
    for (const m of this.aretes.values()) m.clippingPlanes = plans;
  }

  dispose(): void {
    for (const m of this.surfaces.values()) m.dispose();
    for (const m of this.aretes.values()) m.dispose();
    this.surfaces.clear();
    this.aretes.clear();
  }
}
