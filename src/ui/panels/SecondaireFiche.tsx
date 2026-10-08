import { getProfile } from '../../core/catalog/index';
import type { SpacingMode } from '../../core/model/secondary';
import { useStructuralModel } from '../../state/derived';
import { useProjectStore } from '../../state/store';
import {
  Bascule,
  ChampChoix,
  ChampNombre,
  ChampNuance,
  ChampProfil,
  FAMILLES_LISSE,
  FAMILLES_PANNE,
  FAMILLES_POTEAU,
} from '../champs';
import { m2parM, mm } from '../format';

/**
 * OSSATURE SECONDAIRE, ENTIÈREMENT MODIFIABLE.
 *
 * Pannes, lisses et potelets représentent le plus gros du NOMBRE de pièces d'un
 * hangar — et souvent le tiers du tonnage. Leur profil est donc le premier levier
 * d'économie, et il n'était pas réglable.
 */

const MODES: readonly (readonly [SpacingMode, string])[] = [
  ['entraxe', 'entraxe imposé'],
  ['nombre', 'nombre imposé'],
];

export function SecondaireFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const model = useStructuralModel();
  const s = project.secondary;

  return (
    <div className="fiche">
      <h3>Ossature secondaire</h3>
      <dl className="paires">
        {/* ---------------- Pannes ---------------- */}
        <dt>Pannes</dt>
        <dd>
          <Bascule
            valeur={s.purlins.enabled}
            onChange={(v) => edit('Pannes', (d) => void (d.secondary.purlins.enabled = v))}
          />
        </dd>
        {s.purlins.enabled && (
          <>
            <dt>— profil</dt>
            <dd>
              <ChampProfil
                valeur={s.purlins.profile}
                familles={FAMILLES_PANNE}
                onChange={(v) => edit('Profil de panne', (d) => void (d.secondary.purlins.profile = v))}
              />
            </dd>
            <dt>— nuance</dt>
            <dd>
              <ChampNuance
                valeur={s.purlins.grade}
                onChange={(v) => edit('Nuance des pannes', (d) => void (d.secondary.purlins.grade = v))}
              />
            </dd>
            <dt>— répartition</dt>
            <dd>
              <ChampChoix<SpacingMode>
                valeur={s.purlins.mode}
                options={MODES}
                onChange={(v) =>
                  edit('Répartition des pannes', (d) => void (d.secondary.purlins.mode = v))
                }
              />
            </dd>
            {s.purlins.mode === 'entraxe' ? (
              <>
                <dt>— entraxe demandé</dt>
                <dd>
                  <ChampNombre
                    valeur={s.purlins.spacing}
                    pas={50}
                    min={100}
                    unite="mm"
                    onChange={(v) =>
                      edit('Entraxe des pannes', (d) => void (d.secondary.purlins.spacing = v))
                    }
                  />
                </dd>
              </>
            ) : (
              <>
                <dt>— nombre par versant</dt>
                <dd>
                  <ChampNombre
                    valeur={s.purlins.count}
                    pas={1}
                    min={1}
                    onChange={(v) =>
                      edit('Nombre de pannes', (d) => void (d.secondary.purlins.count = Math.round(v)))
                    }
                  />
                </dd>
              </>
            )}
            {/*
              ⚠ L'entraxe RÉEL, jamais celui demandé : c'est lui qui est coté sur
              les plans, et c'est lui qui sert de longueur de déversement à la
              traverse. L'écart entre les deux se voit ici, pas à la pose.
            */}
            <dt>— entraxe réel obtenu</dt>
            <dd className="derive">{mm(model.spacings.purlins)} mm</dd>
            <dt>— débord à l’égout</dt>
            <dd>
              <ChampNombre
                valeur={s.purlins.eaveOverhang}
                pas={50}
                min={0}
                unite="mm"
                onChange={(v) =>
                  edit('Débord à l’égout', (d) => void (d.secondary.purlins.eaveOverhang = v))
                }
              />
            </dd>
            <dt>— panne sablière</dt>
            <dd>
              <Bascule
                valeur={s.purlins.eavePurlin}
                onChange={(v) =>
                  edit('Panne sablière', (d) => void (d.secondary.purlins.eavePurlin = v))
                }
              />
            </dd>
            <dt>— panne faîtière</dt>
            <dd>
              <Bascule
                valeur={s.purlins.ridgePurlin}
                onChange={(v) =>
                  edit('Panne faîtière', (d) => void (d.secondary.purlins.ridgePurlin = v))
                }
              />
            </dd>
            <dt>— liernes</dt>
            <dd>
              <Bascule
                valeur={s.purlins.sagBars.enabled}
                onChange={(v) =>
                  edit('Liernes', (d) => void (d.secondary.purlins.sagBars.enabled = v))
                }
              />
            </dd>
            {s.purlins.sagBars.enabled && (
              <>
                <dt>— files de liernes</dt>
                <dd>
                  <ChampNombre
                    valeur={s.purlins.sagBars.rows}
                    pas={1}
                    min={1}
                    max={3}
                    onChange={(v) =>
                      edit('Files de liernes', (d) => {
                        d.secondary.purlins.sagBars.rows = Math.round(v);
                      })
                    }
                  />
                </dd>
                <dt>— diamètre du rond</dt>
                <dd>
                  <ChampNombre
                    valeur={s.purlins.sagBars.diameter}
                    pas={2}
                    min={8}
                    unite="mm"
                    onChange={(v) =>
                      edit('Diamètre de lierne', (d) => {
                        d.secondary.purlins.sagBars.diameter = v;
                      })
                    }
                  />
                </dd>
              </>
            )}
            <dt>— surface à peindre</dt>
            <dd className="derive">{m2parM(getProfile(s.purlins.profile).perimeter)} m²/m</dd>
          </>
        )}

        {/* ---------------- Lisses ---------------- */}
        <dt>Lisses de bardage</dt>
        <dd>
          <Bascule
            valeur={s.rails.enabled}
            onChange={(v) => edit('Lisses', (d) => void (d.secondary.rails.enabled = v))}
          />
        </dd>
        {s.rails.enabled && (
          <>
            <dt>— profil</dt>
            <dd>
              <ChampProfil
                valeur={s.rails.profile}
                familles={FAMILLES_LISSE}
                onChange={(v) => edit('Profil de lisse', (d) => void (d.secondary.rails.profile = v))}
              />
            </dd>
            <dt>— nuance</dt>
            <dd>
              <ChampNuance
                valeur={s.rails.grade}
                onChange={(v) => edit('Nuance des lisses', (d) => void (d.secondary.rails.grade = v))}
              />
            </dd>
            <dt>— répartition</dt>
            <dd>
              <ChampChoix<SpacingMode>
                valeur={s.rails.mode}
                options={MODES}
                onChange={(v) =>
                  edit('Répartition des lisses', (d) => void (d.secondary.rails.mode = v))
                }
              />
            </dd>
            {s.rails.mode === 'entraxe' ? (
              <>
                <dt>— entraxe demandé</dt>
                <dd>
                  <ChampNombre
                    valeur={s.rails.spacing}
                    pas={50}
                    min={100}
                    unite="mm"
                    onChange={(v) =>
                      edit('Entraxe des lisses', (d) => void (d.secondary.rails.spacing = v))
                    }
                  />
                </dd>
              </>
            ) : (
              <>
                <dt>— nombre par façade</dt>
                <dd>
                  <ChampNombre
                    valeur={s.rails.count}
                    pas={1}
                    min={1}
                    onChange={(v) =>
                      edit('Nombre de lisses', (d) => void (d.secondary.rails.count = Math.round(v)))
                    }
                  />
                </dd>
              </>
            )}
            <dt>— entraxe réel obtenu</dt>
            <dd className="derive">{mm(model.spacings.rails)} mm</dd>
            <dt>— arase du soubassement</dt>
            <dd>
              <ChampNombre
                valeur={s.rails.sillHeight}
                pas={100}
                min={0}
                unite="mm"
                onChange={(v) => edit('Soubassement', (d) => void (d.secondary.rails.sillHeight = v))}
              />
            </dd>
            <dt>— lisses sur pignons</dt>
            <dd>
              <Bascule
                valeur={s.rails.onGables}
                onChange={(v) => edit('Lisses de pignon', (d) => void (d.secondary.rails.onGables = v))}
              />
            </dd>
          </>
        )}

        {/* ---------------- Potelets ---------------- */}
        <dt>Potelets de pignon</dt>
        <dd>
          <Bascule
            valeur={s.gablePosts.enabled}
            onChange={(v) => edit('Potelets', (d) => void (d.secondary.gablePosts.enabled = v))}
          />
        </dd>
        {s.gablePosts.enabled && (
          <>
            <dt>— profil</dt>
            <dd>
              <ChampProfil
                valeur={s.gablePosts.profile}
                familles={FAMILLES_POTEAU}
                onChange={(v) =>
                  edit('Profil de potelet', (d) => void (d.secondary.gablePosts.profile = v))
                }
              />
            </dd>
            <dt>— nuance</dt>
            <dd>
              <ChampNuance
                valeur={s.gablePosts.grade}
                onChange={(v) =>
                  edit('Nuance des potelets', (d) => void (d.secondary.gablePosts.grade = v))
                }
              />
            </dd>
            <dt>— entraxe demandé</dt>
            <dd>
              <ChampNombre
                valeur={s.gablePosts.spacing}
                pas={250}
                min={500}
                unite="mm"
                onChange={(v) =>
                  edit('Entraxe des potelets', (d) => void (d.secondary.gablePosts.spacing = v))
                }
              />
            </dd>
            <dt>— course des oblongs de tête</dt>
            <dd>
              <ChampNombre
                valeur={s.gablePosts.courseTete}
                pas={5}
                min={5}
                unite="mm"
                onChange={(v) =>
                  edit('Course de tête des potelets', (d) => void (d.secondary.gablePosts.courseTete = v))
                }
              />
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
