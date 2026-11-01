import { Component, type ReactNode } from 'react';
import { useEtatModele } from '../state/derived';
import { selectCanUndo, useProjectStore } from '../state/store';
import { useNavigation } from '../state/navigation';
import { RUBRIQUES } from './projet/rubriques';

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
  const allerA = useNavigation((s) => s.allerA);
  if (etat.aJour) return null;
  return (
    <div className="bandeau-modele" role="alert">
      <strong>Saisie invalide — les vues montrent le dernier état valide.</strong>
      <ul>
        {etat.raisons.map((r) => {
          // « Rubrique — message » : la rubrique mène à la fiche où corriger.
          // ⚠ Par le titre entier : « Trame — paramètres » contient lui-même le tiret.
          const titre = RUBRIQUES.find((x) => r.startsWith(`${x.titre} — `))?.titre;
          if (!titre) return <li key={r}>{r}</li>;
          return (
            <li key={r}>
              <button type="button" className="lien-bandeau" onClick={() => allerA(titre)}>
                {titre} →
              </button>{' '}
              {r.slice(titre.length + 3)}
            </li>
          );
        })}
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
    /*
     * ⚠ Un module chargé à la demande (la vue 3D) qui n'a pas pu être lu — le
     * serveur a été arrêté ou l'application mise à jour — ne se relit pas :
     * le navigateur garde l'échec, et « Réessayer » échouait à l'identique. Seul
     * un rechargement de la page le relit ; la sauvegarde automatique garde le
     * travail en cours.
     */
    if (moduleIntrouvable(e)) {
      return (
        <section className="principal">
          <div className="bandeau-modele" role="alert">
            <strong>Une partie de l’application n’a pas pu être chargée.</strong>
            <ul>
              <li>Le serveur de l’application ne répond plus, ou l’application a été mise à jour. Votre travail est conservé par la sauvegarde automatique.</li>
            </ul>
            <button type="button" className="plat" onClick={() => window.location.reload()}>
              Recharger la page
            </button>
          </div>
        </section>
      );
    }
    return (
      <section className="principal">
        <div className="bandeau-modele" role="alert">
          <strong>Cet affichage a rencontré une erreur et n’a pas pu être dessiné.</strong>
          <p>Annulez la dernière modification ; si l’erreur revient, enregistrez et rechargez la page.</p>
          {/* Le message de l'exception, souvent en anglais : utile pour un
              signalement, pas pour l'utilisateur. */}
          <details>
            <summary>Détail technique</summary>
            <code>{e.message}</code>
          </details>
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

/** L'erreur vient-elle d'un module chargé à la demande qui n'a pas pu être lu ? */
export function moduleIntrouvable(e: Error): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Loading chunk/i.test(e.message);
}
