import { planchesDuPoste, POSTES, sheetsBordereau } from '../../core/drawing/postes';
import { useProjetEffectif } from '../../state/derived';
import { useNavigation } from '../../state/navigation';
import { useDossier } from '../useDossier';

/**
 * QUEL DOSSIER SORTIR ? — le premier écran de l'onglet Plans.
 *
 * ⚠ Une centaine de planches dans une liste, et un menu « Dossier du poste »
 * en tête, qu'on ne remarquait pas : on cherchait la planche du perçage parmi
 * celles du montage. La vraie question vient d'abord — à qui s'adresse le
 * dossier ? Chaque poste reçoit ses planches, son bordereau, ses fichiers
 * machine, et rien d'autre.
 */
export function ChoixDuPoste(): JSX.Element {
  const { dossier } = useDossier();
  const meta = useProjetEffectif().meta;
  const choisir = useNavigation((s) => s.choisirPoste);

  return (
    <section className="principal choix-poste">
      <h2>Quel dossier sortir ?</h2>
      <p className="note">
        Chaque poste reçoit ses planches — et rien d’autre — avec son bordereau d’envoi. Le dossier complet sert au
        bureau d’études et à l’archivage.
      </p>
      <div className="grille-postes">
        <button type="button" className="carte-poste complet" onClick={() => choisir('tous')}>
          <span className="titre">Dossier complet</span>
          <span className="objet">Toutes les planches, dans l’ordre du dossier</span>
          <span className="compte">{dossier.length} planches</span>
        </button>
        {POSTES.map((p) => {
          // Le bordereau d'envoi compris : c'est le nombre de feuilles qui partent au poste.
          const n = planchesDuPoste(dossier, p.id).length + sheetsBordereau(p.id, dossier, meta).length;
          return (
            <button key={p.id} type="button" className="carte-poste" onClick={() => choisir(p.id)} disabled={n === 0}>
              <span className="titre">{p.libelle}</span>
              <span className="objet">{p.objet}</span>
              <span className="compte">
                {n} planche{n > 1 ? 's' : ''}
                {p.fichiers ? ' + fichiers machine' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
