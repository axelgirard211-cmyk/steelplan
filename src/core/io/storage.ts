import type { ProjectParams } from '../model/project';
import { deserializeProject, serializeProject } from './serialize';

/**
 * SAUVEGARDE AUTOMATIQUE.
 *
 * Le travail en cours survit à une fermeture d'onglet, à un plantage du
 * navigateur et à une coupure de courant. Ce n'est pas un substitut au fichier
 * projet : c'est un filet, et il doit se comporter comme tel — ne jamais faire
 * échouer l'application, quoi qu'il arrive au stockage.
 *
 * ⚠ Trois façons dont `localStorage` peut refuser de coopérer, toutes réelles :
 * il est indisponible en navigation privée sur certains navigateurs, il lève une
 * exception quand le quota est atteint, et son contenu peut avoir été écrit par
 * une version antérieure du logiciel. Aucune ne doit empêcher de travailler.
 */

const CLE = 'steelplan.autosave.v1';

export interface Autosave {
  readonly project: ProjectParams;
  /** Instant de l'enregistrement, en millisecondes depuis l'époque. */
  readonly at: number;
  /** Nombre d'éditions au moment de l'enregistrement, pour l'afficher. */
  readonly edits: number;
}

/** Le stockage utilisable, ou `null` s'il est indisponible. */
export function stockageDisponible(store: Storage | undefined = safeLocalStorage()): Storage | null {
  if (!store) return null;
  try {
    // Le seul test fiable est une écriture : la présence de l'objet ne garantit
    // rien, Safari en navigation privée l'expose et refuse d'y écrire.
    const sonde = `${CLE}.sonde`;
    store.setItem(sonde, '1');
    store.removeItem(sonde);
    return store;
  } catch {
    return null;
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Enregistre le projet. Renvoie `false` si le stockage a refusé — l'appelant
 * peut alors le signaler, mais l'application continue.
 */
export function enregistrerAuto(
  p: ProjectParams,
  edits: number,
  store: Storage | null = stockageDisponible(),
): boolean {
  if (!store) return false;
  try {
    store.setItem(
      CLE,
      JSON.stringify({ at: Date.now(), edits, projet: serializeProject(p) }),
    );
    return true;
  } catch {
    // Quota dépassé : on tente de faire de la place en supprimant la sauvegarde
    // précédente, puis on réessaie une fois. Si cela échoue encore, tant pis —
    // perdre le filet est acceptable, perdre la session ne l'est pas.
    try {
      store.removeItem(CLE);
      store.setItem(CLE, JSON.stringify({ at: Date.now(), edits, projet: serializeProject(p) }));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Relit la sauvegarde automatique.
 *
 * Toute anomalie — JSON tronqué, format d'une version future, champ corrompu —
 * se traduit par `null` et non par une exception : au démarrage, mieux vaut un
 * projet neuf qu'un écran d'erreur.
 */
export function relireAuto(store: Storage | null = stockageDisponible()): Autosave | null {
  if (!store) return null;
  try {
    const brut = store.getItem(CLE);
    if (!brut) return null;
    const enveloppe = JSON.parse(brut) as { at?: unknown; edits?: unknown; projet?: unknown };
    if (typeof enveloppe.projet !== 'string') return null;
    const { project } = deserializeProject(enveloppe.projet);
    return {
      project,
      at: typeof enveloppe.at === 'number' && Number.isFinite(enveloppe.at) ? enveloppe.at : 0,
      edits: typeof enveloppe.edits === 'number' && Number.isFinite(enveloppe.edits) ? enveloppe.edits : 0,
    };
  } catch {
    return null;
  }
}

export function oublierAuto(store: Storage | null = stockageDisponible()): void {
  try {
    store?.removeItem(CLE);
  } catch {
    /* rien à faire : le filet n'a pas pu être retiré, sans conséquence */
  }
}

/**
 * Enregistrement différé.
 *
 * Sérialiser à chaque frappe dans un champ numérique coûterait plus cher que la
 * régénération du modèle. On attend une accalmie — et on enregistre aussi à la
 * fermeture de la page, où le délai n'aurait jamais le temps d'expirer.
 */
export function creerAutosave(
  delaiMs = 1500,
  store: Storage | null = stockageDisponible(),
): {
  planifier: (p: ProjectParams, edits: number) => void;
  immediat: (p: ProjectParams, edits: number) => boolean;
  annuler: () => void;
  disponible: boolean;
} {
  let minuteur: ReturnType<typeof setTimeout> | null = null;
  let enAttente: { p: ProjectParams; edits: number } | null = null;

  const vider = (): void => {
    if (minuteur !== null) {
      clearTimeout(minuteur);
      minuteur = null;
    }
  };

  return {
    disponible: store !== null,
    planifier(p, edits) {
      enAttente = { p, edits };
      vider();
      minuteur = setTimeout(() => {
        minuteur = null;
        if (enAttente) enregistrerAuto(enAttente.p, enAttente.edits, store);
        enAttente = null;
      }, delaiMs);
    },
    immediat(p, edits) {
      vider();
      enAttente = null;
      return enregistrerAuto(p, edits, store);
    },
    annuler() {
      vider();
      enAttente = null;
    },
  };
}

export { CLE as CLE_AUTOSAVE };
