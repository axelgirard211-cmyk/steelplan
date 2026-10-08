import {
  BANDES_TAUX,
  COULEUR_NON_VERIFIE,
  ROLE_COLORS,
  ROLE_LABELS,
} from '../../render3d/colorMaps';
import { AVERTISSEMENT } from '../../core/checks/types';
import { useChecksReport, useStructuralModel } from '../../state/derived';
import { num } from '../format';

/**
 * LÉGENDES DE LA VUE 3D.
 *
 * Séparées du panneau pour le garder sous la limite de 500 lignes du projet : le
 * panneau pilote la scène et les interactions, ces composants ne font que rendre
 * compte de ce qu'affiche le code couleur en cours.
 */

/**
 * Légende du code couleur par taux de travail.
 *
 * ⚠ Le gris « non vérifié » est distingué explicitement, et l'avertissement de
 * pré-dimensionnement accompagne la légende : un modèle coloré en vert invite à
 * conclure, et cette conclusion ne serait pas fondée sans savoir ce qui a été
 * vérifié et sous quelles hypothèses.
 */
export function LegendeTaux(): JSX.Element {
  const rapport = useChecksReport();
  const compte = (min: number, max: number): number =>
    rapport.lines.filter((l) => l.ratio > min && l.ratio <= max).length;

  return (
    <div className="fiche" style={{ marginTop: 12 }}>
      <h3>Taux de travail</h3>
      <table className="legende">
        <tbody>
          {BANDES_TAUX.map((b, i) => (
            <tr key={b.label}>
              <td>
                <span
                  className="pastille"
                  style={{ background: `#${b.couleur.toString(16).padStart(6, '0')}` }}
                />
              </td>
              <td className="nom">{b.label}</td>
              <td className="nombre">{compte(i === 0 ? -1 : (BANDES_TAUX[i - 1]?.max ?? 0), b.max)}</td>
            </tr>
          ))}
          {rapport.nonVerifiables.length > 0 ? (
            <tr>
              <td>
                <span
                  className="pastille"
                  style={{ background: `#${COULEUR_NON_VERIFIE.toString(16).padStart(6, '0')}` }}
                />
              </td>
              <td className="nom">non vérifié par SteelPlan</td>
              <td className="nombre">{rapport.nonVerifiables.length}</td>
            </tr>
          ) : null}
          <tr className="total">
            <td />
            <td className="nom">Taux maximal</td>
            <td className="nombre">{rapport.maxRatio.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      <p className="avertissement">{AVERTISSEMENT}</p>
    </div>
  );
}

/** Légende par type d'élément : couleur, nombre de pièces et masse. */
export function Legende(): JSX.Element {
  const model = useStructuralModel();
  const lignes = Object.entries(model.stats.byRole)
    .filter(([, v]) => v && v.count > 0)
    .sort((a, b) => (b[1]?.massKg ?? 0) - (a[1]?.massKg ?? 0));

  return (
    <div className="fiche" style={{ marginTop: 12 }}>
      <h3>Composition</h3>
      <table className="legende">
        <tbody>
          {lignes.map(([role, stat]) => (
            <tr key={role}>
              <td>
                <span
                  className="pastille"
                  style={{ background: `#${ROLE_COLORS[role as keyof typeof ROLE_COLORS].toString(16).padStart(6, '0')}` }}
                />
              </td>
              <td className="nom">{ROLE_LABELS[role as keyof typeof ROLE_LABELS]}</td>
              <td className="nombre">{stat?.count}</td>
              <td className="nombre">{num(stat?.massKg ?? 0, 0)} kg</td>
            </tr>
          ))}
          <tr className="total">
            <td />
            <td className="nom">Total</td>
            <td className="nombre">{model.stats.memberCount + model.stats.haunchCount}</td>
            <td className="nombre">{num(model.stats.massKg, 0)} kg</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
