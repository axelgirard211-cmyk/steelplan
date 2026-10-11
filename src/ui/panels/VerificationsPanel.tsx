import { useState } from 'react';
import { AVERTISSEMENT, RATIO_LABELS, type CheckLine } from '../../core/checks/types';
import { ratioColor } from '../../render3d/colorMaps';
import { AssemblagesVerif } from './AssemblagesVerif';
import { DimensionnementFiche } from './DimensionnementFiche';
import { useChecksReport } from '../../state/derived';
import { useProjectStore } from '../../state/store';
import { useNavigation } from '../../state/navigation';
import { chargesClimatiques } from '../../core/climat/index';
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
  const project = useProjectStore((s) => s.project);
  const allerA = useNavigation((s) => s.allerA);
  // Site en Eurocode : neige et vent viennent de lui, les champs saisis sont ignorés.
  const climat = project.site.mode === 'eurocode' ? chargesClimatiques(project).valeurs : null;
  const [detail, setDetail] = useState<string | null>(null);

  const conforme = rapport.nonVerifies === 0;
  const tauxAssemblages = Math.max(0, ...rapport.assemblages.map((a) => a.ratio));
  const assemblagesKo = rapport.assemblages.filter((a) => a.ratio > 1).length;
  const aReprendre = rapport.nonVerifies + assemblagesKo;
  const l = project.loads.loads;
  const f = project.loads.deflection;

  return (
    <section className="panneau large">
      {/*
        * ⚠ Le VERDICT d'abord. La page s'ouvrait sur des champs de charges — les
        * mêmes que ceux du projet — et la réponse à la seule question qu'on vient
        * poser ici, « ça tient ? », attendait trois fiches plus bas.
        */}
      <div className={`verdict ${aReprendre === 0 ? 'ok' : 'ko'}`} role="status">
        <div>
          <div className="verdict-titre">
            {aReprendre === 0 ? 'Bâtiment vérifié' : `${aReprendre} élément${aReprendre > 1 ? 's' : ''} à reprendre`}
          </div>
          <div className="verdict-detail">
            Barres : taux maximal {num(rapport.maxRatio, 2)}
            {rapport.nonVerifies > 0 ? ` — ${rapport.nonVerifies} au-delà de 1,00` : ''} · Assemblages :{' '}
            {num(tauxAssemblages, 2)}
            {assemblagesKo > 0 ? ` — ${assemblagesKo} au-delà de 1,00` : ''} · {rapport.combinations.length} combinaisons
          </div>
        </div>
        {aReprendre > 0 && (
          <button type="button" className="primaire" onClick={() => document.getElementById('dimensionnement')?.scrollIntoView({ behavior: 'smooth' })}>
            Dimensionner automatiquement
          </button>
        )}
      </div>
      <p className="avertissement fort">{AVERTISSEMENT}</p>

      <div className="grille-fiches">
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

        {/*
          * Les hypothèses en RÉSUMÉ : elles se règlent dans le projet, une seule
          * fois. Deux jeux de champs pour les mêmes charges, c'était deux endroits
          * où se demander lequel comptait.
          */}
        <div className="fiche">
          <h3>Hypothèses</h3>
          <dl className="paires">
            <dt>Permanent couverture</dt>
            <dd>{num(l.permanent, 2)} kN/m²</dd>
            <dt>Exploitation</dt>
            <dd>{num(l.exploitation, 2)} kN/m²</dd>
            <dt>Neige</dt>
            <dd className={climat ? 'derive' : ''}>{num(climat?.neige ?? l.neige, 2)} kN/m²{climat ? ' — du site' : ''}</dd>
            <dt>Vent</dt>
            <dd className={climat ? 'derive' : ''}>{climat ? 'par zones — du site' : `${num(l.ventPression, 2)} / ${num(l.ventDepression, 2)} kN/m²`}</dd>
            <dt>Flèches</dt>
            <dd>
              L/{f.rafter} · H/{f.columnDrift}
            </dd>
            <dt>Coefficients</dt>
            <dd>
              γG {num(project.loads.factors.gammaG, 2)} · γQ {num(project.loads.factors.gammaQ, 2)}
            </dd>
          </dl>
          <div className="barre-outils" style={{ marginTop: 10, marginBottom: 0 }}>
            <button type="button" className="plat" onClick={() => allerA('Charges et critères')}>
              Modifier les charges
            </button>
            <button type="button" className="plat" onClick={() => allerA('Site et charges climatiques')}>
              Site
            </button>
          </div>
        </div>
      </div>

      <div id="dimensionnement">
        <DimensionnementFiche />
      </div>

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
              <th className="nombre">Mz (kN·m)</th>
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
            {c.windDirection < 0 && !c.vent ? ' (vent en sens inverse)' : ''}
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
        <td className="nombre">{num(l.mzEd, 2)}</td>
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
          <td colSpan={16}>
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
