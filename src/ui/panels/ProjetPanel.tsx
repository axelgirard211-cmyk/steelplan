import { useMemo, useState } from 'react';
import {
  buildingLength,
  footprintArea,
  leftSlopeRad,
  rafterLength,
  ridgeHeight,
  ridgeY,
  roofArea,
} from '../../core/model/grid';
import { deserializeProject, serializeProject } from '../../core/io/serialize';
import { rubriqueDe } from '../../core/model/validate';
import { AssemblagesFiche } from './AssemblagesFiche';
import { BarresLibresFiche } from './BarresLibresFiche';
import { CartoucheFiche } from './CartoucheFiche';
import { ChargesFiche } from './ChargesFiche';
import { ContreventementFiche } from './ContreventementFiche';
import { FinitionFiche } from './FinitionFiche';
import { AtelierFiche } from './AtelierFiche';
import { PortiqueFiche } from './PortiqueFiche';
import { OuverturesFiche } from './OuverturesFiche';
import { SecondaireFiche } from './SecondaireFiche';
import { SiteFiche } from './SiteFiche';
import { StructureFiche } from './StructureFiche';
import { useProjectStore } from '../../state/store';
import { ChampNombre } from '../champs';
import { metres, mm, num } from '../format';
import { rad2deg } from '../../core/math/tolerance';

/**
 * Écran de contrôle du modèle : montre côte à côte les PARAMÈTRES saisis et les
 * GRANDEURS DÉDUITES. Toute valeur en bleu est recalculée à chaque frappe — elle
 * n'est stockée nulle part. C'est le principe qui tient pour la 3D et les
 * plans : une seule source, des projections.
 *
 * ⚠ Ce panneau n'assemble que des fiches. Chacune vit dans son propre fichier
 * parce qu'elles n'ont rien à partager : mêlées ici, elles formaient un écran de
 * cinq cents lignes où l'on n'osait plus rien ajouter — et c'est exactement pour
 * ça que les profils sont restés en lecture seule si longtemps.
 */
