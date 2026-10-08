import { Component, type ReactNode } from 'react';
import { useEtatModele } from '../state/derived';
import { selectCanUndo, useProjectStore } from '../state/store';

/**
 * BANDEAU — les vues montrent-elles bien ce qui a été saisi ?
 *
 * ⚠ Quand une saisie est invalide, la 3D, les plans et les calculs restent sur
 * le DERNIER ÉTAT VALIDE. Sans ce bandeau, l'écran paraîtrait ignorer la
 * modification : on taperait une portée, rien ne bougerait, et l'on finirait par
 * croire le logiciel en panne — ou pire, par exporter un dossier qui ne
 * correspond pas à la saisie.
 */
export function BandeauModele(): JSX.Element | null {
  const etat = useEtatModele();
  const undo = useProjectStore((s) => s.undo);
  const peutAnnuler = useProjectStore(selectCanUndo);
  if (etat.aJour) return null;
  return (
    <div className="bandeau-modele" role="alert">
      <strong>Saisie invalide — les vues montrent le dernier état valide.</strong>
      <ul>
        {etat.raisons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {/*
        * ⚠ Le bouton n'est offert que s'il y a quelque chose à annuler. Après la
        * restauration d'une sauvegarde fautive, l'historique est VIDE : un bouton
        * « Annuler » qui ne fait rien laisserait croire à une seconde panne.
        */}
      {peutAnnuler ? (
        <button type="button" className="plat" onClick={undo}>
          Annuler la dernière modification
        </button>
      ) : (
        <p>Corrigez la valeur signalée dans l’onglet Projet.</p>
      )}
    </div>
  );
}

/**
 * BARRIÈRE D'ERREUR — dernier filet sous l'interface.
 *
 * ⚠ Une exception imprévue pendant le rendu démontait TOUTE l'application :
 * page blanche, sans un mot ni moyen d'en sortir. Le garde-fou du projet
 * effectif couvre les saisies invalides ; celui-ci couvre le reste — ce qu'on
 * n'a pas prévu. Il garde l'en-tête et les onglets, et propose d'annuler la
 * dernière modification, qui est presque toujours la cause.
 */
export class BarriereErreur extends Component<
  { children: ReactNode; cle: string; onAnnuler: () => void },
  { erreur: Error | null }
> {
  override state: { erreur: Error | null } = { erreur: null };

  static getDerivedStateFromError(erreur: Error): { erreur: Error } {
    return { erreur };
  }

  override componentDidUpdate(precedent: { cle: string }): void {
    // Changer d'onglet ou de projet donne une nouvelle chance au rendu.
    if (precedent.cle !== this.props.cle && this.state.erreur) this.setState({ erreur: null });
  }

  override render(): ReactNode {
    const e = this.state.erreur;
    if (!e) return this.props.children;
    return (
      <section className="principal">
        <div className="bandeau-modele" role="alert">
          <strong>Cet affichage a rencontré une erreur et n’a pas pu être dessiné.</strong>
          <ul>
            <li>{e.message}</li>
          </ul>
          <button
            type="button"
            className="plat"
            onClick={() => {
              this.props.onAnnuler();
              this.setState({ erreur: null });
            }}
          >
            Annuler la dernière modification
          </button>{' '}
          <button type="button" className="plat" onClick={() => this.setState({ erreur: null })}>
            Réessayer
          </button>
        </div>
      </section>
    );
  }
}
