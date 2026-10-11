import { chargesClimatiques } from '../../core/climat/index';
import { useProjectStore } from '../../state/store';
import { Bascule, ChampNombre } from '../champs';
import { num } from '../format';

/**
 * CHARGES, LIMITES DE FLÈCHE ET COEFFICIENTS.
 *
 * ⚠ Les charges pilotaient déjà le calcul mais la moitié des champs — poids
 * propre, neige accidentelle, limites de flèche des lisses, déplacement en tête —
 * n'étaient réglables nulle part. Or ce sont eux qui décident du profil : une
 * limite L/200 au lieu de L/250 change une traverse de deux tailles.
 */
export function ChargesFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const l = project.loads.loads;
  const f = project.loads.deflection;
  const k = project.loads.factors;
  // ⚠ Site en Eurocode : neige et vent viennent de lui. Laisser les champs
  // saisissables faisait croire qu'on les réglait — le calcul les ignorait.
  const climat = project.site.mode === 'eurocode' ? chargesClimatiques(project).valeurs : null;

  const charge = (
    libelle: string,
    valeur: number,
    cle: 'permanent' | 'exploitation' | 'neige' | 'neigeAccidentelle' | 'ventPression' | 'ventDepression',
  ): JSX.Element => (
    <>
      <dt>{libelle}</dt>
      {climat && (cle === 'neige' || cle === 'neigeAccidentelle' || cle === 'ventPression' || cle === 'ventDepression') ? (
        <dd className="derive" title="Déduite de la région, de l’altitude et du terrain : elle se règle dans « Site et charges climatiques ».">
          {num(climat[cle], 2)} kN/m² — du site
        </dd>
      ) : (
        <dd>
          <ChampNombre
            valeur={valeur}
            pas={0.05}
            min={0}
            unite="kN/m²"
            onChange={(v) => edit(libelle, (d) => void (d.loads.loads[cle] = v))}
          />
        </dd>
      )}
    </>
  );

  const fleche = (
    libelle: string,
    valeur: number,
    cle: 'rafter' | 'purlin' | 'rail' | 'columnDrift',
  ): JSX.Element => (
    <>
      <dt>{libelle}</dt>
      <dd>
        {cle === 'columnDrift' ? 'H/' : 'L/'}
        <ChampNombre
          valeur={valeur}
          pas={10}
          min={50}
          largeur={70}
          onChange={(v) =>
            edit(libelle, (d) => void (d.loads.deflection[cle] = Math.round(v)))
          }
        />
      </dd>
    </>
  );

  return (
    <div className="fiche">
      <h3>Charges et critères</h3>
      <dl className="paires">
        {charge('Permanentes (couverture)', l.permanent, 'permanent')}
        <dt>Poids propre de l’acier</dt>
        <dd>
          <Bascule
            valeur={l.includeSelfWeight}
            onChange={(v) => edit('Poids propre', (d) => void (d.loads.loads.includeSelfWeight = v))}
          />
          {/*
            Le poids propre n'est pas une charge saisie : il est déduit des
            profils choisis. La case ne fait que dire s'il entre ou non dans les
            combinaisons — le décocher sert à recouper un calcul à la main.
          */}
          <span className="derive"> déduit des profils</span>
        </dd>
        {charge('Exploitation', l.exploitation, 'exploitation')}
        {charge('Neige', l.neige, 'neige')}
        {charge('Neige accidentelle', l.neigeAccidentelle, 'neigeAccidentelle')}
        {charge('Vent — pression', l.ventPression, 'ventPression')}
        {charge('Vent — dépression', l.ventDepression, 'ventDepression')}

        <dt>
          <strong>Limites de flèche</strong>
        </dt>
        <dd />
        {fleche('Traverses', f.rafter, 'rafter')}
        {fleche('Pannes', f.purlin, 'purlin')}
        {fleche('Lisses', f.rail, 'rail')}
        {fleche('Déplacement en tête', f.columnDrift, 'columnDrift')}

        <dt>
          <strong>Coefficients de combinaison</strong>
        </dt>
        <dd />
        <dt>γG / γQ</dt>
        <dd>
          <ChampNombre
            valeur={k.gammaG}
            pas={0.05}
            min={1}
            largeur={64}
            onChange={(v) => edit('γG', (d) => void (d.loads.factors.gammaG = v))}
          />
          {' / '}
          <ChampNombre
            valeur={k.gammaQ}
            pas={0.05}
            min={1}
            largeur={64}
            onChange={(v) => edit('γQ', (d) => void (d.loads.factors.gammaQ = v))}
          />
        </dd>
        <dt>ψ0 neige / vent / exploitation</dt>
        <dd>
          <ChampNombre
            valeur={k.psi0Neige}
            pas={0.05}
            min={0}
            largeur={58}
            onChange={(v) => edit('ψ0 neige', (d) => void (d.loads.factors.psi0Neige = v))}
          />
          {' / '}
          <ChampNombre
            valeur={k.psi0Vent}
            pas={0.05}
            min={0}
            largeur={58}
            onChange={(v) => edit('ψ0 vent', (d) => void (d.loads.factors.psi0Vent = v))}
          />
          {' / '}
          <ChampNombre
            valeur={k.psi0Exploitation}
            pas={0.05}
            min={0}
            largeur={58}
            onChange={(v) =>
              edit('ψ0 exploitation', (d) => void (d.loads.factors.psi0Exploitation = v))
            }
          />
        </dd>
      </dl>
    </div>
  );
}
