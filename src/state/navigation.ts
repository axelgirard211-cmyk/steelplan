import { create } from 'zustand';
import type { Poste } from '../core/drawing/postes';

/**
 * NAVIGATION ENTRE LES VUES — de la pièce cliquée en 3D à sa planche en 2D.
 *
 * Hors du projet : ouvrir une planche ne modifie rien et ne s'annule pas.
 */

export type Onglet = 'projet' | 'vue3d' | 'plans' | 'edition' | 'nomenclatures' | 'verifications' | 'catalogue';

export interface Demande2d {
  readonly planche: string;
  /** Repères à montrer sur la planche : la vue s'y cadre et les sélectionne. */
  readonly reperes: readonly string[];
  /** Compteur : redemander la même planche la rouvre, cadrée de nouveau. */
  readonly n: number;
}

interface Navigation {
  onglet: Onglet;
  demande2d: Demande2d | null;
  /** Rubrique de l'onglet Projet à montrer — celle où se corrige une erreur. */
  rubrique: { readonly titre: string; readonly n: number } | null;
  /** Ouvre l'onglet Projet sur la rubrique, qui s'éclaire. */
  allerA(titre: string): void;
  setOnglet(o: Onglet): void;
  /** Ouvre la planche en 2D dans la page d'édition, cadrée sur les repères. */
  voirEn2d(planche: string, reperes: readonly string[]): void;
  /**
   * Dossier ouvert dans l'onglet Plans : un poste, le dossier complet, ou
   * `null` tant qu'aucun n'est choisi. Gardé d'un onglet à l'autre : revenir
   * aux plans ne fait pas rechoisir.
   */
  postePlans: Poste | 'tous' | null;
  choisirPoste(p: Poste | 'tous' | null): void;
}

export const useNavigation = create<Navigation>((set, get) => ({
  onglet: 'projet',
  demande2d: null,
  rubrique: null,
  allerA: (titre) => set({ onglet: 'projet', rubrique: { titre, n: (get().rubrique?.n ?? 0) + 1 } }),
  setOnglet: (onglet) => set({ onglet }),
  voirEn2d: (planche, reperes) => set({ onglet: 'edition', demande2d: { planche, reperes, n: (get().demande2d?.n ?? 0) + 1 } }),
  postePlans: null,
  choisirPoste: (postePlans) => set({ postePlans }),
}));
