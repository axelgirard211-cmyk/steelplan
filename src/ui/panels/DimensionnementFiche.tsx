import { useEffect, useRef, useState } from 'react';
import { MOTIFS, type Proposition } from '../../core/checks/dimensionner';
import { dimensionnerEnFond, type Avancement } from '../dimensionnerEnFond';
import { FAMILY_LABELS } from '../../core/catalog/index';
import { useProjectStore } from '../../state/store';
import { num } from '../format';

/**
 * DIMENSIONNEMENT AUTOMATIQUE.
 *
 * ⚠ La proposition est PRÉSENTÉE avant d'être appliquée, jamais appliquée
 * d'office. Un logiciel qui change huit profils d'un coup sans les montrer
 * demande une confiance qu'il n'a pas méritée — et l'utilisateur n'a alors aucun
 * moyen de savoir si le résultat vient de son jugement ou d'un automatisme.
 *
 * Chaque ligne porte son MOTIF : allégement, renfort, ou barre trop élancée pour
 * être montée. Sans lui, une ligne qui alourdit une pièce déjà vérifiée paraît
 * arbitraire, et c'est toute la proposition qu'on cesse de croire.
 */
export function DimensionnementFiche(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const [prop, setProp] = useState<Proposition | null>(null);
  const [calcul, setCalcul] = useState(false);
  const [avancement, setAvancement] = useState<Avancement | null>(null);
  const [changerDeFamille, setChangerDeFamille] = useState(false);
  const interrompre = useRef<(() => void) | null>(null);
  // Quitter l'onglet interrompt une recherche en cours : personne ne la lirait.
  useEffect(() => () => interrompre.current?.(), []);

  const lancer = (): void => {
    setCalcul(true);
    setAvancement(null);
    // À côté de l'interface : l'écran reste vivant et suit l'avancement.
    const tache = dimensionnerEnFond(project, { changerDeFamille }, setAvancement);
    interrompre.current = tache.interrompre;
    tache.resultat
      .then(setProp)
      .catch(() => undefined)
      .finally(() => {
        setCalcul(false);
        interrompre.current = null;
      });
  };

  const appliquer = (p: Proposition): void => {
    // Une seule entrée d'historique : un Ctrl+Z doit défaire TOUTE la
    // proposition, pas un profil sur huit.
    edit('Dimensionnement automatique', (d) => {
      // Seuls les PROFILS changent : la proposition ne touche ni la trame, ni les
      // charges, ni les assemblages. Écrire les sous-objets entiers ferait perdre
      // toute modification que l'utilisateur aurait faite pendant la recherche.
      d.frame.columnProfile = p.projet.frame.columnProfile;
      d.frame.rafterProfile = p.projet.frame.rafterProfile;
      d.truss.topChordProfile = p.projet.truss.topChordProfile;
      d.truss.bottomChordProfile = p.projet.truss.bottomChordProfile;
      d.truss.postProfile = p.projet.truss.postProfile;
      d.truss.diagonalProfile = p.projet.truss.diagonalProfile;
      d.secondary.purlins.profile = p.projet.secondary.purlins.profile;
      d.secondary.rails.profile = p.projet.secondary.rails.profile;
      // Les chevêtres suivent les lisses : même hauteur imposée.
      d.ouvertures.profile = p.projet.ouvertures.profile;
      d.secondary.gablePosts.profile = p.projet.secondary.gablePosts.profile;
      d.bracing.roof.profile = p.projet.bracing.roof.profile;
      d.bracing.wall.profile = p.projet.bracing.wall.profile;
      d.bracing.gable.profile = p.projet.bracing.gable.profile;
    });
    setProp(null);
  };

  return (
    <div className="fiche">
      <h3>Dimensionnement automatique</h3>
      <p style={{ margin: '0 0 10px', opacity: 0.8 }}>
        Cherche, pour chaque poste, le profil le plus léger dont tous les taux restent sous 1,00.
        Recherche gloutonne : l’ossature secondaire d’abord, les poteaux en dernier.
      </p>

      <label className="etiquette" style={{ display: 'block', margin: '0 0 8px' }}>
        <input
          type="checkbox"
          checked={changerDeFamille}
          onChange={(e) => {
            setChangerDeFamille(e.target.checked);
            setProp(null);
          }}
        />{' '}
        Autoriser un changement de famille (tube rond → tube carré, HEA → IPE…)
      </label>

      <button type="button" className="plat" onClick={lancer} disabled={calcul}>
        {calcul ? 'Recherche en cours…' : 'Rechercher les profils les plus légers'}
      </button>
      {calcul && (
        <span className="avancement">
          <progress max={avancement?.total ?? 1} value={avancement?.fait ?? 0} />{' '}
          {avancement ? `${avancement.libelle} — ${avancement.fait} / ${avancement.total}` : 'Préparation…'}{' '}
          <button type="button" className="plat" onClick={() => interrompre.current?.()}>
            Interrompre
          </button>
        </span>
      )}

      {prop && <Resultat prop={prop} onAppliquer={() => appliquer(prop)} onAnnuler={() => setProp(null)} />}
      {prop === null && !calcul && (
        <p style={{ marginTop: 10, opacity: 0.65, fontSize: '0.9em' }}>
          Rien n’est modifié tant que la proposition n’est pas appliquée.
        </p>
      )}
    </div>
  );
}

