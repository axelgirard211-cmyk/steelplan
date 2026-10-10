import { transformer } from '../../core/drawing/geometrie2d';
import {
  ajouter,
  cleDeRef,
  copier,
  effacer,
  modifier,
  type ElementEditable,
  type EntiteDessin,
  type RetouchesDePlanche,
} from '../../core/drawing/retouches';
import type { Action } from './commandes';

/**
 * Applique aux retouches de la planche les actions rendues par une commande.
 *
 * Pure : elle rend les nouvelles retouches, le libellé de l'étape d'historique
 * et s'il faut vider la sélection — une entité générée modifiée devient un
 * ajout, et son ancienne référence n'existe plus.
 */
export function appliquerActions(
  r: RetouchesDePlanche,
  actions: readonly Action[],
  selection: readonly ElementEditable[],
  elements: readonly ElementEditable[],
): { retouches: RetouchesDePlanche; libelle: string; vider: boolean } {
  let r2 = r;
  let libelle = '';
  let vider = false;
  for (const a of actions) {
    switch (a.type) {
      case 'ajouter':
        r2 = ajouter(r2, a.entites);
        libelle = a.libelle;
        break;
      case 'effacer':
        r2 = effacer(r2, selection.map((el) => el.ref));
        libelle = 'Effacer';
        vider = true;
        break;
      case 'transformer': {
        const f = (e: EntiteDessin): EntiteDessin => transformer(e, a.affine);
        r2 = a.copie ? copier(r2, selection, f) : modifier(r2, selection, f);
        libelle = a.libelle;
        if (!a.copie) vider = true;
        break;
      }
      case 'remplacer': {
        // Le premier morceau prend la place de l'entité (et garde son origine),
        // les suivants s'ajoutent ; aucun morceau : elle disparaît.
        const el = elements.find((x) => cleDeRef(x.ref) === a.cle);
        if (!el) break;
        const [premier, ...suite] = a.par;
        r2 = premier ? modifier(r2, [el], () => premier) : effacer(r2, [el.ref]);
        if (suite.length > 0) r2 = ajouter(r2, suite);
        libelle = a.libelle;
        vider = true;
        break;
      }
    }
  }
  return { retouches: r2, libelle, vider };
}
