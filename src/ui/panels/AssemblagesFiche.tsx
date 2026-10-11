import {
  BOLT_DIAMETERS,
  holeDiameter,
  minEdgeDistance,
  minGauge,
  minPitch,
  type BoltClass,
  type BoltDiameter,
  type BoltSpec,
} from '../../core/model/connections';
import { useProjectStore } from '../../state/store';
import { Bascule, ChampChoix, ChampNombre, ChampProfil, libellerAvec } from '../champs';
import type { SoudureSemelles } from '../../core/geometry/weld';

const DIAMETRE = libellerAvec('diamètre');
const CLASSE = libellerAvec('classe');
import { dim } from '../format';

/**
 * ASSEMBLAGES.
 *
 * ⚠ Ces valeurs commandent directement les plans d'atelier : le nombre de
 * rangées fixe la hauteur de la platine, la pince fixe la position du premier
 * trou, le diamètre fixe le perçage. Elles étaient en lecture seule alors que
 * SteelPlan édite des plans de fabrication complets — on fabriquait sur des
 * assemblages qu'on ne pouvait pas régler.
 *
 * Les minima EN 1993-1-8 sont affichés à côté de chaque valeur saisie. La
 * validation les fait respecter, mais les voir pendant la saisie évite d'avoir à
 * corriger après coup.
 */

