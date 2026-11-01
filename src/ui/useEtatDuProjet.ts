import { useEffect, useState } from 'react';
import { buildBom } from '../core/bom/index';
import { valoriser } from '../core/bom/valorisation';
import { horsDomaineSecondOrdre, type ChecksReport } from '../core/checks/types';
import { checksReport, projetEffectif, structuralModel } from '../state/derived';
import { useProjectStore } from '../state/store';

/**
 * L'ÉTAT DU PROJET, d'un coup d'œil — ce que montrent les onglets.
 *
 * Ce qu'un projeteur se demande à tout moment : ma saisie est-elle valide ? Le
 * bâtiment tient-il ? Combien pèse-t-il, combien coûte-t-il ? Les réponses
 * existaient, dispersées dans trois onglets ; elles suivent maintenant la
 * saisie, sur les onglets eux-mêmes.
 *
 * ⚠ Calculé APRÈS la frappe, pas pendant : la vérification complète prend
 * jusqu'à cent millisecondes sur un treillis, et la refaire à chaque chiffre
 * tapé figerait le champ. Le rapport est celui, mis en cache, de l'onglet
 * Vérifications : l'ouvrir ensuite ne recalcule rien.
 */
export interface EtatDuProjet {
  readonly erreurs: number;
  readonly avertissements: number;
  /** Taux maximal des barres et des assemblages. */
  readonly tauxMax: number;
  /** Repères et assemblages au-delà de 1,00. */
  readonly enDefaut: number;
  /**
   * Ossature sous αcr = 3 : aucun de ses taux n'est une vérification.
   *
   * ⚠ Distinct de `enDefaut`, et prioritaire sur lui à l'affichage : sans ce
   * drapeau, une ossature hors domaine dont les taux au premier ordre restent
   * sous 1,00 passait au vert sur les onglets.
   */
  readonly horsDomaine: boolean;
  readonly masseKg: number;
  readonly prixHT: number;
}

/** Ce que les onglets retiennent du rapport de vérification. */
export function resumerVerifications(
  rapport: ChecksReport,
): Pick<EtatDuProjet, 'tauxMax' | 'enDefaut' | 'horsDomaine'> {
  const assemblages = rapport.assemblages.map((a) => a.ratio);
  return {
    tauxMax: Math.max(rapport.maxRatio, ...assemblages, 0),
    enDefaut: rapport.nonVerifies + assemblages.filter((r) => r > 1).length,
    horsDomaine: horsDomaineSecondOrdre(rapport) !== null,
  };
}

const DELAI = 350;

/** Dernier état calculé, par projet : les onglets et le parcours le partagent. */
let cache: { cle: unknown; etat: EtatDuProjet } | null = null;

export function useEtatDuProjet(): EtatDuProjet | null {
  const project = useProjectStore((s) => s.project);
  const issues = useProjectStore((s) => s.issues);
  const [etat, setEtat] = useState<EtatDuProjet | null>(cache?.etat ?? null);

  useEffect(() => {
    if (cache?.cle === project) {
      setEtat(cache.etat);
      return undefined;
    }
    const t = window.setTimeout(() => {
      // Un autre composant vient peut-être de le calculer pour ce même projet.
      if (cache?.cle === project) {
        setEtat(cache.etat);
        return;
      }
      try {
        const rapport = checksReport(project);
        const p = projetEffectif(project);
        const model = structuralModel(project);
        const bom = buildBom(p, model);
        // Les prix de la saisie : une grille corrigée se voit tout de suite.
        const prix = valoriser(bom, p.finition, project.prix);
        const e: EtatDuProjet = {
          erreurs: issues.filter((i) => i.level === 'erreur').length,
          avertissements: issues.filter((i) => i.level === 'avertissement').length,
          ...resumerVerifications(rapport),
          masseKg: bom.totals.massTotal,
          prixHT: prix.total,
        };
        cache = { cle: project, etat: e };
        setEtat(e);
      } catch {
        // Un calcul qui échoue laisse l'état précédent : les onglets ne mentent
        // pas, ils attendent la prochaine saisie valide.
      }
    }, DELAI);
    return () => window.clearTimeout(t);
  }, [project, issues]);

  return etat;
}
