import { useState } from 'react';
import type { AssemblageCheck } from '../../core/checks/assemblages/index';
import { ratioColor } from '../../render3d/colorMaps';
import { useChecksReport } from '../../state/derived';
import { num } from '../format';

/** La couleur du code 3D, en notation CSS : un seul barème pour les deux vues. */
const teinte = (ratio: number): string =>
  `#${ratioColor(ratio).toString(16).padStart(6, '0')}`;

/**
 * VÉRIFICATION DES ASSEMBLAGES, à l'écran.
 *
 * ⚠ Chaque assemblage affiche TOUS ses taux, pas seulement le plus grand, et la
 * liste de ce que le calcul ne couvre pas. Le maximum seul dirait « 0,93 » sans
 * dire s'il faut épaissir la platine, grossir les boulons ou allonger les
 * cordons — c'est-à-dire sans rien dire d'utile.
 */
export function AssemblagesVerif(): JSX.Element | null {
  const rapport = useChecksReport();
  const [ouvert, setOuvert] = useState<string | null>(null);

  if (rapport.assemblages.length === 0) return null;

  return (
    <>
      <h3>Vérification des assemblages</h3>
      <p style={{ margin: '0 0 10px', opacity: 0.8 }}>
        Boulons, tôles, tronçons en T et cordons — EN 1993-1-8. Les efforts sont lus AUX NŒUDS
        d’assemblage, et non au point le plus sollicité des barres qu’ils tiennent.
      </p>

      <div className="tableau-defilant">
        <table className="nomenclature">
          <thead>
            <tr>
              <th>Assemblage</th>
              <th>Boulonnerie</th>
              <th>Sollicitations</th>
              <th>Combinaison</th>
              <th className="nombre">Taux</th>
              <th>Gouverné par</th>
            </tr>
          </thead>
          <tbody>
            {rapport.assemblages.map((a) => (
              <Ligne
                key={a.id}
                a={a}
                ouvert={ouvert === a.id}
                onToggle={() => setOuvert(ouvert === a.id ? null : a.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Ligne({
  a,
  ouvert,
  onToggle,
}: {
  a: AssemblageCheck;
  ouvert: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td>{a.libelle}</td>
        <td>{a.boulon}</td>
        <td>{a.sollicitations}</td>
        <td>{a.combinaison}</td>
        <td className="nombre" style={{ color: teinte(a.ratio), fontWeight: 600 }}>
          {a.ratio.toFixed(2)}
        </td>
        <td>{a.gouverne}</td>
      </tr>
      {ouvert && (
        <tr>
          <td colSpan={6} style={{ background: 'rgba(127,127,127,0.08)' }}>
            <table className="nomenclature" style={{ margin: '6px 0' }}>
              <tbody>
                {a.verifs.map((v) => (
                  <tr key={v.nom}>
                    <td style={{ width: '40%' }}>{v.nom}</td>
                    <td className="nombre">
                      {num(v.ed, 1)} / {num(v.rd, 1)} {v.unite}
                    </td>
                    <td className="nombre" style={{ color: teinte(v.ratio), width: 70 }}>
                      {v.ratio.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/*
              ⚠ Affiché AVEC le résultat, jamais renvoyé à une documentation. Un
              assemblage annoncé vérifié alors qu'un mode entier n'a pas été
              regardé est plus dangereux qu'un assemblage non vérifié : dans le
              second cas, on sait qu'il reste à faire.
            */}
            <ul className="anomalies" style={{ marginTop: 4 }}>
              {a.nonCouvert.map((n) => (
                <li key={n} className="avertissement">
                  Non couvert : {n}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
