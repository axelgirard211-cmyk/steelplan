import { useNavigation, type Onglet } from '../../state/navigation';
import { num } from '../format';
import { useEtatDuProjet } from '../useEtatDuProjet';

/**
 * LE PARCOURS — de la trame au chiffrage, en quatre étapes.
 *
 * Un projeteur qui découvre le logiciel ne sait pas par où passer ; celui qui
 * le connaît veut savoir où en est son projet. Les deux réponses tiennent sur
 * une ligne : chaque étape dit son état et mène à l'onglet où la poursuivre.
 */
export function Parcours(): JSX.Element {
  const etat = useEtatDuProjet();
  const setOnglet = useNavigation((s) => s.setOnglet);

  const etapes: readonly { titre: string; detail: string; onglet: Onglet; etat: 'ok' | 'ko' | 'neutre' }[] = [
    {
      titre: 'Décrire le bâtiment',
      detail: !etat ? '…' : etat.erreurs > 0 ? `${etat.erreurs} erreur(s) de saisie` : 'saisie valide',
      onglet: 'projet',
      etat: !etat ? 'neutre' : etat.erreurs > 0 ? 'ko' : 'ok',
    },
    {
      titre: 'Vérifier',
      detail: !etat
        ? '…'
        : etat.horsDomaine
          ? 'hors domaine (αcr < 3)'
          : etat.enDefaut > 0
            ? `${etat.enDefaut} à reprendre`
            : `taux maximal ${num(etat.tauxMax, 2)}`,
      onglet: 'verifications',
      etat: !etat ? 'neutre' : etat.horsDomaine || etat.enDefaut > 0 ? 'ko' : 'ok',
    },
    { titre: 'Sortir les plans', detail: 'dossier par poste, PDF, DXF', onglet: 'plans', etat: 'neutre' },
    {
      titre: 'Fabriquer et chiffrer',
      detail: !etat ? '…' : `${num(etat.masseKg / 1000, 1)} t · ${num(etat.prixHT, 0)} € HT`,
      onglet: 'nomenclatures',
      etat: 'neutre',
    },
  ];

  return (
    <ol className="parcours" aria-label="Étapes du projet">
      {etapes.map((e, i) => (
        <li key={e.titre} className={e.etat}>
          <button type="button" onClick={() => setOnglet(e.onglet)}>
            <span className="numero">{e.etat === 'ok' ? '✓' : i + 1}</span>
            <span className="texte">
              <span className="titre">{e.titre}</span>
              <span className="detail">{e.detail}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