export function AssemblagesFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const c = project.connections;
  const cb = c.columnBase;

  return (
    <div className="fiche">
      <h3>Assemblages</h3>
      <dl className="paires">
        <Platine titre="Platine traverse–poteau" cle="rafterToColumn" />
        <Platine titre="Platine de faîtage" cle="ridge" />

        {/* ---------------- Pied de poteau ---------------- */}
        <dt>
          <strong>Pied de poteau</strong>
        </dt>
        <dd />
        <dt>— platine</dt>
        <dd>
          <ChampNombre
            valeur={cb.length}
            pas={10}
            min={100}
            largeur={70}
            onChange={(v) => edit('Longueur platine de pied', (d) => void (d.connections.columnBase.length = v))}
          />
          {' × '}
          <ChampNombre
            valeur={cb.width}
            pas={10}
            min={100}
            largeur={70}
            onChange={(v) => edit('Largeur platine de pied', (d) => void (d.connections.columnBase.width = v))}
          />
          {' × '}
          <ChampNombre
            valeur={cb.thickness}
            pas={5}
            min={8}
            largeur={56}
            unite="mm"
            onChange={(v) =>
              edit('Épaisseur platine de pied', (d) => void (d.connections.columnBase.thickness = v))
            }
          />
        </dd>
        <dt>— tiges d’ancrage</dt>
        <dd>
          <ChampNombre
            valeur={cb.anchorCount}
            pas={2}
            min={2}
            largeur={56}
            onChange={(v) =>
              edit('Nombre de tiges', (d) => {
                d.connections.columnBase.anchorCount = Math.round(v);
              })
            }
          />
          {' × Ø'}
          <ChampNombre
            valeur={cb.anchorDiameter}
            pas={2}
            min={10}
            largeur={56}
            unite="mm"
            onChange={(v) =>
              edit('Diamètre des tiges', (d) => void (d.connections.columnBase.anchorDiameter = v))
            }
          />
        </dd>
        <dt>— scellement</dt>
        <dd>
          <ChampNombre
            valeur={cb.anchorEmbedment}
            pas={25}
            min={50}
            unite="mm"
            onChange={(v) =>
              edit('Longueur de scellement', (d) => void (d.connections.columnBase.anchorEmbedment = v))
            }
          />
        </dd>
        <dt>— mortier de calage</dt>
        <dd>
          <ChampNombre
            valeur={cb.groutThickness}
            pas={5}
            min={0}
            unite="mm"
            onChange={(v) =>
              edit('Mortier de calage', (d) => void (d.connections.columnBase.groutThickness = v))
            }
          />
        </dd>
        <dt>— bêche de cisaillement</dt>
        <dd>
          <Bascule
            valeur={cb.shearKey}
            onChange={(v) => edit('Bêche', (d) => void (d.connections.columnBase.shearKey = v))}
          />
        </dd>

        {/* ---------------- Gousset ---------------- */}
        <dt>
          <strong>Gousset de treillis</strong>
        </dt>
        <dd />
        <dt>— épaisseur</dt>
        <dd>
          <ChampNombre
            valeur={c.gusset.thickness}
            pas={2}
            min={4}
            unite="mm"
            onChange={(v) => edit('Épaisseur de gousset', (d) => void (d.connections.gusset.thickness = v))}
          />
        </dd>
        <ChoixBoulon
          libelle="— boulons"
          valeur={c.gusset.bolt}
          onChange={(b) => edit('Boulon de gousset', (d) => void (d.connections.gusset.bolt = b))}
        />
        <dt>— marge de tôle</dt>
        <dd>
          <ChampNombre
            valeur={c.gusset.edgeMargin}
            pas={5}
            min={10}
            unite="mm"
            onChange={(v) => edit('Marge de gousset', (d) => void (d.connections.gusset.edgeMargin = v))}
          />
        </dd>

        {/* ---------------- Éclisse ---------------- */}
        <dt>
          <strong>Éclisse de continuité</strong>
        </dt>
        <dd>
          <Bascule
            valeur={c.splice.enabled}
            onChange={(v) => edit('Éclisse', (d) => void (d.connections.splice.enabled = v))}
          />
        </dd>
        {c.splice.enabled && (
          <>
            <dt>— épaisseur</dt>
            <dd>
              <ChampNombre
                valeur={c.splice.thickness}
                pas={2}
                min={4}
                unite="mm"
                onChange={(v) =>
                  edit('Épaisseur d’éclisse', (d) => void (d.connections.splice.thickness = v))
                }
              />
            </dd>
            <dt>— rangées</dt>
            <dd>
              <ChampNombre
                valeur={c.splice.rows}
                pas={1}
                min={2}
                onChange={(v) =>
                  edit('Rangées d’éclisse', (d) => void (d.connections.splice.rows = Math.round(v)))
                }
              />
            </dd>
            <ChoixBoulon
              libelle="— boulons"
              valeur={c.splice.bolt}
              onChange={(b) => edit('Boulon d’éclisse', (d) => void (d.connections.splice.bolt = b))}
            />
          </>
        )}

        {/* ---------------- Attaches secondaires ---------------- */}
        <dt>
          <strong>Attaches secondaires</strong>
        </dt>
        <dd />
        <ChoixBoulon
          libelle="— boulonnerie"
          valeur={c.secondaryBolt}
          onChange={(b) => edit('Boulon secondaire', (d) => void (d.connections.secondaryBolt = b))}
        />
        <dt>— échantignolles</dt>
        <dd>
          <Bascule
            valeur={c.purlinCleat.enabled}
            onChange={(v) => edit('Échantignolles', (d) => void (d.connections.purlinCleat.enabled = v))}
          />
        </dd>
        {c.purlinCleat.enabled && (
          <>
            <dt>— cornière</dt>
            <dd>
              <ChampProfil
                valeur={c.purlinCleat.profile}
                familles={['L', 'LI']}
                onChange={(v) =>
                  edit('Cornière d’attache', (d) => void (d.connections.purlinCleat.profile = v))
                }
              />
            </dd>
            <dt>— longueur</dt>
            <dd>
              <ChampNombre
                valeur={c.purlinCleat.length}
                pas={10}
                min={40}
                unite="mm"
                onChange={(v) =>
                  edit('Longueur d’échantignolle', (d) => void (d.connections.purlinCleat.length = v))
                }
              />
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Une platine d'about. Les deux se règlent pareil : une seule définition. */
function Platine({ titre, cle }: { titre: string; cle: 'rafterToColumn' | 'ridge' }): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const e = project.connections[cle];

  return (
    <>
      <dt>
        <strong>{titre}</strong>
      </dt>
      <dd />
      <dt>— épaisseur</dt>
      <dd>
        <ChampNombre
          valeur={e.thickness}
          pas={5}
          min={8}
          unite="mm"
          onChange={(v) => edit(`Épaisseur ${titre}`, (d) => void (d.connections[cle].thickness = v))}
        />
      </dd>
      <dt>— soudure des semelles</dt>
      <dd>
        <ChampChoix<SoudureSemelles>
          valeur={e.soudureSemelles}
          options={[
            ['angle', 'cordons d’angle'],
            ['pleine-penetration', 'pleine pénétration'],
          ]}
          onChange={(v) => edit(`Soudure ${titre}`, (d) => void (d.connections[cle].soudureSemelles = v))}
        />
      </dd>
      <ChoixBoulon
        libelle="— boulons"
        valeur={e.bolt}
        onChange={(b) => edit(`Boulon ${titre}`, (d) => void (d.connections[cle].bolt = b))}
      />
      <dt>— perçage</dt>
      <dd className="derive">Ø{dim(holeDiameter(e.bolt))} mm</dd>
      <dt>— rangées × files</dt>
      <dd>
        <ChampNombre
          valeur={e.rows}
          pas={1}
          min={2}
          largeur={56}
          onChange={(v) =>
            edit(`Rangées ${titre}`, (d) => void (d.connections[cle].rows = Math.round(v)))
          }
        />
        {' × '}
        <ChampNombre
          valeur={e.cols}
          pas={1}
          min={1}
          largeur={56}
          onChange={(v) =>
            edit(`Files ${titre}`, (d) => void (d.connections[cle].cols = Math.round(v)))
          }
        />
      </dd>
      <dt>— pince</dt>
      <dd>
        <ChampNombre
          valeur={e.edgeDistance}
          pas={5}
          min={10}
          unite="mm"
          onChange={(v) => edit(`Pince ${titre}`, (d) => void (d.connections[cle].edgeDistance = v))}
        />
        <span className="derive"> (mini {dim(Math.ceil(minEdgeDistance(e.bolt)))})</span>
      </dd>
      <dt>— entraxe de files</dt>
      <dd>
        <ChampNombre
          valeur={e.gauge}
          pas={5}
          min={20}
          unite="mm"
          onChange={(v) => edit(`Entraxe ${titre}`, (d) => void (d.connections[cle].gauge = v))}
        />
        <span className="derive"> (mini {dim(Math.ceil(minGauge(e.bolt)))})</span>
      </dd>
      <dt>— débord</dt>
      <dd>
        <ChampNombre
          valeur={e.overhang}
          pas={5}
          min={0}
          unite="mm"
          onChange={(v) => edit(`Débord ${titre}`, (d) => void (d.connections[cle].overhang = v))}
        />
      </dd>
      <dt>— entraxe mini p1</dt>
      <dd className="derive">{dim(Math.ceil(minPitch(e.bolt)))} mm</dd>
    </>
  );
}

/** Diamètre et classe : les deux vont ensemble, jamais l'un sans l'autre. */
function ChoixBoulon({
  libelle,
  valeur,
  onChange,
}: {
  libelle: string;
  valeur: BoltSpec;
  onChange: (b: BoltSpec) => void;
}): JSX.Element {
  return (
    <>
      <dt>{libelle}</dt>
      <dd>
        M
        <select
          ref={DIAMETRE}
          value={valeur.d}
          onChange={(e) => onChange({ ...valeur, d: Number(e.target.value) as BoltDiameter })}
        >
          {BOLT_DIAMETERS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>{' '}
        <select
          ref={CLASSE}
          value={valeur.cls}
          onChange={(e) => onChange({ ...valeur, cls: e.target.value as BoltClass })}
        >
          <option value="8.8">8.8</option>
          <option value="10.9">10.9</option>
        </select>
      </dd>
    </>
  );
}
