import { Modale } from './Modale';
import { libelleTouche, parGroupe } from './raccourcis';

/**
 * AIDE DES RACCOURCIS.
 *
 * Construite depuis la liste `RACCOURCIS` elle-même : ce qui est affiché est
 * exactement ce qui est capté. Une aide recopiée à la main annonce, tôt ou tard,
 * un raccourci qui n'existe plus.
 */
export function AideRaccourcis({
  ouvert,
  onFermer,
}: {
  ouvert: boolean;
  onFermer: () => void;
}): JSX.Element | null {
  if (!ouvert) return null;

  return (
    <Modale titre="Raccourcis clavier" onFermer={onFermer} etroit>
      {parGroupe().map(([groupe, liste]) => (
        <section key={groupe}>
          <h3>{groupe}</h3>
          {/* Liste propre à l'aide : `dl.paires` aligne ses valeurs à droite
              et sur deux colonnes, ce qui mêlerait les touches aux libellés. */}
          <dl className="liste-raccourcis">
            {liste.map((r) => (
              <div key={r.id}>
                <dt>
                  <kbd>{libelleTouche(r)}</kbd>
                </dt>
                <dd>{r.libelle}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <p className="note">
        Les raccourcis à une seule touche sont sans effet pendant la saisie dans un champ :
        taper « 3 » dans une cote ne change pas d’onglet.
      </p>
    </Modale>
  );
}
