import type { MemberRole } from '../core/geometry/member';

/** Mode de coloration de la vue 3D. */
export type ColorMode = 'realiste' | 'role' | 'profil' | 'taux' | 'uniforme';

/** Couleur par rôle : la lecture d'ensemble d'un hangar se fait à ça. */
export const ROLE_COLORS: Readonly<Record<MemberRole, number>> = {
  poteau: 0x3f6fa8,
  traverse: 0x4f8f4a,
  console: 0x6f9f5a,
  jarret: 0xb5651d,
  panne: 0x8a7fb5,
  lisse: 0x5f9ea0,
  potelet: 0x7f8fa0,
  chevetre: 0xc07f4a,
  'membrure-sup': 0x4f8f4a,
  'membrure-inf': 0x3f7f6a,
  montant: 0x9a8f3f,
  diagonale: 0xa06a4a,
  contreventement: 0xa8443f,
  lierne: 0x9a9a5a,
  attache: 0xb08a4a,
  equerre: 0xb08a4a,
  libre: 0x808890,
};

export const ROLE_LABELS: Readonly<Record<MemberRole, string>> = {
  poteau: 'Poteaux',
  traverse: 'Traverses',
  console: 'Consoles de débord',
  jarret: 'Jarrets',
  panne: 'Pannes',
  lisse: 'Lisses',
  potelet: 'Potelets',
  chevetre: 'Chevêtres d’ouverture',
  'membrure-sup': 'Membrures supérieures',
  'membrure-inf': 'Membrures inférieures',
  montant: 'Montants',
  diagonale: 'Diagonales',
  contreventement: 'Contreventements',
  lierne: 'Liernes',
  attache: 'Cornières d’attache',
  equerre: 'Équerres de lisse',
  libre: 'Barres libres',
};

const PALETTE_PROFILS = [
  0x3f6fa8, 0x4f8f4a, 0xb5651d, 0x8a7fb5, 0x5f9ea0, 0xa8443f, 0x9a8f3f, 0x7f8fa0,
  0x3f7f6a, 0xa06a4a,
];

/** Couleur stable d'un profil : même profil ⇒ même teinte d'une session à l'autre. */
export function profileColor(profileId: string): number {
  let h = 0;
  for (let i = 0; i < profileId.length; i++) h = (h * 31 + profileId.charCodeAt(i)) >>> 0;
  return PALETTE_PROFILS[h % PALETTE_PROFILS.length] as number;
}

export const COULEUR_UNIFORME = 0x8d949c;
/** Tôles d'assemblage : platines, goussets, éclisses. */
export const COULEUR_TOLE = 0xc9cdd3;
export const COULEUR_SELECTION = 0xffb300;

/* ------------------------------------------------------------------ */
/* Taux de travail                                                     */
/* ------------------------------------------------------------------ */

/**
 * Bandes de taux de travail.
 *
 * ⚠ La bande 0,95–1,00 existe pour elle-même. Un dégradé continu du vert au rouge
 * laisserait un élément à 0,99 quasiment indiscernable d'un élément à 0,90, alors
 * que la différence entre les deux est toute la marge qui reste. La lecture doit
 * être franche : conforme, limite, ou dépassé.
 *
 * Le gris est réservé aux pièces que SteelPlan ne vérifie pas — il ne signifie
 * jamais « conforme ».
 */
export const BANDES_TAUX = [
  { max: 0.5, couleur: 0x2f7d4f, label: '≤ 0,50 — largement dimensionné' },
  { max: 0.75, couleur: 0x6a9c3a, label: '0,50 – 0,75' },
  { max: 0.95, couleur: 0xc9a227, label: '0,75 – 0,95' },
  { max: 1.0, couleur: 0xd9741f, label: '0,95 – 1,00 — limite' },
  { max: Infinity, couleur: 0xb3241f, label: '> 1,00 — non vérifié' },
] as const;

export const COULEUR_NON_VERIFIE = 0x6b7280;

/** Couleur d'un taux de travail ; gris si la pièce n'est pas vérifiée. */
export function ratioColor(ratio: number | undefined): number {
  if (ratio === undefined || !Number.isFinite(ratio)) return COULEUR_NON_VERIFIE;
  return (BANDES_TAUX.find((b) => ratio <= b.max) ?? BANDES_TAUX[4]).couleur;
}

/* ------------------------------------------------------------------ */
/* Aspect réaliste                                                     */
/* ------------------------------------------------------------------ */

/**
 * Aspect de surface d'une pièce : couleur, et surtout comportement optique.
 *
 * ⚠ `metalness` et `roughness` font tout le travail. Un métal ne s'éclaire pas,
 * il reflète : c'est la rugosité qui distingue un acier galvanisé, brillant et
 * un peu bleuté, d'un acier peint, mat et absorbant. Une couleur seule, aussi
 * bien choisie soit-elle, donne du plastique.
 */
export interface Matiere {
  readonly couleur: number;
  readonly metalness: number;
  readonly roughness: number;
}

/** Acier peint : ossature principale, teinte primaire d'atelier. */
export const ACIER_PEINT: Matiere = { couleur: 0x5b6774, metalness: 0.28, roughness: 0.56 };

/** Acier galvanisé : ossature secondaire et contreventements, zinc clair. */
export const ACIER_GALVANISE: Matiere = { couleur: 0xa9b2ba, metalness: 0.92, roughness: 0.34 };

/** Boulonnerie : zinguée, plus brillante encore que les profils. */
export const ACIER_BOULON: Matiere = { couleur: 0xb9c0c6, metalness: 0.95, roughness: 0.26 };

/** Tôles d'assemblage : peintes comme l'ossature qu'elles relient. */
export const ACIER_TOLE: Matiere = { couleur: 0x6a7683, metalness: 0.3, roughness: 0.52 };

/**
 * Aspect réel d'un rôle donné.
 *
 * La répartition n'est pas décorative : c'est celle d'un hangar courant, dont
 * l'ossature principale est peinte en atelier et l'ossature secondaire livrée
 * galvanisée. Elle rend donc la structure lisible en plus d'être crédible — on
 * distingue au premier regard ce qui porte de ce qui est porté.
 */
export function matiereDeRole(role: MemberRole): Matiere {
  switch (role) {
    case 'panne':
    case 'lisse':
    case 'lierne':
    case 'attache':
    case 'contreventement':
      return ACIER_GALVANISE;
    default:
      return ACIER_PEINT;
  }
}

/**
 * Couleur d'une barre selon le mode de lecture en cours.
 *
 * En mode réaliste la couleur n'est qu'un repli : c'est la matière qui décide,
 * et l'appelant la choisit par `matiereDeRole`.
 */
export function couleurDeBarre(
  mode: ColorMode,
  role: MemberRole,
  profileId: string,
  mark: string,
  taux: ReadonlyMap<string, number> | null,
): number {
  if (mode === 'uniforme') return COULEUR_UNIFORME;
  if (mode === 'profil') return profileColor(profileId);
  if (mode === 'taux') return ratioColor(taux?.get(mark));
  return ROLE_COLORS[role];
}
