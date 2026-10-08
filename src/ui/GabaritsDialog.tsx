import { TEMPLATES, type Template } from '../core/model/templates';
import { Modale } from './Modale';

/**
 * CHOIX D'UN GABARIT DE DÉPART.
 *
 * ⚠ Le choix remplace le projet et VIDE L'HISTORIQUE : c'est irréversible, donc
 * il est annoncé. Un bouton qui efface une heure de travail sans le dire est un
 * piège, quel que soit le soin apporté au reste.
 */
export function GabaritsDialog({
  ouvert,
  travauxEnCours,
  onChoisir,
  onFermer,
}: {
  ouvert: boolean;
  /** Nombre d'éditions déjà faites : sert à prévenir de ce qui va être perdu. */
  travauxEnCours: number;
  onChoisir: (t: Template) => void;
  onFermer: () => void;
}): JSX.Element | null {
  if (!ouvert) return null;

  return (
    <Modale titre="Partir d’un gabarit" onFermer={onFermer}>
      {travauxEnCours > 0 ? (
        <p className="avertissement">
          {travauxEnCours} modification(s) en cours seront perdues, ainsi que l’historique
          d’annulation. Enregistrez d’abord si vous souhaitez les conserver.
        </p>
      ) : null}

      <ul className="gabarits">
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => onChoisir(t)}>
              <strong>{t.nom}</strong>
              <em>{t.resume}</em>
              <span>{t.description}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="note">
        Les profils de chaque gabarit sont dimensionnés pour les charges annoncées : leur taux
        de travail reste inférieur à 1,00 au calcul de pré-dimensionnement.
      </p>
    </Modale>
  );
}
