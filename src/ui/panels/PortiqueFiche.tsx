import { getProfile } from '../../core/catalog/index';
import type { BaseFixity } from '../../core/model/frame';
import { rafterLength } from '../../core/model/grid';
import { useProjectStore } from '../../state/store';
import {
  Bascule,
  ChampChoix,
  ChampNombre,
  ChampNuance,
  ChampProfil,
  FAMILLES_POTEAU,
  FAMILLES_TRAVERSE,
} from '../champs';
import { cm4, kg, mm } from '../format';
import { ReglagesFins } from '../ReglagesFins';

/**
 * LE PORTIQUE, ENTIÈREMENT MODIFIABLE.
 *
 * ⚠ Cette fiche n'affichait que des valeurs. Le moteur de vérification sortait
 * un taux de travail de 1,34 sur un poteau et l'utilisateur n'avait aucun moyen
 * de changer le profil : il fallait éditer le fichier JSON à la main. Tout le
 * calcul Eurocode était consultatif.
 */
export function PortiqueFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const f = project.frame;
  const poteau = getProfile(f.columnProfile);
  const traverse = getProfile(f.rafterProfile);

  return (
    <div className="fiche">
      <h3>Portique</h3>
      <dl className="paires">
        <dt>Poteaux</dt>
        <dd>
          <ChampProfil
            valeur={f.columnProfile}
            familles={FAMILLES_POTEAU}
            onChange={(v) => edit('Profil de poteau', (d) => void (d.frame.columnProfile = v))}
          />
        </dd>
        <dt>Traverses</dt>
        <dd>
          <ChampProfil
            valeur={f.rafterProfile}
            familles={FAMILLES_TRAVERSE}
            onChange={(v) => edit('Profil de traverse', (d) => void (d.frame.rafterProfile = v))}
          />
        </dd>
        <dt>Nuance</dt>
        <dd>
          <ChampNuance
            valeur={f.grade}
            onChange={(v) => edit('Nuance du portique', (d) => void (d.frame.grade = v))}
          />
        </dd>
        <dt>Pieds de poteaux</dt>
        <dd>
          <ChampChoix<BaseFixity>
            valeur={f.baseFixity}
            options={[
              ['articule', 'articulés'],
              ['encastre', 'encastrés'],
            ]}
            onChange={(v) => edit('Pieds de poteaux', (d) => void (d.frame.baseFixity = v))}
          />
        </dd>

        <ReglagesFins quoi="jarrets, portique de pignon, caractéristiques">
          <dt>Jarret de genou</dt>
          <dd>
            <Bascule
              valeur={f.haunch.enabled}
              onChange={(v) => edit('Jarret de genou', (d) => void (d.frame.haunch.enabled = v))}
            />
          </dd>
          {f.haunch.enabled && (
            <>
              <dt>— longueur</dt>
              <dd>
                <ChampNombre
                  valeur={f.haunch.length}
                  pas={50}
                  min={0}
                  unite="mm"
                  onChange={(v) => edit('Longueur de jarret', (d) => void (d.frame.haunch.length = v))}
                />
              </dd>
              <dt>— hauteur au genou</dt>
              <dd>
                <ChampNombre
                  valeur={f.haunch.depth}
                  pas={25}
                  min={0}
                  unite="mm"
                  onChange={(v) => edit('Hauteur de jarret', (d) => void (d.frame.haunch.depth = v))}
                />
              </dd>
              <dt>— part du rampant</dt>
              <dd className="derive">
                {((f.haunch.length / rafterLength(project.grid, 'gauche')) * 100).toFixed(1)} %
              </dd>
            </>
          )}

          <dt>Jarret de faîtage</dt>
          <dd>
            <Bascule
              valeur={f.ridgeHaunch.enabled}
              onChange={(v) => edit('Jarret de faîtage', (d) => void (d.frame.ridgeHaunch.enabled = v))}
            />
          </dd>
          {f.ridgeHaunch.enabled && (
            <>
              <dt>— longueur</dt>
              <dd>
                <ChampNombre
                  valeur={f.ridgeHaunch.length}
                  pas={50}
                  min={0}
                  unite="mm"
                  onChange={(v) =>
                    edit('Longueur jarret faîtage', (d) => void (d.frame.ridgeHaunch.length = v))
                  }
                />
              </dd>
              <dt>— hauteur au faîtage</dt>
              <dd>
                <ChampNombre
                  valeur={f.ridgeHaunch.depth}
                  pas={25}
                  min={0}
                  unite="mm"
                  onChange={(v) =>
                    edit('Hauteur jarret faîtage', (d) => void (d.frame.ridgeHaunch.depth = v))
                  }
                />
              </dd>
            </>
          )}

          {/*
            Le portique de rive porte le pignon et ses potelets : il reçoit une
            charge de toiture réduite de moitié mais une charge de vent entière.
            C'est le seul cas où un profil distinct se justifie.
          */}
          <dt>Portique de pignon distinct</dt>
          <dd>
            <Bascule
              valeur={f.distinctGableFrame}
              onChange={(v) =>
                edit('Portique de pignon distinct', (d) => void (d.frame.distinctGableFrame = v))
              }
            />
          </dd>
          {f.distinctGableFrame && (
            <>
              <dt>— poteaux de pignon</dt>
              <dd>
                <ChampProfil
                  valeur={f.gableColumnProfile}
                  familles={FAMILLES_POTEAU}
                  onChange={(v) =>
                    edit('Poteau de pignon', (d) => void (d.frame.gableColumnProfile = v))
                  }
                />
              </dd>
              <dt>— traverses de pignon</dt>
              <dd>
                <ChampProfil
                  valeur={f.gableRafterProfile}
                  familles={FAMILLES_TRAVERSE}
                  onChange={(v) =>
                    edit('Traverse de pignon', (d) => void (d.frame.gableRafterProfile = v))
                  }
                />
              </dd>
            </>
          )}

          <dt>Masse linéique poteau</dt>
          <dd className="derive">{kg(poteau.G)} kg/m</dd>
          <dt>Hauteur de traverse</dt>
          <dd className="derive">{mm(traverse.h)} mm</dd>
          <dt>Inertie traverse Iy</dt>
          <dd className="derive">{cm4(traverse.Iy)} cm⁴</dd>
        </ReglagesFins>
      </dl>
    </div>
  );
}
