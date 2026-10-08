/**
 * RACCOURCIS CLAVIER.
 *
 * ⚠ Une seule déclaration, deux usages : la capture des touches ET l'aide qui les
 * liste. Deux listes séparées divergent toujours — l'aide finit par annoncer un
 * raccourci retiré, ce qui est pire que pas d'aide du tout.
 */

export interface Raccourci {
  readonly id: string;
  /** Touche telle que `KeyboardEvent.key`, comparée sans tenir compte de la casse. */
  readonly touche: string;
  readonly ctrl?: boolean;
  readonly maj?: boolean;
  readonly libelle: string;
  readonly groupe: 'Fichier' | 'Édition' | 'Navigation' | 'Vue 3D';
  /**
   * Le raccourci reste-t-il actif quand la frappe a lieu dans un champ de saisie ?
   *
   * Par défaut NON : taper « p » dans le nom du projet ne doit pas basculer sur
   * l'onglet des plans. Seuls les raccourcis à modificateur traversent les champs.
   */
  readonly dansLesChamps?: boolean;
}

export const RACCOURCIS: readonly Raccourci[] = [
  { id: 'nouveau', touche: 'n', ctrl: true, libelle: 'Nouveau projet', groupe: 'Fichier', dansLesChamps: true },
  { id: 'ouvrir', touche: 'o', ctrl: true, libelle: 'Ouvrir un projet', groupe: 'Fichier', dansLesChamps: true },
  { id: 'enregistrer', touche: 's', ctrl: true, libelle: 'Enregistrer', groupe: 'Fichier', dansLesChamps: true },
  {
    id: 'enregistrer-sous',
    touche: 's',
    ctrl: true,
    maj: true,
    libelle: 'Enregistrer sous',
    groupe: 'Fichier',
    dansLesChamps: true,
  },
  { id: 'undo', touche: 'z', ctrl: true, libelle: 'Annuler', groupe: 'Édition', dansLesChamps: true },
  { id: 'redo', touche: 'z', ctrl: true, maj: true, libelle: 'Rétablir', groupe: 'Édition', dansLesChamps: true },

  { id: 'onglet-projet', touche: '1', libelle: 'Onglet Projet', groupe: 'Navigation' },
  { id: 'onglet-vue3d', touche: '2', libelle: 'Onglet Vue 3D', groupe: 'Navigation' },
  { id: 'onglet-plans', touche: '3', libelle: 'Onglet Plans', groupe: 'Navigation' },
  { id: 'onglet-nomenclatures', touche: '4', libelle: 'Onglet Nomenclatures', groupe: 'Navigation' },
  { id: 'onglet-verifications', touche: '5', libelle: 'Onglet Vérifications', groupe: 'Navigation' },
  { id: 'onglet-catalogue', touche: '6', libelle: 'Onglet Catalogue', groupe: 'Navigation' },
  { id: 'aide', touche: '?', maj: true, libelle: 'Afficher cette aide', groupe: 'Navigation', dansLesChamps: true },
  { id: 'fermer', touche: 'Escape', libelle: 'Fermer le panneau ou la sélection', groupe: 'Navigation', dansLesChamps: true },

  { id: 'vue-iso', touche: 'i', libelle: 'Vue isométrique', groupe: 'Vue 3D' },
  { id: 'vue-face', touche: 'f', libelle: 'Vue de face (pignon)', groupe: 'Vue 3D' },
  { id: 'vue-cote', touche: 'c', libelle: 'Vue de côté (long pan)', groupe: 'Vue 3D' },
  { id: 'vue-dessus', touche: 'd', libelle: 'Vue de dessus', groupe: 'Vue 3D' },
  { id: 'recadrer', touche: 'r', libelle: 'Recadrer sur le bâtiment', groupe: 'Vue 3D' },
];

/**
 * La frappe a-t-elle lieu dans un champ de saisie ?
 *
 * ⚠ Volontairement écrit sans `instanceof HTMLElement` : ce global n'existe pas
 * hors navigateur, et le simple fait de le nommer fait lever la fonction. On lit
 * donc les deux propriétés qui nous intéressent, ce qui rend au passage la
 * fonction vérifiable sans DOM.
 */
export function dansUnChamp(cible: EventTarget | null): boolean {
  if (cible === null || typeof cible !== 'object') return false;
  const e = cible as { tagName?: unknown; isContentEditable?: unknown };
  if (e.isContentEditable === true) return true;
  return (
    typeof e.tagName === 'string' &&
    (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT')
  );
}

/**
 * Raccourci correspondant à un événement clavier, ou `null`.
 *
 * ⚠ Le raccourci le PLUS SPÉCIFIQUE gagne : Ctrl+Maj+S est « Enregistrer sous »
 * et non « Enregistrer » avec une majuscule en trop. Sans ce tri, l'ordre de
 * déclaration décide, et un jour quelqu'un réordonne la liste.
 */
export function trouverRaccourci(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  cible: EventTarget | null = null,
): Raccourci | null {
  if (e.altKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  const champ = dansUnChamp(cible);

  const candidats = RACCOURCIS.filter(
    (r) =>
      r.touche.toLowerCase() === e.key.toLowerCase() &&
      (r.ctrl ?? false) === ctrl &&
      (r.maj ?? false) === e.shiftKey &&
      (!champ || r.dansLesChamps === true),
  );
  if (candidats.length === 0) return null;
  const poids = (r: Raccourci): number => (r.ctrl ? 1 : 0) + (r.maj ? 1 : 0);
  return candidats.reduce((a, b) => (poids(b) > poids(a) ? b : a));
}

/** Écriture d'un raccourci pour l'aide, avec le symbole de la plateforme. */
export function libelleTouche(r: Raccourci, mac = estMac()): string {
  const parts: string[] = [];
  if (r.ctrl) parts.push(mac ? '⌘' : 'Ctrl');
  if (r.maj) parts.push(mac ? '⇧' : 'Maj');
  parts.push(r.touche === 'Escape' ? 'Échap' : r.touche.toUpperCase());
  return parts.join(mac ? '' : ' + ');
}

function estMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
}

/** Raccourcis regroupés, dans l'ordre d'affichage de l'aide. */
export function parGroupe(): [Raccourci['groupe'], Raccourci[]][] {
  const ordre: Raccourci['groupe'][] = ['Fichier', 'Édition', 'Navigation', 'Vue 3D'];
  return ordre.map((g) => [g, RACCOURCIS.filter((r) => r.groupe === g)]);
}
