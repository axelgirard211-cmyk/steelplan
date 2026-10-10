import { dimensionner, type OptionsDimensionnement } from './dimensionner';
import type { ProjectParams } from '../model/project';

/**
 * DIMENSIONNEMENT EN TÂCHE DE FOND.
 *
 * ⚠ La recherche construit et vérifie le modèle des dizaines de fois : sur le
 * fil de l'interface, l'écran se figeait pendant tout ce temps, sans pouvoir ni
 * suivre ni interrompre. Ici, elle tourne à côté ; l'interface reçoit
 * l'avancement poste par poste, puis la proposition.
 */

export interface DemandeDimensionnement {
  readonly projet: ProjectParams;
  readonly options: Omit<OptionsDimensionnement, 'onProgres'>;
}

export type MessageDimensionnement =
  | { readonly type: 'progres'; readonly fait: number; readonly total: number; readonly libelle: string }
  | { readonly type: 'fin'; readonly proposition: ReturnType<typeof dimensionner> }
  | { readonly type: 'erreur'; readonly message: string };

const envoyer = (m: MessageDimensionnement): void => {
  // Le modèle porte ses statistiques en accesseur : la copie entre fils
  // d'exécution les évalue, rien d'autre n'est à préparer.
  (self as unknown as { postMessage(m: MessageDimensionnement): void }).postMessage(m);
};

self.onmessage = (e: MessageEvent<DemandeDimensionnement>): void => {
  try {
    const proposition = dimensionner(e.data.projet, {
      ...e.data.options,
      onProgres: (fait, total, libelle) => envoyer({ type: 'progres', fait, total, libelle }),
    });
    envoyer({ type: 'fin', proposition });
  } catch (err) {
    envoyer({ type: 'erreur', message: err instanceof Error ? err.message : String(err) });
  }
};
