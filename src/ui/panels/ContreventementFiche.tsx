import type { BracingShape } from '../../core/model/bracing';
import { bracedBays } from '../../core/model/bracing';
import { useProjectStore } from '../../state/store';
import {
  Bascule,
  ChampChoix,
  ChampNuance,
  ChampProfil,
  FAMILLES_CONTREVENTEMENT,
} from '../champs';

/**
 * CONTREVENTEMENTS.
 *
 * ⚠ Le choix des TRAVÉES contreventées est ici, et il compte autant que le
 * profil : une palée mal placée laisse un long pan libre de basculer. La règle
 * par défaut — première et dernière travée — convient à un bâtiment courant, pas
 * à celui qui a un portail dans la travée de rive.
 */

const FORMES: readonly (readonly [BracingShape, string])[] = [
  ['croix', 'croix de Saint-André'],
  ['diagonale', 'diagonale simple'],
  ['k', 'palée en K'],
];

export function ContreventementFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const b = project.bracing;

  return (
    <div className="fiche">
      <h3>Contreventements</h3>
      <dl className="paires">
        <Jeu titre="Poutre au vent" cle="roof" />
        <Jeu titre="Palées de stabilité" cle="wall" />
        <Jeu titre="Pignon" cle="gable" />

        <dt>Nuance</dt>
        <dd>
          <ChampNuance
            valeur={b.grade}
            onChange={(v) => edit('Nuance de contreventement', (d) => void (d.bracing.grade = v))}
          />
        </dd>
      </dl>
    </div>
  );
}

/**
 * Un jeu de contreventement. Les trois se règlent de la même façon ; les écrire
 * trois fois ferait diverger l'un des trois au premier changement.
 */
function Jeu({ titre, cle }: { titre: string; cle: 'roof' | 'wall' | 'gable' }): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const set = project.bracing[cle];
  const nBays = project.grid.nBays;
  const retenues = bracedBays(set, nBays);

  return (
    <>
      <dt>{titre}</dt>
      <dd>
        <Bascule
          valeur={set.enabled}
          onChange={(v) => edit(titre, (d) => void (d.bracing[cle].enabled = v))}
        />
      </dd>
      {set.enabled && (
        <>
          <dt>— profil</dt>
          <dd>
            <ChampProfil
              valeur={set.profile}
              familles={FAMILLES_CONTREVENTEMENT}
              onChange={(v) => edit(`Profil ${titre}`, (d) => void (d.bracing[cle].profile = v))}
            />
          </dd>
          <dt>— disposition</dt>
          <dd>
            <ChampChoix<BracingShape>
              valeur={set.shape}
              options={FORMES}
              onChange={(v) => edit(`Disposition ${titre}`, (d) => void (d.bracing[cle].shape = v))}
            />
          </dd>
          {cle !== 'gable' && (
            <>
              <dt>— travées</dt>
              <dd>
                <Travees
                  nBays={nBays}
                  retenues={retenues}
                  explicite={set.bays.length > 0}
                  onToggle={(i) =>
                    edit(`Travées ${titre}`, (d) => {
                      // Un jeu au placement automatique devient explicite dès la
                      // première case cochée : on part de ce qui est AFFICHÉ,
                      // sans quoi le premier clic effacerait tout le reste.
                      const base = new Set(bracedBays(project.bracing[cle], nBays));
                      if (base.has(i)) base.delete(i);
                      else base.add(i);
                      d.bracing[cle].bays = [...base].sort((x, y) => x - y);
                    })
                  }
                />
              </dd>
            </>
          )}
        </>
      )}
    </>
  );
}

/** Cases à cocher, une par travée : la disposition se lit d'un coup d'œil. */
function Travees({
  nBays,
  retenues,
  explicite,
  onToggle,
}: {
  nBays: number;
  retenues: readonly number[];
  explicite: boolean;
  onToggle: (i: number) => void;
}): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {Array.from({ length: nBays }, (_, i) => (
        <label key={i} style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
          <input type="checkbox" checked={retenues.includes(i)} onChange={() => onToggle(i)} />
          {i + 1}
        </label>
      ))}
      {!explicite && <em style={{ opacity: 0.65 }}>(auto)</em>}
    </span>
  );
}
