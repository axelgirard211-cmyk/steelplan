import { chargesClimatiques } from '../../core/climat/index';
import { ZONES_NEIGE, type ZoneNeige } from '../../core/climat/neige';
import {
  LIBELLE_TERRAIN,
  TERRAINS,
  ZONES_VENT,
  type CategorieTerrain,
  type ZoneVent,
} from '../../core/climat/vent';
import { useProjectStore } from '../../state/store';
import { ChampChoix, ChampNombre } from '../champs';
import { num } from '../format';

/**
 * LE SITE ET SES CHARGES CLIMATIQUES.
 *
 * ⚠ Neige et vent étaient quatre nombres tapés à la main sans qu'on sache d'où
 * ils venaient. Ce sont pourtant les charges qui gouvernent le dimensionnement
 * de la quasi-totalité des charpentes : les porter au jugé, c'est décider du
 * tonnage au jugé. Elles se déduisent exactement de la commune — région de
 * neige, région de vent, catégorie de terrain, altitude — quatre données qui,
 * elles, se vérifient sur une carte.
 *
 * Le mode MANUEL reste le défaut, et c'est délibéré : un fichier enregistré
 * avant ce module n'a pas de site, et ses charges ne doivent pas changer sous
 * son auteur au premier rechargement.
 */
export function SiteFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const site = project.site;
  const eurocode = site.mode === 'eurocode';
  const c = eurocode ? chargesClimatiques(project) : null;

  return (
    <div className="fiche">
      <h3>Site et charges climatiques</h3>
      <dl className="paires">
        <dt>Origine des charges</dt>
        <dd>
          <ChampChoix
            valeur={site.mode}
            options={[
              ['manuel', 'saisies à la main'],
              ['eurocode', 'calculées (EN 1991-1-3 / 1-4)'],
            ]}
            onChange={(v) =>
              edit('Origine des charges climatiques', (d) => {
                d.site.mode = v as typeof site.mode;
              })
            }
          />
        </dd>

        {eurocode && c && (
          <>
            <dt>Région de neige</dt>
            <dd>
              <ChampChoix<ZoneNeige>
                valeur={site.zoneNeige}
                options={ZONES_NEIGE.map((z) => [z, z] as const)}
                onChange={(v) => edit('Région de neige', (d) => void (d.site.zoneNeige = v))}
              />
            </dd>
            <dt>Altitude</dt>
            <dd>
              <ChampNombre
                valeur={site.altitude}
                pas={50}
                min={0}
                unite="m"
                onChange={(v) => edit('Altitude', (d) => void (d.site.altitude = v))}
              />
            </dd>
            <dt>— neige au sol sk</dt>
            <dd className="derive">{num(c.neige.sol.sk, 2)} kN/m²</dd>
            <dt>— coefficient de forme µ1</dt>
            <dd className="derive">{num(c.neige.mu1, 2)}</dd>
            <dt>— neige en toiture</dt>
            <dd className="derive">
              <strong>{num(c.valeurs.neige, 2)} kN/m²</strong>
            </dd>
            {c.neige.sAccidentelle > 0 && (
              <>
                <dt>— neige accidentelle</dt>
                <dd className="derive">{num(c.valeurs.neigeAccidentelle, 2)} kN/m²</dd>
              </>
            )}

            <dt>Région de vent</dt>
            <dd>
              <ChampChoix<ZoneVent>
                valeur={site.zoneVent}
                options={ZONES_VENT.map((z) => [z, `région ${z}`] as const)}
                onChange={(v) => edit('Région de vent', (d) => void (d.site.zoneVent = v))}
              />
            </dd>
            <dt>Catégorie de terrain</dt>
            <dd>
              <ChampChoix<CategorieTerrain>
                valeur={site.terrain}
                options={TERRAINS.map((t) => [t, LIBELLE_TERRAIN[t]] as const)}
                onChange={(v) => edit('Catégorie de terrain', (d) => void (d.site.terrain = v))}
              />
            </dd>
            <dt>— vitesse de référence vb</dt>
            <dd className="derive">{num(c.vent.vb, 0)} m/s</dd>
            <dt>— hauteur de référence ze</dt>
            <dd className="derive">{num(c.vent.ze, 1)} m</dd>
            <dt>— pression de pointe qp</dt>
            <dd className="derive">
              <strong>{num(c.vent.qp, 3)} kN/m²</strong>
            </dd>
            <dt>— paroi au vent cpe,D</dt>
            <dd className="derive">{num(c.paroi.D, 2)}</dd>
            {/*
              ⚠ La succion de rive (zone F) vaut deux à trois fois celle de la
              partie courante. C'est elle qui arrache le bac et qui décide de
              l'ancrage : elle doit être VISIBLE, pas noyée dans une moyenne.
            */}
            <dt>— toiture, succion de rive (F)</dt>
            <dd className="derive">{num(c.toiture.F[0], 2)}</dd>
            <dt>— toiture, succion courante (H)</dt>
            <dd className="derive">{num(c.toiture.H[0], 2)}</dd>
            <dt>Pression retenue — lisses, potelets</dt>
            <dd className="derive">
              <strong>{num(c.valeurs.ventPression, 2)} kN/m²</strong>
            </dd>
            <dt>Dépression retenue — pannes (rive G)</dt>
            <dd className="derive">
              <strong>{num(c.valeurs.ventDepression, 2)} kN/m²</strong>
            </dd>
          </>
        )}
      </dl>

      {eurocode && (
        <p style={{ marginTop: 8, opacity: 0.75, fontSize: '0.9em' }}>
          Les portiques reçoivent le vent zone par zone, en huit cas (travers dans les deux
          sens, pignon ; pression intérieure +0,2 et −0,3). Les deux valeurs ci-dessus servent
          à l’ossature secondaire.
          {project.grid.roofType === 'bipente' && ' La neige est aussi examinée réduite de moitié sur un versant.'}
        </p>
      )}
      {!eurocode && (
        <p style={{ marginTop: 8, opacity: 0.75, fontSize: '0.9em' }}>
          Les valeurs de neige et de vent saisies dans « Charges et critères » sont employées
          telles quelles : le logiciel ne les vérifie pas.
        </p>
      )}
    </div>
  );
}
