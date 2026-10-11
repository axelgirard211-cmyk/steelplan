/**
 * RUBRIQUES DE L'ONGLET PROJET, dans l'ordre de l'écran.
 *
 * Le `titre` est celui que rend `rubriqueDe` pour un paramètre fautif : c'est
 * lui qui relie une erreur à la fiche où elle se corrige.
 */

export interface Rubrique {
  readonly id: string;
  readonly titre: string;
  /** Libellé court du sommaire. */
  readonly court: string;
}

export const RUBRIQUES: readonly Rubrique[] = [
  { id: 'rubrique-trame', titre: 'Trame — paramètres', court: 'Trame' },
  { id: 'rubrique-deduites', titre: 'Trame — grandeurs déduites', court: 'Grandeurs déduites' },
  { id: 'rubrique-toiture', titre: 'Toiture', court: 'Toiture' },
  { id: 'rubrique-portique', titre: 'Portique', court: 'Portique' },
  { id: 'rubrique-secondaire', titre: 'Ossature secondaire', court: 'Pannes et lisses' },
  { id: 'rubrique-ouvertures', titre: 'Ouvertures', court: 'Ouvertures' },
  { id: 'rubrique-contreventements', titre: 'Contreventements', court: 'Contreventements' },
  { id: 'rubrique-assemblages', titre: 'Assemblages', court: 'Assemblages' },
  { id: 'rubrique-site', titre: 'Site et charges climatiques', court: 'Site, neige et vent' },
  { id: 'rubrique-charges', titre: 'Charges et critères', court: 'Charges et flèches' },
  { id: 'rubrique-finition', titre: 'Traitement de surface', court: 'Traitement de surface' },
  { id: 'rubrique-atelier', titre: 'Atelier', court: 'Atelier' },
  { id: 'rubrique-chiffrage', titre: 'Chiffrage', court: 'Chiffrage' },
  { id: 'rubrique-controle', titre: 'Contrôle du modèle', court: 'Contrôle du modèle' },
  { id: 'rubrique-barres-libres', titre: 'Barres libres', court: 'Barres libres' },
  { id: 'rubrique-cartouche', titre: 'Cartouche et indices', court: 'Cartouche et indices' },
  { id: 'rubrique-fichier', titre: 'Fichier projet', court: 'Fichier projet' },
];

/** Rubrique d'un titre rendu par `rubriqueDe` — « Projet » mène au contrôle du modèle. */
export function rubriqueParTitre(titre: string): Rubrique {
  return RUBRIQUES.find((r) => r.titre === titre) ?? (RUBRIQUES.find((r) => r.id === 'rubrique-controle') as Rubrique);
}

/** Minuscules sans accents : « Entraxe » se trouve en tapant « entraxe » comme « éntraxe ». */
export function normaliser(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
