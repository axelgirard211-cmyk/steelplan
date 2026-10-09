import { useState } from 'react';
import { AVERTISSEMENT, RATIO_LABELS, type CheckLine } from '../../core/checks/types';
import { ratioColor } from '../../render3d/colorMaps';
import { AssemblagesVerif } from './AssemblagesVerif';
import { DimensionnementFiche } from './DimensionnementFiche';
import { useChecksReport } from '../../state/derived';
import { useProjectStore } from '../../state/store';
import { num } from '../format';

/**
 * VÉRIFICATIONS EUROCODE 3.
 *
 * ⚠ L'avertissement de pré-dimensionnement est affiché en tête, en permanence, et
 * non replié dans un panneau annexe. Les hypothèses le suivent immédiatement : un
 * taux de travail lu sans elles n'est pas une information, c'est un chiffre.
 */
export function VerificationsPanel(): JSX.Element {
  const rapport = useChecksReport();
  const loads = useProjectStore((s) => s.project.loads);
  const edit = useProjectStore((s) => s.edit);
  const [detail, setDetail] = useState<string | null>(null);

  const conforme = rapport.nonVerifies === 0;

  return (
    <section className="panneau large">
      <p className="avertissement fort">{AVERTISSEMENT}</p>

      <div className="grille-fiches">
        <div className="fiche">
          <h3>Charges</h3>
          <dl className="paires">
            <ChampCharge
              label="Permanent couverture"
              unite="kN/m²"
              value={loads.loads.permanent}
              onChange={(v) => edit('Charge permanente', (d) => void (d.loads.loads.permanent = v))}
            />
            <dt>Poids propre de l’ossature</dt>
            <dd>
              <label className="etiquette">
                <input
                  type="checkbox"
                  checked={loads.loads.includeSelfWeight}
                  onChange={(e) =>
                    edit(
                      'Poids propre',
                      (d) => void (d.loads.loads.includeSelfWeight = e.target.checked),
                    )
                  }
                />{' '}
                calculé et ajouté
              </label>
            </dd>
            <ChampCharge
              label="Exploitation (entretien)"
              unite="kN/m²"
              value={loads.loads.exploitation}
              onChange={(v) => edit('Exploitation', (d) => void (d.loads.loads.exploitation = v))}
            />
            <ChampCharge
              label="Neige (projection horizontale)"
              unite="kN/m²"
              value={loads.loads.neige}
              onChange={(v) => edit('Neige', (d) => void (d.loads.loads.neige = v))}
            />
            <ChampCharge
              label="Neige accidentelle"
              unite="kN/m²"
              value={loads.loads.neigeAccidentelle}
              onChange={(v) => edit('Neige accidentelle', (d) => void (d.loads.loads.neigeAccidentelle = v))}
            />
            <ChampCharge
              label="Vent — pression façade"
              unite="kN/m²"
              value={loads.loads.ventPression}
              onChange={(v) => edit('Pression de vent', (d) => void (d.loads.loads.ventPression = v))}
            />
            <ChampCharge
              label="Vent — dépression toiture"
              unite="kN/m²"
              value={loads.loads.ventDepression}
              onChange={(v) => edit('Dépression de vent', (d) => void (d.loads.loads.ventDepression = v))}
            />
          </dl>
        </div>

        <div className="fiche">
          <h3>Limites de flèche</h3>
          <dl className="paires">
            <ChampCharge
              label="Traverses  L/"
              unite=""
              value={loads.deflection.rafter}
              pas={10}
              onChange={(v) => edit('Flèche traverses', (d) => void (d.loads.deflection.rafter = v))}
            />
            <ChampCharge
              label="Pannes  L/"
              unite=""
              value={loads.deflection.purlin}
              pas={10}
              onChange={(v) => edit('Flèche pannes', (d) => void (d.loads.deflection.purlin = v))}
            />
            <ChampCharge
              label="Lisses  L/"
              unite=""
              value={loads.deflection.rail}
              pas={10}
              onChange={(v) => edit('Flèche lisses', (d) => void (d.loads.deflection.rail = v))}
            />
            <ChampCharge
              label="Tête de poteau  H/"
              unite=""
              value={loads.deflection.columnDrift}
              pas={10}
              onChange={(v) => edit('Déplacement en tête', (d) => void (d.loads.deflection.columnDrift = v))}
            />
          </dl>
        </div>

        <div className="fiche">
          <h3>Coefficients</h3>
          <dl className="paires">
            <ChampCharge
              label="γG"
              unite=""
              pas={0.05}
              value={loads.factors.gammaG}
              onChange={(v) => edit('γG', (d) => void (d.loads.factors.gammaG = v))}
            />
            <ChampCharge
              label="γQ"
              unite=""
              pas={0.05}
              value={loads.factors.gammaQ}
              onChange={(v) => edit('γQ', (d) => void (d.loads.factors.gammaQ = v))}
            />
            <ChampCharge
              label="ψ0 neige"
              unite=""
              pas={0.05}
              value={loads.factors.psi0Neige}
              onChange={(v) => edit('ψ0 neige', (d) => void (d.loads.factors.psi0Neige = v))}
            />
            <ChampCharge
              label="ψ0 vent"
              unite=""
              pas={0.05}
              value={loads.factors.psi0Vent}
              onChange={(v) => edit('ψ0 vent', (d) => void (d.loads.factors.psi0Vent = v))}
            />
            <ChampCharge
              label="ψ0 exploitation"
              unite=""
              pas={0.05}
              value={loads.factors.psi0Exploitation}
            onChange={(v) =>
                edit('ψ0 exploitation', (d) => void (d.loads.factors.psi0Exploitation = v))
              }
            />
          </dl>
        </div>

        <div className="fiche">
          <h3>Synthèse</h3>
          <dl className="paires">
            <dt>Taux de travail maximal</dt>
            <dd className={conforme ? '' : 'alerte'}>{num(rapport.maxRatio, 2)}</dd>
            <dt>Repères dépassant 1,00</dt>
            <dd className={conforme ? '' : 'alerte'}>{rapport.nonVerifies}</dd>
            <dt>Repères vérifiés</dt>
            <dd>{rapport.lines.length}</dd>
            <dt>Non vérifiés</dt>
            <dd>
              {/*
                * ⚠ Le compteur RENVOIE à la liste qui l'explique. Affiché seul en
                * tête de page, « 3 non vérifiés » inquiétait sans rien dire ; la
                * raison de chaque exclusion n'apparaissait qu'en bas, après tout
                * le tableau des repères, là où personne ne la cherchait.
                */}
              {rapport.nonVerifiables.length > 0 ? (
                <a href="#pieces-non-verifiees" title="Voir pourquoi">
                  {rapport.nonVerifiables.length}
                </a>
              ) : (
                0
              )}
            </dd>
            <dt>Combinaisons examinées</dt>
            <dd>{rapport.combinations.length}</dd>
            <dt>Durée du calcul</dt>
            <dd>{num(rapport.ms, 0)} ms</dd>
          </dl>
        </div>
      </div>

      <DimensionnementFiche />

      <AssemblagesVerif />

      <h3>Vérification par repère</h3>
      <div className="tableau-defilant">
        <table className="nomenclature">
          <thead>
            <tr>
              <th>Rep.</th>
              <th>Profil</th>
              <th>Nuance</th>
              <th>Cl.</th>
              <th className="nombre">N (kN)</th>
              <th className="nombre">My (kN·m)</th>
              <th className="nombre">V (kN)</th>
              <th className="nombre">Section</th>
              <th className="nombre">Cis.</th>
              <th className="nombre">Flamb.</th>
              <th className="nombre">Stab. N+M</th>
              <th className="nombre">Flèche</th>
              <th className="nombre">Élanc.</th>
              <th className="nombre">Taux</th>
              <th>Gouverné par</th>
            </tr>
          </thead>
          <tbody>
            {rapport.lines.map((l) => (
              <Ligne
                key={l.mark}
                l={l}
                ouvert={detail === l.mark}
                onToggle={() => setDetail(detail === l.mark ? null : l.mark)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {rapport.nonVerifiables.length > 0 ? (
        <>
          <h3 id="pieces-non-verifiees">Pièces non vérifiées</h3>
          <ul className="liste-hypotheses">
            {rapport.nonVerifiables.map((x) => (
              <li key={x.mark}>
                <strong>{x.mark}</strong> — {x.raison}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3>Combinaisons examinées</h3>
      <ul className="liste-hypotheses">
        {rapport.combinations.map((c) => (
          <li key={c.id}>
            <strong>{c.id}</strong> — {c.label}
            {c.windDirection < 0 ? ' (vent en sens inverse)' : ''}
          </li>
        ))}
      </ul>

      <h3>Hypothèses de calcul</h3>
      <ul className="liste-hypotheses">
        {rapport.hypotheses.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Ligne({
  l,
  ouvert,
  onToggle,
}: {
  l: CheckLine;
  ouvert: boolean;
  onToggle: () => void;
}): JSX.Element {
  const pastille = `#${ratioColor(l.ratio).toString(16).padStart(6, '0')}`;
  return (
    <>
      <tr onClick={onToggle} className={l.ratio > 1 ? 'depasse' : ''} style={{ cursor: 'pointer' }}>
        <td>
          {l.mark}
          {/*
            * ⚠ Les avertissements ne se lisent qu'en ouvrant la ligne. Sans ce
            * repère, rien ne disait qu'une ligne en portait : la mention « flexion
            * latérale de la semelle libre non calculée » restait cachée derrière
            * un clic que personne n'avait de raison de faire.
            */}
          {l.avertissements.length > 0 ? (
            <span
              className="marque-avertissement"
              title={`${l.avertissements.length} avertissement(s) — cliquer la ligne pour les lire`}
              aria-label={`${l.avertissements.length} avertissement(s)`}
            >
              {' '}⚠
            </span>
          ) : null}
        </td>
        <td>{l.profileId}</td>
        <td>{l.grade}</td>
        <td className="nombre">{l.cls}</td>
        <td className="nombre">{num(l.nEd, 0)}</td>
        <td className="nombre">{num(l.myEd, 1)}</td>
        <td className="nombre">{num(l.vEd, 0)}</td>
        <Taux v={l.ratios.section} />
        <Taux v={l.ratios.cisaillement} />
        <Taux v={l.ratios.flambement} />
        <Taux v={l.ratios.stabilite} />
        <Taux v={l.ratios.fleche} />
        <Taux v={l.ratios.elancement} />
        <td className="nombre">
          <span className="pastille" style={{ background: pastille }} />{' '}
          <strong>{num(l.ratio, 2)}</strong>
        </td>
        <td>{RATIO_LABELS[l.gouverne]}</td>
      </tr>
      {ouvert ? (
        <tr className="detail">
          <td colSpan={14}>
            <div className="detail-verif">
              <span>Combinaison : {l.combinaison}</span>
              <span>
                Longueurs de flambement : dans le plan {num(l.lcrY, 0)} mm, hors plan{' '}
                {num(l.lcrZ, 0)} mm
              </span>
              {l.fleche ? (
                <span>
                  Flèche : {num(l.fleche.valeur, 1)} mm pour {num(l.fleche.limite, 1)} mm admis
                </span>
              ) : null}
              {l.avertissements.map((a) => (
                <span key={a} className="alerte">
                  ⚠ {a}
                </span>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Un taux, grisé quand la vérification ne s'applique pas. */
function Taux({ v }: { v: number }): JSX.Element {
  if (v <= 0) return <td className="nombre sansobjet">—</td>;
  return (
    <td className="nombre" style={v > 1 ? { color: '#b3241f', fontWeight: 600 } : undefined}>
      {num(v, 2)}
    </td>
  );
}

/**
 * Une ligne de saisie, dans la même présentation que les autres panneaux :
 * une paire dt/dd d'une liste de définitions. Réinventer une mise en page pour
 * ce panneau seul le ferait détonner du reste de l'application.
 */
function ChampCharge({
  label,
  unite,
  value,
  onChange,
  pas = 0.05,
}: {
  label: string;
  unite: string;
  value: number;
  onChange: (v: number) => void;
  pas?: number;
}): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <input
          type="number"
          step={pas}
          min={0}
          value={value}
          style={{ width: 82, textAlign: 'right' }}
          // La molette au-dessus d'un champ focalisé modifierait la valeur sans
          // que l'utilisateur l'ait demandé : on relâche le focus.
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0) onChange(v);
          }}
        />
        {unite ? <span className="unite"> {unite}</span> : null}
      </dd>
    </>
  );
}
