import {
  designationFinition,
  epaisseurTotale,
  zincExigible,
  type PreparationSurface,
  type TypeFinition,
} from '../../core/model/finition';
import { useStructuralModel } from '../../state/derived';
import { useProjectStore } from '../../state/store';
import { num } from '../format';

/**
 * TRAITEMENT DE SURFACE.
 *
 * ⚠ Dernier poste de l'atelier, et longtemps le seul que le dossier ne portait
 * pas : les pièces sortaient débitées, percées, assemblées, soudées — puis
 * partaient au traitement sans qu'aucun document ne dise lequel. Le peintre a
 * besoin de trois choses que personne d'autre ne peut lui donner : le degré de
 * préparation, le système et ses épaisseurs, la surface à traiter.
 *
 * Ce qui est saisi ici part directement dans la GAMME de chaque plan de
 * fabrication : une seule source, aucune consigne de peinture à recopier.
 */

const TYPES: readonly { id: TypeFinition; libelle: string }[] = [
  { id: 'peinture', libelle: 'Peinture (EN ISO 12944)' },
  { id: 'galvanisation', libelle: 'Galvanisation à chaud (EN ISO 1461)' },
  { id: 'brut', libelle: 'Acier brut — aucun traitement' },
];

const PREPARATIONS: readonly PreparationSurface[] = ['Sa 3', 'Sa 2½', 'Sa 2', 'St 3', 'St 2'];
const CATEGORIES = ['C1', 'C2', 'C3', 'C4', 'C5'] as const;

export function FinitionFiche(): JSX.Element {
  const f = useProjectStore((s) => s.project.finition);
  const edit = useProjectStore((s) => s.edit);
  const model = useStructuralModel();

  return (
    <div className="fiche">
      <h3>Traitement de surface</h3>
      <dl className="paires">
        <dt>Nature</dt>
        <dd>
          <select
            value={f.type}
            onChange={(e) =>
              edit('Traitement de surface', (d) => {
                d.finition.type = e.target.value as TypeFinition;
              })
            }
          >
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.libelle}
              </option>
            ))}
          </select>
        </dd>

        {f.type === 'peinture' && (
          <>
            <dt>Préparation</dt>
            <dd>
              <select
                value={f.preparation}
                onChange={(e) =>
                  edit('Préparation de surface', (d) => {
                    d.finition.preparation = e.target.value as PreparationSurface;
                  })
                }
              >
                {PREPARATIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </dd>
            <dt>Corrosivité</dt>
            <dd>
              <select
                value={f.categorie}
                onChange={(e) =>
                  edit('Catégorie de corrosivité', (d) => {
                    d.finition.categorie = e.target.value as (typeof CATEGORIES)[number];
                  })
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </dd>
            {f.couches.map((c, i) => (
              <Couche key={c.nom} index={i} />
            ))}
            <dt>Épaisseur totale</dt>
            <dd className="derive">{epaisseurTotale(f)} µm</dd>
          </>
        )}

        {f.type === 'galvanisation' && (
          <>
            <dt>Zinc annoncé</dt>
            <dd>
              <input
                type="number"
                value={f.zincMicrons}
                step={5}
                min={45}
                style={{ width: 82, textAlign: 'right' }}
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    edit('Épaisseur de zinc', (d) => void (d.finition.zincMicrons = v));
                  }
                }}
              />{' '}
              µm
            </dd>
            {/*
              ⚠ L'épaisseur exigible dépend de celle de l'ACIER : annoncer une
              valeur unique promettrait au galvanisateur quelque chose qu'il ne
              peut pas tenir sur les pièces minces.
            */}
            <dt>Exigible sur ≥ 6 mm</dt>
            <dd className="derive">{zincExigible(6)} µm</dd>
            <dt>Exigible sous 3 mm</dt>
            <dd className="derive">{zincExigible(2)} µm</dd>
          </>
        )}

        <dt>Surface de l’ouvrage</dt>
        <dd className="derive">{num(model.stats.paintM2, 0)} m²</dd>
        <dt>Désignation portée aux plans</dt>
        <dd className="derive">{designationFinition(f)}</dd>
        <dt>Consigne</dt>
        <dd>
          <input
            type="text"
            value={f.note}
            style={{ width: '100%' }}
            onChange={(e) =>
              edit('Consigne de traitement', (d) => void (d.finition.note = e.target.value))
            }
          />
        </dd>
      </dl>
    </div>
  );
}

/** Une couche du système : son épaisseur sèche et sa teinte. */
function Couche({ index }: { index: number }): JSX.Element {
  const couche = useProjectStore((s) => s.project.finition.couches[index]);
  const edit = useProjectStore((s) => s.edit);
  if (!couche) return <></>;

  return (
    <>
      <dt>{couche.nom}</dt>
      <dd>
        <input
          type="number"
          value={couche.epaisseur}
          step={10}
          min={0}
          style={{ width: 62, textAlign: 'right' }}
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0) {
              edit(`Épaisseur ${couche.nom}`, (d) => {
                const c = d.finition.couches[index];
                if (c) c.epaisseur = v;
              });
            }
          }}
        />{' '}
        µm{' '}
        <input
          type="text"
          value={couche.ral}
          placeholder="RAL"
          style={{ width: 78 }}
          onChange={(e) =>
            edit(`Teinte ${couche.nom}`, (d) => {
              const c = d.finition.couches[index];
              if (c) c.ral = e.target.value;
            })
          }
        />
      </dd>
    </>
  );
}
