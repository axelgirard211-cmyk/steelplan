import { dimensionner, type OptionsDimensionnement, type Proposition } from '../core/checks/dimensionner';
import type { DemandeDimensionnement, MessageDimensionnement } from '../core/checks/dimensionner.worker';
import type { ProjectParams } from '../core/model/project';

export interface Avancement {
  readonly fait: number;
  readonly total: number;
  readonly libelle: string;
}

/**
 * Lance le dimensionnement à côté de l'interface, et rend de quoi l'attendre ou
 * l'interrompre. Sans fil d'exécution disponible, il tourne sur place, après
 * un tour de boucle pour que l'écran affiche d'abord « en cours ».
 */
export function dimensionnerEnFond(
  projet: ProjectParams,
  options: Omit<OptionsDimensionnement, 'onProgres'>,
  onProgres: (a: Avancement) => void,
): { resultat: Promise<Proposition>; interrompre: () => void } {
  if (typeof Worker === 'undefined') {
    let annule = false;
    const resultat = new Promise<Proposition>((ok, ko) =>
      setTimeout(() => {
        if (annule) return ko(new Error('interrompu'));
        try {
          ok(dimensionner(projet, { ...options, onProgres: (fait, total, libelle) => onProgres({ fait, total, libelle }) }));
        } catch (e) {
          ko(e);
        }
      }, 30),
    );
    return { resultat, interrompre: () => void (annule = true) };
  }

  const tache = new Worker(new URL('../core/checks/dimensionner.worker.ts', import.meta.url), { type: 'module' });
  let rejeter: (e: Error) => void = () => undefined;
  const resultat = new Promise<Proposition>((ok, ko) => {
    rejeter = ko;
    tache.onmessage = (e: MessageEvent<MessageDimensionnement>): void => {
      const m = e.data;
      if (m.type === 'progres') onProgres({ fait: m.fait, total: m.total, libelle: m.libelle });
      else {
        tache.terminate();
        if (m.type === 'fin') ok(m.proposition);
        else ko(new Error(m.message));
      }
    };
    tache.onerror = (e): void => {
      tache.terminate();
      ko(new Error(e.message || 'Le dimensionnement a échoué.'));
    };
  });
  const demande: DemandeDimensionnement = { projet, options };
  tache.postMessage(demande);
  return {
    resultat,
    interrompre: () => {
      tache.terminate();
      rejeter(new Error('interrompu'));
    },
  };
}
