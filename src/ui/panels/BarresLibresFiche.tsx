import { useState } from 'react';
import type { SteelGradeId } from '../../core/catalog/types';
import {
  decalageParDefaut,
  dupliquerEnSerie,
  longueurLibre,
  nouvelleBarre,
} from '../../core/model/freeMembers';
import type { FreeMember } from '../../core/model/project';
import { useProjectStore } from '../../state/store';
import { ChampProfil, ChampTexte } from '../champs';
import { num } from '../format';

/**
 * BARRES LIBRES.
 *
 * Le seul endroit du modèle où l'utilisateur crée des pièces une par une :
 * bracons, potences, poutres de reprise — tout ce que la génération
 * paramétrique ne couvre pas. Elles entrent dans la 3D, les plans de débit, la
 * nomenclature et le poids total comme n'importe quelle autre barre.
 *
 * ⚠ Elles ne sont PAS vérifiées au calcul : leur rôle statique est inconnu du
 * logiciel. Le rapport les liste nommément parmi les pièces non vérifiées.
 */
export function BarresLibresFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const barres = project.freeMembers;
  const [copies, setCopies] = useState(1);

  const ajouter = (): void => {
    edit('Ajouter une barre libre', (d) => {
      d.freeMembers.push(nouvelleBarre(project));
    });
  };

  const dupliquer = (m: FreeMember): void => {
    const dec = decalageParDefaut(project);
    edit(`Dupliquer ${m.id}`, (d) => {
      for (const c of dupliquerEnSerie(m, dec, copies, d.freeMembers)) d.freeMembers.push(c);
    });
  };

  const supprimer = (id: string): void => {
    edit(`Supprimer ${id}`, (d) => {
      const i = d.freeMembers.findIndex((x) => x.id === id);
      if (i >= 0) d.freeMembers.splice(i, 1);
    });
  };

  const majSommet = (
    id: string,
    bout: 'start' | 'end',
    axe: 'x' | 'y' | 'z',
    mmSaisis: number,
  ): void => {
    edit(`${id} — ${bout === 'start' ? 'origine' : 'extrémité'} ${axe.toUpperCase()}`, (d) => {
      const m = d.freeMembers.find((x) => x.id === id);
      if (m) m[bout][axe] = mmSaisis;
    });
  };

  const dec = decalageParDefaut(project);

  return (
    <div className="fiche" style={{ marginTop: 14 }}>
      <h3>Barres libres</h3>

      {barres.length === 0 ? (
        <p className="note">
          Aucune barre libre. Elles servent à ce que la génération paramétrique ne couvre pas —
          bracons, potences, poutres de reprise. Elles entrent dans les plans de débit et la
          nomenclature, mais ne sont pas vérifiées au calcul.
        </p>
      ) : (
        <div className="tableau-defilant">
          <table className="nomenclature">
            <thead>
              <tr>
                <th>Rep.</th>
                <th>Profil</th>
                <th>Nuance</th>
                <th colSpan={3}>Origine X / Y / Z (mm)</th>
                <th colSpan={3}>Extrémité X / Y / Z (mm)</th>
                <th className="nombre">Rot. (°)</th>
                <th className="nombre">Long. (mm)</th>
                <th>Repérage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {barres.map((m) => (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td>
                    <ChampProfil
                      valeur={m.profile}
                      onChange={(v) =>
                        edit(`${m.id} — profil`, (d) => {
                          const b = d.freeMembers.find((x) => x.id === m.id);
                          if (b) b.profile = v;
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={m.grade}
                      onChange={(e) =>
                        edit(`${m.id} — nuance`, (d) => {
                          const b = d.freeMembers.find((x) => x.id === m.id);
                          if (b) b.grade = e.target.value as SteelGradeId;
                        })
                      }
                    >
                      {(['S235', 'S275', 'S355'] as const).map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </td>
                  {(['x', 'y', 'z'] as const).map((a) => (
                    <td key={`s${a}`}>
                      <Coord
                        valeur={m.start[a]}
                        onChange={(v) => majSommet(m.id, 'start', a, v)}
                      />
                    </td>
                  ))}
                  {(['x', 'y', 'z'] as const).map((a) => (
                    <td key={`e${a}`}>
                      <Coord valeur={m.end[a]} onChange={(v) => majSommet(m.id, 'end', a, v)} />
                    </td>
                  ))}
                  <td className="nombre">
                    <input
                      type="number"
                      step={15}
                      value={m.rotation}
                      style={{ width: 62, textAlign: 'right' }}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) =>
                        edit(`${m.id} — rotation`, (d) => {
                          const b = d.freeMembers.find((x) => x.id === m.id);
                          if (b) b.rotation = Number(e.target.value) || 0;
                        })
                      }
                    />
                  </td>
                  <td className="nombre derive">{num(longueurLibre(m), 0)}</td>
                  <td>
                    <ChampTexte
                      valeur={m.label}
                      placeholder="ex. bracon de jarret"
                      largeur={150}
                      precision={`${m.id} — désignation`}
                      onChange={(v) =>
                        edit(`${m.id} — repérage`, (d) => {
                          const b = d.freeMembers.find((x) => x.id === m.id);
                          if (b) b.label = v;
                        })
                      }
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="plat" onClick={() => dupliquer(m)}>
                      Dupliquer
                    </button>{' '}
                    <button type="button" className="plat" onClick={() => supprimer(m.id)}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ligne-actions">
        <button type="button" onClick={ajouter}>
          Ajouter une barre
        </button>
        <label className="etiquette">
          Dupliquer en
          <input
            type="number"
            min={1}
            max={50}
            value={copies}
            style={{ width: 56, textAlign: 'right' }}
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
          exemplaire(s), décalés de {num(dec.x, 0)} mm selon X
        </label>
      </div>
    </div>
  );
}

/** Coordonnée en millimètres, comme toutes les longueurs. */
function Coord({
  valeur,
  onChange,
}: {
  valeur: number;
  onChange: (mm: number) => void;
}): JSX.Element {
  return (
    <input
      type="number"
      step={100}
      value={valeur}
      style={{ width: 76, textAlign: 'right' }}
      onWheel={(e) => e.currentTarget.blur()}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