function Resultat({
  prop,
  onAppliquer,
  onAnnuler,
}: {
  prop: Proposition;
  onAppliquer: () => void;
  onAnnuler: () => void;
}): JSX.Element {
  const gain = prop.masseApres - prop.masseAvant;
  const pct = prop.masseAvant > 0 ? (gain / prop.masseAvant) * 100 : 0;

  if (prop.changements.length === 0) {
    return (
      <p style={{ marginTop: 12, color: 'var(--ok)' }}>
        Aucun profil plus léger ne tient : le dimensionnement actuel est déjà au plus juste.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <table className="nomenclature">
        <thead>
          <tr>
            <th>Poste</th>
            <th>Actuel</th>
            <th>Proposé</th>
            <th className="nombre">Taux</th>
            <th className="nombre">kg/m</th>
            <th>Motif</th>
          </tr>
        </thead>
        <tbody>
          {prop.changements.map((c) => (
            <tr key={c.poste}>
              <td>{c.poste}</td>
              <td>{c.avant}</td>
              <td>
                <strong>{c.apres}</strong>
              </td>
              <td className="nombre">
                {num(c.tauxAvant, 2)} → {num(c.tauxApres, 2)}
              </td>
              <td className="nombre" style={c.deltaKgParM > 0 ? { color: 'var(--alerte)' } : undefined}>
                {c.deltaKgParM > 0 ? '+' : ''}
                {num(c.deltaKgParM, 1)}
              </td>
              <td>
                {MOTIFS[c.motif]}
                {/* ⚠ Une autre famille, c'est un autre assemblage : à dire, pas à taire. */}
                {c.familleApres !== c.familleAvant && (
                  <div style={{ fontSize: '0.9em', color: 'var(--alerte)' }}>
                    change de famille : {FAMILY_LABELS[c.familleAvant]} → {FAMILY_LABELS[c.familleApres]} —
                    assemblages à reprendre
                  </div>
                )}
                {c.entraine && <div className="note" style={{ fontSize: '0.9em' }}>entraîne les {c.entraine}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="paires" style={{ marginTop: 10 }}>
        <dt>Masse de l’ouvrage</dt>
        <dd>
          {num(prop.masseAvant, 0)} → <strong>{num(prop.masseApres, 0)} kg</strong> ({pct > 0 ? '+' : ''}
          {num(pct, 1)} %)
        </dd>
        <dt>Taux de travail maximal obtenu</dt>
        <dd className={prop.tauxMax > 1 ? 'alerte' : ''}>{num(prop.tauxMax, 2)}</dd>
        <dt>Modèles construits et vérifiés</dt>
        <dd className="derive">
          {prop.evaluations} en {num(prop.ms, 0)} ms
        </dd>
      </dl>

      {prop.insuffisants.length > 0 && (
        <ul className="anomalies">
          <li className="erreur">
            Aucun profil du catalogue ne tient pour : {prop.insuffisants.join(', ')}. Revoir la
            portée, l’entraxe ou les charges.
          </li>
        </ul>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" onClick={onAppliquer}>
          Appliquer la proposition
        </button>
        <button type="button" className="plat" onClick={onAnnuler}>
          Ignorer
        </button>
      </div>
    </div>
  );
}
