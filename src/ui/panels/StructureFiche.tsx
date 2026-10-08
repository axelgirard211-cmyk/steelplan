import { trussDepthAtRidge } from '../../core/build/buildTruss';
import type { RoofType, SlopeUnit } from '../../core/model/grid';
import type { TrussType } from '../../core/model/truss';
import { useProjectStore } from '../../state/store';
import {
  Bascule,
  ChampChoix,
  ChampNombre,
  ChampNuance,
  ChampProfil,
  FAMILLES_TREILLIS,
} from '../champs';
import { mm } from '../format';

/**
 * TRAME ET TYPE DE TOITURE.
 *
 * Les poteaux ne figurent pas dans ce choix : ils existent dans les deux cas.
 * Une ferme treillis repose forcément sur des poteaux, ce sont ceux du portique.
 */

const TYPES_TREILLIS: readonly (readonly [TrussType, string])[] = [
  ['warren', 'Warren'],
  ['pratt', 'Pratt'],
  ['howe', 'Howe'],
  ['polonceau', 'Polonceau'],
];

export function StructureFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const g = project.grid;
  const t = project.truss;
  const treillis = t.enabled;

  const basculer = (versTreillis: boolean): void =>
    edit(versTreillis ? 'Ferme treillis' : 'Traverse à âme pleine', (d) => {
      d.frame.enabled = !versTreillis;
      d.truss.enabled = versTreillis;
    });

  return (
    <div className="fiche">
      <h3>Toiture</h3>
      <dl className="paires">
        <dt>Forme</dt>
        <dd>
          <ChampChoix<RoofType>
            valeur={g.roofType}
            options={[
              ['bipente', 'deux versants'],
              ['monopente', 'un seul versant'],
            ]}
            onChange={(v) => edit('Forme de toiture', (d) => void (d.grid.roofType = v))}
          />
        </dd>
        <dt>Unité de pente</dt>
        <dd>
          <ChampChoix<SlopeUnit>
            valeur={g.slopeUnit}
            options={[
              ['pourcent', 'pourcent'],
              ['degres', 'degrés'],
            ]}
            onChange={(v) => edit('Unité de pente', (d) => void (d.grid.slopeUnit = v))}
          />
        </dd>
        <dt>Versants dissymétriques</dt>
        <dd>
          <Bascule
            valeur={g.asymmetric}
            onChange={(v) => edit('Versants dissymétriques', (d) => void (d.grid.asymmetric = v))}
          />
        </dd>
        {g.asymmetric && (
          <>
            <dt>— pente du versant droit</dt>
            <dd>
              <ChampNombre
                valeur={g.slopeRight}
                pas={1}
                min={0}
                unite={g.slopeUnit === 'degres' ? '°' : '%'}
                onChange={(v) => edit('Pente droite', (d) => void (d.grid.slopeRight = v))}
              />
            </dd>
          </>
        )}

        <dt>Portée par</dt>
        <dd>
          <ChampChoix
            valeur={treillis ? 'treillis' : 'portique'}
            options={[
              ['portique', 'traverse à âme pleine'],
              ['treillis', 'ferme treillis'],
            ]}
            onChange={(v) => basculer(v === 'treillis')}
          />
        </dd>

        {treillis && (
          <>
            <dt>— type</dt>
            <dd>
              <ChampChoix<TrussType>
                valeur={t.type}
                options={TYPES_TREILLIS}
                onChange={(v) => edit('Type de treillis', (d) => void (d.truss.type = v))}
              />
            </dd>
            <dt>— panneaux</dt>
            <dd>
              <ChampNombre
                valeur={t.nPanels}
                pas={2}
                min={2}
                onChange={(v) => edit('Panneaux', (d) => void (d.truss.nPanels = Math.round(v)))}
              />
            </dd>
            <dt>— hauteur à l’appui</dt>
            <dd>
              <ChampNombre
                valeur={t.heightAtSupport}
                pas={100}
                min={100}
                unite="mm"
                onChange={(v) => edit('Hauteur de ferme', (d) => void (d.truss.heightAtSupport = v))}
              />
            </dd>
            <dt>— hauteur au faîtage</dt>
            <dd className="derive">{mm(trussDepthAtRidge(g, t))} mm</dd>
            <dt>— entrait droit</dt>
            <dd>
              <Bascule
                valeur={t.straightTie}
                onChange={(v) => edit('Entrait', (d) => void (d.truss.straightTie = v))}
              />
            </dd>
            {t.type === 'warren' && (
              <>
                <dt>— avec montants</dt>
                <dd>
                  <Bascule
                    valeur={t.warrenWithPosts}
                    onChange={(v) =>
                      edit('Montants Warren', (d) => void (d.truss.warrenWithPosts = v))
                    }
                  />
                </dd>
              </>
            )}
            <dt>— membrure supérieure</dt>
            <dd>
              <ChampProfil
                valeur={t.topChordProfile}
                familles={FAMILLES_TREILLIS}
                onChange={(v) => edit('Membrure sup.', (d) => void (d.truss.topChordProfile = v))}
              />
            </dd>
            <dt>— membrure inférieure</dt>
            <dd>
              <ChampProfil
                valeur={t.bottomChordProfile}
                familles={FAMILLES_TREILLIS}
                onChange={(v) => edit('Membrure inf.', (d) => void (d.truss.bottomChordProfile = v))}
              />
            </dd>
            <dt>— montants</dt>
            <dd>
              <ChampProfil
                valeur={t.postProfile}
                familles={FAMILLES_TREILLIS}
                onChange={(v) => edit('Montants', (d) => void (d.truss.postProfile = v))}
              />
            </dd>
            <dt>— diagonales</dt>
            <dd>
              <ChampProfil
                valeur={t.diagonalProfile}
                familles={FAMILLES_TREILLIS}
                onChange={(v) => edit('Diagonales', (d) => void (d.truss.diagonalProfile = v))}
              />
            </dd>
            <dt>— nuance</dt>
            <dd>
              <ChampNuance
                valeur={t.grade}
                onChange={(v) => edit('Nuance du treillis', (d) => void (d.truss.grade = v))}
              />
            </dd>
            {/*
              ⚠ Une paire dos à dos double la section ET l'inertie hors plan.
              Chaque cornière reste vérifiée seule, pour sa part de charge : c'est
              du côté sûr, mais la case doit rester visible pour qu'on sache ce
              qui est commandé — on achète deux cornières, pas une.
            */}
            <dt>— cornières jumelées</dt>
            <dd>
              <Bascule
                valeur={t.doubleAngles}
                onChange={(v) => edit('Doubles cornières', (d) => void (d.truss.doubleAngles = v))}
              />
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
