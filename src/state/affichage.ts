import { create } from 'zustand';

/**
 * AFFICHAGE DE LA SAISIE — l'essentiel, ou tout.
 *
 * ⚠ Cent quarante champs en dix-huit rubriques : présentés d'un bloc, ils
 * intimidaient avant même la première cote, alors qu'un hangar se décrit par
 * sa trame, sa toiture, son portique, son ossature et son site. L'ESSENTIEL
 * montre ces rubriques ; le reste — assemblages, atelier, chiffrage… — garde
 * ses valeurs et s'ouvre d'un clic. Une rubrique qui porte une erreur s'affiche
 * toujours : masquer un défaut ne le corrige pas.
 *
 * Préférence de ce navigateur, jamais une donnée du projet ; le stockage peut
 * être refusé, on retombe alors sur l'essentiel.
 */

const CLE = 'steelplan.affichage';

function lire(): boolean {
  try {
    return localStorage.getItem(CLE) === 'complet';
  } catch {
    return false;
  }
}

interface Affichage {
  /** Toutes les rubriques, et non l'essentiel. */
  readonly complet: boolean;
  basculer(complet: boolean): void;
}

export const useAffichage = create<Affichage>((set) => ({
  complet: lire(),
  basculer: (complet) => {
    try {
      localStorage.setItem(CLE, complet ? 'complet' : 'essentiel');
    } catch {
      /* stockage indisponible : le choix vaut pour la session */
    }
    set({ complet });
  },
}));