export function ProjetPanel(): JSX.Element {
  const issues = useProjectStore((s) => s.issues);
  const erreurs = issues.filter((i) => i.level === 'erreur');
  const avertissements = issues.filter((i) => i.level === 'avertissement');

  return (
    <section className="principal">
      <div className="grille-fiches">
        <TrameFiche />
        <TrameDeduite />
        <StructureFiche />
        <PortiqueFiche />
        <SecondaireFiche />
        <OuverturesFiche />
        <ContreventementFiche />
        <AssemblagesFiche />
        <SiteFiche />
        <ChargesFiche />
        <FinitionFiche />
        <AtelierFiche />

        <div className="fiche">
          <h3>
            Contrôle du modèle{' '}
            {erreurs.length === 0 && avertissements.length === 0 ? '— conforme' : ''}
          </h3>
          {issues.length === 0 ? (
            <p className="aucune-anomalie">Aucune anomalie détectée.</p>
          ) : (
            <ul className="anomalies">
              {[...erreurs, ...avertissements].map((i, k) => (
                <li key={`${i.path}-${k}`} className={i.level}>
                  <span className="rubrique">{rubriqueDe(i.path)}</span>
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <BarresLibresFiche />
      <CartoucheFiche />
      <FicheFichier />
    </section>
  );
}

/* ------------------------------------------------------------------ */

function TrameFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const g = project.grid;

  return (
    <div className="fiche">
      <h3>Trame — paramètres</h3>
      <dl className="paires">
        <dt>Travées</dt>
        <dd>
          <ChampNombre
            valeur={g.nBays}
            pas={1}
            min={1}
            onChange={(v) => edit('Nombre de travées', (d) => void (d.grid.nBays = Math.round(v)))}
          />
        </dd>
        <dt>Entraxe des portiques</dt>
        <dd>
          <ChampNombre
            valeur={g.baySpacing / 1000}
            pas={0.5}
            unite="m"
            onChange={(v) => edit('Entraxe', (d) => void (d.grid.baySpacing = v * 1000))}
          />
        </dd>
        <dt>Portée</dt>
        <dd>
          <ChampNombre
            valeur={g.span / 1000}
            pas={0.5}
            unite="m"
            onChange={(v) => edit('Portée', (d) => void (d.grid.span = v * 1000))}
          />
        </dd>
        <dt>Hauteur à l’égout</dt>
        <dd>
          <ChampNombre
            valeur={g.eaveHeight / 1000}
            pas={0.25}
            unite="m"
            onChange={(v) => edit('Hauteur égout', (d) => void (d.grid.eaveHeight = v * 1000))}
          />
        </dd>
        <dt>Pente</dt>
        <dd>
          <ChampNombre
            valeur={g.slope}
            pas={1}
            unite={g.slopeUnit === 'degres' ? '°' : '%'}
            onChange={(v) => edit('Pente', (d) => void (d.grid.slope = v))}
          />
        </dd>
      </dl>
    </div>
  );
}

function TrameDeduite(): JSX.Element {
  const g = useProjectStore((s) => s.project.grid);
  /*
   * ⚠ Pendant une saisie invalide, ces grandeurs se calculaient sur la valeur
   * fautive : une portée négative donnait une emprise de −600 m², affichée
   * comme un résultat. Tant que la trame est fausse, rien n'en est déduit.
   */
  const trameFausse = useProjectStore((s) => s.issues.some((i) => i.level === 'erreur' && i.path.startsWith('grid.')));
  const v = (texte: () => string): string => (trameFausse ? '—' : texte());
  return (
    <div className="fiche">
      <h3>Trame — grandeurs déduites</h3>
      <dl className="paires">
        <dt>Hauteur au faîtage</dt>
        <dd className="derive">{v(() => `${metres(ridgeHeight(g))} m`)}</dd>
        <dt>Position du faîtage</dt>
        <dd className="derive">{v(() => `${metres(ridgeY(g))} m`)}</dd>
        <dt>Pente</dt>
        <dd className="derive">{v(() => `${num(rad2deg(leftSlopeRad(g)), 2)} °`)}</dd>
        <dt>Rampant gauche</dt>
        <dd className="derive">{v(() => `${mm(rafterLength(g, 'gauche'))} mm`)}</dd>
        <dt>Rampant droit</dt>
        <dd className="derive">{v(() => `${mm(rafterLength(g, 'droite'))} mm`)}</dd>
        <dt>Longueur du bâtiment</dt>
        <dd className="derive">{v(() => `${metres(buildingLength(g))} m`)}</dd>
        <dt>Emprise au sol</dt>
        <dd className="derive">{v(() => `${num(footprintArea(g), 1)} m²`)}</dd>
        <dt>Toiture développée</dt>
        <dd className="derive">{v(() => `${num(roofArea(g), 1)} m²`)}</dd>
      </dl>
      {trameFausse && (
        <p className="note" style={{ margin: '8px 0 0' }}>
          Trame invalide : corrigez les paramètres signalés pour retrouver ces grandeurs.
        </p>
      )}
    </div>
  );
}

/** Vérification du format de fichier : aller-retour complet, en direct. */
function FicheFichier(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const [visible, setVisible] = useState(false);

  const texte = useMemo(() => serializeProject(project), [project]);
  const controle = useMemo(() => {
    try {
      const relu = serializeProject(deserializeProject(texte).project);
      return relu === texte
        ? { ok: true, message: `Aller-retour sans perte (${(texte.length / 1024).toFixed(1)} ko).` }
        : { ok: false, message: 'Le projet relu diffère du projet enregistré.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }, [texte]);

  return (
    <div className="fiche" style={{ marginTop: 14 }}>
      <h3>Fichier projet (.steelplan)</h3>
      <ul className="anomalies" style={{ marginBottom: 10 }}>
        <li
          className={controle.ok ? '' : 'erreur'}
          style={controle.ok ? { color: 'var(--ok)' } : undefined}
        >
          {controle.message}
        </li>
      </ul>
      <button type="button" className="plat" onClick={() => setVisible((v) => !v)}>
        {visible ? 'Masquer' : 'Afficher'} le contenu du fichier
      </button>
      {visible && (
        <pre className="json" style={{ marginTop: 10 }}>
          {texte}
        </pre>
      )}
    </div>
  );
}
