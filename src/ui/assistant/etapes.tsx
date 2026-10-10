import type { Draft } from 'immer';
import { chargesClimatiques } from '../../core/climat/index';
import { ZONES_NEIGE, type ZoneNeige } from '../../core/climat/neige';
import { LIBELLE_TERRAIN, TERRAINS, ZONES_VENT, type CategorieTerrain, type ZoneVent } from '../../core/climat/vent';
import { buildingLength, footprintArea, ridgeHeight } from '../../core/model/grid';
import type { ProjectParams } from '../../core/model/project';
import { TEMPLATES } from '../../core/model/templates';
import { Bascule, ChampChoix, ChampLongueur, ChampNombre, ChampTexte } from '../champs';
import { mm, num } from '../format';

/**
 * ÉTAPES DE L'ASSISTANT DE DÉMARRAGE.
 *
 * Chacune ne pose que les questions de son ordre : ce qu'on construit, ses
 * dimensions, son ossature, son site. Tout le reste garde les valeurs du
 * gabarit choisi, et se règle ensuite dans l'onglet Projet.
 */

export type Maj = (recette: (d: Draft<ProjectParams>) => void) => void;

export interface PropsEtape {
  readonly p: ProjectParams;
  readonly maj: Maj;
}

export function EtapeBatiment({ p, maj, gabarit, choisirGabarit }: PropsEtape & { gabarit: string; choisirGabarit: (id: string) => void }): JSX.Element {
  return (
    <div className="fiche">
      <h3>Bâtiment</h3>
      <p className="note" style={{ marginTop: 0 }}>Partez du type de bâtiment le plus proche : ses profils sont déjà vérifiés pour les charges qu’il annonce.</p>
      <ul className="gabarits assistant-gabarits">
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <button type="button" aria-pressed={gabarit === t.id} onClick={() => choisirGabarit(t.id)}>
              <strong>{t.nom}</strong>
              <em>{t.resume}</em>
              <span>{t.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <dl className="paires" style={{ marginTop: 12 }}>
        <dt>Nom du projet</dt>
        <dd>
          <ChampTexte valeur={p.meta.nom} largeur="100%" onChange={(v) => maj((d) => void (d.meta.nom = v))} />
        </dd>
        <dt>Client</dt>
        <dd>
          <ChampTexte valeur={p.meta.client} largeur="100%" onChange={(v) => maj((d) => void (d.meta.client = v))} />
        </dd>
        <dt>Chantier</dt>
        <dd>
          <ChampTexte valeur={p.meta.chantier} largeur="100%" onChange={(v) => maj((d) => void (d.meta.chantier = v))} />
        </dd>
      </dl>
    </div>
  );
}

export function EtapeDimensions({ p, maj }: PropsEtape): JSX.Element {
  const g = p.grid;
  const valide = g.span > 0 && g.baySpacing > 0 && g.eaveHeight > 0 && g.nBays >= 1;
  return (
    <div className="fiche">
      <h3>Trame — dimensions</h3>
      <dl className="paires">
        <dt>Travées</dt>
        <dd>
          <ChampNombre valeur={g.nBays} pas={1} min={1} onChange={(v) => maj((d) => void (d.grid.nBays = Math.round(v)))} />
        </dd>
        <dt>Entraxe des portiques</dt>
        <dd>
          <ChampLongueur valeur={g.baySpacing} pas={500} onChange={(v) => maj((d) => void (d.grid.baySpacing = v))} />
        </dd>
        <dt>Portée</dt>
        <dd>
          <ChampLongueur valeur={g.span} pas={500} onChange={(v) => maj((d) => void (d.grid.span = v))} />
        </dd>
        <dt>Hauteur à l’égout</dt>
        <dd>
          <ChampLongueur valeur={g.eaveHeight} pas={250} onChange={(v) => maj((d) => void (d.grid.eaveHeight = v))} />
        </dd>
        <dt>Forme</dt>
        <dd>
          <ChampChoix
            valeur={g.roofType}
            options={[
              ['bipente', 'deux versants'],
              ['monopente', 'un seul versant'],
            ]}
            onChange={(v) => maj((d) => void (d.grid.roofType = v))}
          />
        </dd>
        <dt>Pente</dt>
        <dd>
          <ChampNombre valeur={g.slope} pas={1} unite={g.slopeUnit === 'degres' ? '°' : '%'} onChange={(v) => maj((d) => void (d.grid.slope = v))} />
        </dd>
        <dt>Portée par</dt>
        <dd>
          <ChampChoix
            valeur={p.truss.enabled ? 'treillis' : 'portique'}
            options={[
              ['portique', 'traverse à âme pleine'],
              ['treillis', 'ferme treillis'],
            ]}
            onChange={(v) =>
              maj((d) => {
                d.frame.enabled = v !== 'treillis';
                d.truss.enabled = v === 'treillis';
              })
            }
          />
        </dd>
      </dl>
      {valide && (
        <dl className="paires deduites">
          <dt>Longueur du bâtiment</dt>
          <dd className="derive">{mm(buildingLength(g))} mm</dd>
          <dt>Hauteur au faîtage</dt>
          <dd className="derive">{mm(ridgeHeight(g))} mm</dd>
          <dt>Emprise au sol</dt>
          <dd className="derive">{num(footprintArea(g), 1)} m²</dd>
        </dl>
      )}
    </div>
  );
}

export function EtapeOssature({ p, maj }: PropsEtape): JSX.Element {
  const s = p.secondary;
  return (
    <div className="fiche">
      <h3>Ossature secondaire et stabilité</h3>
      <dl className="paires">
        <dt>Pannes</dt>
        <dd>
          <Bascule valeur={s.purlins.enabled} onChange={(v) => maj((d) => void (d.secondary.purlins.enabled = v))} />
        </dd>
        {s.purlins.enabled && (
          <>
            <dt>— entraxe demandé</dt>
            <dd>
              <ChampLongueur valeur={s.purlins.spacing} pas={50} onChange={(v) => maj((d) => void (d.secondary.purlins.spacing = v))} />
            </dd>
          </>
        )}
        <dt>Lisses de bardage</dt>
        <dd>
          <Bascule valeur={s.rails.enabled} onChange={(v) => maj((d) => void (d.secondary.rails.enabled = v))} />
        </dd>
        {s.rails.enabled && (
          <>
            <dt>— arase du soubassement</dt>
            <dd>
              <ChampLongueur valeur={s.rails.sillHeight} pas={100} onChange={(v) => maj((d) => void (d.secondary.rails.sillHeight = v))} />
            </dd>
          </>
        )}
        <dt>Potelets de pignon</dt>
        <dd>
          <Bascule valeur={s.gablePosts.enabled} onChange={(v) => maj((d) => void (d.secondary.gablePosts.enabled = v))} />
        </dd>
        <dt>Poutre au vent</dt>
        <dd>
          <Bascule valeur={p.bracing.roof.enabled} onChange={(v) => maj((d) => void (d.bracing.roof.enabled = v))} />
        </dd>
        <dt>Palées de stabilité</dt>
        <dd>
          <Bascule valeur={p.bracing.wall.enabled} onChange={(v) => maj((d) => void (d.bracing.wall.enabled = v))} />
        </dd>
      </dl>
      <p className="note" style={{ marginBottom: 0 }}>
        Profils, liernes, ouvertures et assemblages gardent les valeurs du gabarit : ils se règlent ensuite dans l’onglet Projet.
      </p>
    </div>
  );
}

export function EtapeCharges({ p, maj }: PropsEtape): JSX.Element {
  const site = p.site;
  const eurocode = site.mode === 'eurocode';
  const c = eurocode ? chargesClimatiques(p) : null;
  const l = p.loads.loads;
  const charge = (libelle: string, valeur: number, cle: 'permanent' | 'neige' | 'ventPression' | 'ventDepression'): JSX.Element => (
    <>
      <dt>{libelle}</dt>
      <dd>
        <ChampNombre valeur={valeur} pas={0.05} min={0} unite="kN/m²" largeur={70} onChange={(v) => maj((d) => void (d.loads.loads[cle] = v))} />
      </dd>
    </>
  );
  return (
    <div className="fiche">
      <h3>Charges et site</h3>
      <dl className="paires">
        <dt>Origine des charges</dt>
        <dd>
          <ChampChoix
            valeur={site.mode}
            options={[
              ['eurocode', 'calculées depuis le site (EN 1991)'],
              ['manuel', 'saisies à la main'],
            ]}
            onChange={(v) => maj((d) => void (d.site.mode = v))}
          />
        </dd>
        {charge('Permanentes (couverture)', l.permanent, 'permanent')}
        {eurocode && c ? (
          <>
            <dt>Région de neige</dt>
            <dd>
              <ChampChoix<ZoneNeige> valeur={site.zoneNeige} options={ZONES_NEIGE.map((z) => [z, z] as const)} onChange={(v) => maj((d) => void (d.site.zoneNeige = v))} />
            </dd>
            <dt>Altitude</dt>
            <dd>
              <ChampNombre valeur={site.altitude} pas={50} min={0} unite="m" onChange={(v) => maj((d) => void (d.site.altitude = v))} />
            </dd>
            <dt>Région de vent</dt>
            <dd>
              <ChampChoix<ZoneVent> valeur={site.zoneVent} options={ZONES_VENT.map((z) => [z, `région ${z}`] as const)} onChange={(v) => maj((d) => void (d.site.zoneVent = v))} />
            </dd>
            <dt>Catégorie de terrain</dt>
            <dd>
              <ChampChoix<CategorieTerrain> valeur={site.terrain} options={TERRAINS.map((t) => [t, LIBELLE_TERRAIN[t]] as const)} onChange={(v) => maj((d) => void (d.site.terrain = v))} />
            </dd>
            <dt>— neige en toiture</dt>
            <dd className="derive">{num(c.valeurs.neige, 2)} kN/m²</dd>
            <dt>— vent, pression retenue</dt>
            <dd className="derive">{num(c.valeurs.ventPression, 2)} kN/m²</dd>
            <dt>— vent, dépression retenue</dt>
            <dd className="derive">{num(c.valeurs.ventDepression, 2)} kN/m²</dd>
          </>
        ) : (
          <>
            {charge('Neige', l.neige, 'neige')}
            {charge('Vent — pression', l.ventPression, 'ventPression')}
            {charge('Vent — dépression', l.ventDepression, 'ventDepression')}
          </>
        )}
      </dl>
    </div>
  );
}
