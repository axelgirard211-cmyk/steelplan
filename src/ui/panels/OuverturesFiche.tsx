import { ouverturesRefusees } from '../../core/build/secondaire/ouvertures';
import {
  FACES_OUVERTURE,
  LIBELLE_FACE,
  LIBELLE_TYPE,
  longueurFacade,
  type FaceOuverture,
  type Ouverture,
  type TypeOuverture,
} from '../../core/model/ouvertures';
import { useProjectStore } from '../../state/store';
import { Bascule, ChampNuance, ChampProfil } from '../champs';
import { num } from '../format';

/**
 * OUVERTURES DE FAÇADE — portails, portes et châssis.
 *
 * ⚠ Une ouverture n'est pas un trou dans le bardage : c'est une interruption de
 * l'ossature. Les lisses qu'elle traverse s'arrêtent à ses jambages, et un
 * CHEVÊTRE — deux montants, un linteau, une traverse basse s'il y a une allège —
 * reprend ce qu'elles portaient. Tout cela est posé automatiquement ; on ne
 * saisit ici que le vide.
 *
 * ⚠⚠ Les ouvertures REFUSÉES sont affichées avec leur raison. Une ouverture
 * demandée qui n'apparaît nulle part — ni sur le plan, ni dans un message — se
 * découvre sur le chantier, quand le bardage est posé plein là où le portail
 * devait être.
 */
export function OuverturesFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const o = project.ouvertures;
  const refus = new Map(
    ouverturesRefusees(project).map((r) => [r.ouverture.id, r.raison] as const),
  );

  const ajouter = (): void => {
    edit('Ajouter une ouverture', (d) => {
      d.ouvertures.items.push(nouvelle(d.ouvertures.items, d.grid.baySpacing));
      d.ouvertures.enabled = true;
    });
  };

  const supprimer = (id: string): void => {
    edit(`Supprimer ${id}`, (d) => {
      const i = d.ouvertures.items.findIndex((x) => x.id === id);
      if (i >= 0) d.ouvertures.items.splice(i, 1);
    });
  };

  const maj = <K extends keyof Ouverture>(id: string, champ: K, v: Ouverture[K]): void => {
    edit(`${id} — ${champ}`, (d) => {
      const x = d.ouvertures.items.find((y) => y.id === id);
      if (x) x[champ] = v;
    });
  };

  return (
    <div className="fiche">
      <h3>Ouvertures — portails, portes et châssis</h3>

      <dl className="paires">
        <dt>Poser les ouvertures</dt>
        <dd>
          <Bascule
            valeur={o.enabled}
            onChange={(v) => edit('Ouvertures', (d) => void (d.ouvertures.enabled = v))}
          />
        </dd>
        <dt>Profil du chevêtre</dt>
        <dd>
          <ChampProfil
            valeur={o.profile}
            onChange={(v) => edit('Profil de chevêtre', (d) => void (d.ouvertures.profile = v))}
          />
        </dd>
        <dt>Nuance</dt>
        <dd>
          <ChampNuance
            valeur={o.grade}
            onChange={(v) => edit('Nuance de chevêtre', (d) => void (d.ouvertures.grade = v))}
          />
        </dd>
      </dl>

      {o.items.length > 0 && (
        <div className="tableau-enveloppe">
          <table className="profils">
            <thead>
              <tr>
                <th className="designation">Repère</th>
                <th>Façade</th>
                <th>Nature</th>
                <th className="nombre">Position</th>
                <th className="nombre">Largeur</th>
                <th className="nombre">Hauteur</th>
                <th className="nombre">Allège</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {o.items.map((x) => {
                const raison = refus.get(x.id);
                return (
                  <tr key={x.id} className={raison ? 'anomalie' : undefined}>
                    <td className="designation">{x.id}</td>
                    <td>
                      <select
                        value={x.face}
                        onChange={(e) => maj(x.id, 'face', e.target.value as FaceOuverture)}
                      >
                        {FACES_OUVERTURE.map((f) => (
                          <option key={f} value={f}>
                            {LIBELLE_FACE[f]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={x.type}
                        onChange={(e) => maj(x.id, 'type', e.target.value as TypeOuverture)}
                      >
                        {(['portail', 'porte', 'chassis'] as const).map((t) => (
                          <option key={t} value={t}>
                            {LIBELLE_TYPE[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    {(['position', 'largeur', 'hauteur', 'allege'] as const).map((champ) => (
                      <td key={champ} className="nombre">
                        <Mm valeur={x[champ]} onChange={(v) => maj(x.id, champ, v)} />
                      </td>
                    ))}
                    <td>
                      <button type="button" className="plat" onClick={() => supprimer(x.id)}>
                        Supprimer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p>
        <button type="button" className="plat" onClick={ajouter}>
          Ajouter une ouverture
        </button>
        {o.items.length > 0 && (
          <span className="compte">
            {' '}
            façade la plus longue : {num(longueurFacade(project.grid, 'long-pan-gauche') / 1000, 2)} m
          </span>
        )}
      </p>

      {refus.size > 0 && (
        <ul className="anomalies">
          {[...refus].map(([id, raison]) => (
            <li key={id} className="error">
              <span className="chemin">{id}</span>
              {raison} — cette ouverture n’est ni percée ni dessinée.
            </li>
          ))}
        </ul>
      )}

      <p className="note">
        Les lisses traversées sont coupées à leurs jambages et un chevêtre les reprend : deux
        montants montant jusqu’à la première lisse continue au-dessus du linteau, un linteau, et
        une traverse basse s’il y a une allège. Position et allège se mesurent depuis l’origine de
        la façade et depuis le sol, en millimètres. SteelPlan ne choisit pas la menuiserie et ne
        vérifie pas l’ancrage du dormant.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Ouverture neuve : une porte au quart de la façade, repère non employé. */
function nouvelle(existantes: readonly Ouverture[], entraxe: number): Ouverture {
  let n = existantes.length + 1;
  while (existantes.some((x) => x.id === `OU${n}`)) n += 1;
  return {
    id: `OU${n}`,
    face: 'long-pan-gauche',
    type: 'porte',
    // Au milieu de la première travée : entre deux poteaux, jamais devant.
    position: Math.round((entraxe / 2 - 600) / 100) * 100,
    largeur: 1200,
    hauteur: 2100,
    allege: 0,
  };
}

function Mm({
  valeur,
  onChange,
}: {
  valeur: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <input
      type="number"
      step={100}
      value={valeur}
      style={{ width: 76, textAlign: 'right' }}
      onWheel={(e) => e.currentTarget.blur()}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  );
}
