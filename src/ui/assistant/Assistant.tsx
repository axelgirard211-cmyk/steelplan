import { produce, type Draft } from 'immer';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildProject } from '../../core/build/buildProject';
import { dimensionnerEnFond, type Avancement } from '../dimensionnerEnFond';
import { runChecks } from '../../core/checks/index';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import { buildingLength } from '../../core/model/grid';
import type { ProjectParams } from '../../core/model/project';
import { TEMPLATES } from '../../core/model/templates';
import { rubriqueDe, validateProject } from '../../core/model/validate';
import { marquerLesAides } from '../champs';
import { mm, num } from '../format';
import { Modale } from '../Modale';
import { EtapeBatiment, EtapeCharges, EtapeDimensions, EtapeOssature } from './etapes';
import '../theme/assistant.css';

/**
 * ASSISTANT DE DÉMARRAGE — un nouveau projet en cinq étapes.
 *
 * ⚠ Un nouveau projet ouvrait les seize fiches de l'onglet Projet d'un coup :
 * cent quarante champs, sans savoir lesquels comptent pour commencer. L'assistant
 * pose les questions dans l'ordre où un bureau d'études les tranche — le type
 * de bâtiment, ses dimensions, son ossature, son site — et laisse au gabarit
 * tout le reste. Chaque étape est contrôlée avant de passer à la suivante, et
 * le projet n'est créé qu'à la fin : jusque-là, le projet ouvert reste intact.
 */

interface Etape {
  readonly titre: string;
  /** Racines des paramètres que l'étape fait saisir : leurs erreurs la bloquent. */
  readonly racines: readonly string[];
}

const ETAPES: readonly Etape[] = [
  { titre: 'Bâtiment', racines: ['meta'] },
  { titre: 'Dimensions', racines: ['grid', 'frame', 'truss'] },
  { titre: 'Ossature', racines: ['secondary', 'bracing'] },
  { titre: 'Charges', racines: ['loads', 'site'] },
  { titre: 'Récapitulatif', racines: [] },
];

export function Assistant({
  travauxEnCours,
  onCreer,
  onFermer,
}: {
  travauxEnCours: number;
  /** `remarque` : ce que l'utilisateur doit savoir du projet créé (profils insuffisants…). */
  onCreer: (p: ProjectParams, remarque?: string) => void;
  onFermer: () => void;
}): JSX.Element {
  const [gabarit, setGabarit] = useState(TEMPLATES[0]?.id ?? 'vierge');
  const [p, setP] = useState<ProjectParams>(() => TEMPLATES[0]?.build() ?? DEFAULT_PROJECT);
  const [n, setN] = useState(0);
  const [dimensionnerAuto, setDimensionnerAuto] = useState(true);
  const [calcul, setCalcul] = useState(false);
  const [avancement, setAvancement] = useState<Avancement | null>(null);
  const [echec, setEchec] = useState<string | null>(null);
  const corps = useRef<HTMLDivElement>(null);
  /*
   * ⚠ Fermer l'assistant pendant le dimensionnement ne l'arrêtait pas : le
   * calcul finissait en fond et REMPLAÇAIT le projet ouvert, fenêtre fermée,
   * sans un mot. Fermer interrompt désormais le calcul.
   */
  const interrompre = useRef<(() => void) | null>(null);
  const arreterCalcul = (): void => {
    const f = interrompre.current;
    interrompre.current = null; // le calcul rejeté saura qu'on l'a voulu
    f?.();
  };
  useEffect(() => arreterCalcul, []);
  const fermer = (): void => {
    arreterCalcul();
    onFermer();
  };

  const maj = (recette: (d: Draft<ProjectParams>) => void): void => setP((x) => produce(x, recette));

  const choisirGabarit = (id: string): void => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setGabarit(id);
    // Le nom, le client et le chantier déjà tapés survivent au changement de gabarit.
    setP((x) => ({ ...t.build(), meta: { ...t.build().meta, nom: x.meta.nom, client: x.meta.client, chantier: x.meta.chantier } }));
  };

  const erreurs = useMemo(() => validateProject(p).filter((i) => i.level === 'erreur'), [p]);
  const etape = ETAPES[n] as Etape;
  const bloquantes = n === ETAPES.length - 1 ? erreurs : erreurs.filter((i) => etape.racines.some((r) => i.path === r || i.path.startsWith(`${r}.`)));

  // Les aides des paramètres, comme dans l'onglet Projet.
  useEffect(() => {
    if (corps.current) marquerLesAides(corps.current);
  });

  const creer = (): void => {
    if (!dimensionnerAuto) {
      onCreer(p);
      return;
    }
    setCalcul(true);
    setEchec(null);
    // À côté de l'interface : la fenêtre reste vivante et dit où en est la recherche.
    // Profils, puis assemblages : le projet créé sort vérifié jusqu'aux platines.
    const tache = dimensionnerEnFond(p, { assemblages: true }, setAvancement);
    interrompre.current = tache.interrompre;
    tache.resultat
      .then((r) =>
        onCreer(
          r.projet,
          r.insuffisants.length > 0
            ? `${r.insuffisants.length} élément(s) ne tiennent pas même avec le plus fort profil de leur famille (${r.insuffisants.join(', ')}) : voir l’onglet Vérifications.`
            : undefined,
        ),
      )
      .catch((e: unknown) => {
        // Interrompu par la fermeture : rien à dire, la fenêtre n'est plus là.
        if (interrompre.current === null) return;
        setEchec(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        interrompre.current = null;
        setCalcul(false);
      });
  };

  return (
    <Modale titre="Nouveau projet — assistant" onFermer={fermer} large fermerAuClic={false}>
      <ol className="assistant-etapes" aria-label="Étapes">
        {ETAPES.map((e, i) => (
          <li key={e.titre} aria-current={i === n ? 'step' : undefined} className={i < n ? 'faite' : ''}>
            <button type="button" onClick={() => i < n && setN(i)} disabled={i > n}>
              <span className="numero">{i + 1}</span> {e.titre}
            </button>
          </li>
        ))}
      </ol>

      <div ref={corps} className="assistant-corps">
        {n === 0 && <EtapeBatiment p={p} maj={maj} gabarit={gabarit} choisirGabarit={choisirGabarit} />}
        {n === 1 && <EtapeDimensions p={p} maj={maj} />}
        {n === 2 && <EtapeOssature p={p} maj={maj} />}
        {n === 3 && <EtapeCharges p={p} maj={maj} />}
        {n === 4 && <Recapitulatif p={p} dimensionnerAuto={dimensionnerAuto} setDimensionnerAuto={setDimensionnerAuto} />}

        {/* Région toujours présente : l'apparition d'une erreur est annoncée. */}
        <div role="alert">
        {bloquantes.length > 0 && (
          <ul className="anomalies" style={{ marginTop: 10 }}>
            {bloquantes.map((i) => (
              <li key={i.path + i.message} className="erreur">
                <span className="rubrique">{rubriqueDe(i.path)}</span>
                {i.message}
              </li>
            ))}
          </ul>
        )}
        {echec && (
          <p className="avertissement">
            Dimensionnement impossible : {echec}. Décochez « Dimensionner automatiquement » pour créer le projet avec les profils du gabarit.
          </p>
        )}
        </div>
      </div>

      {n === ETAPES.length - 1 && travauxEnCours > 0 && (
        <p className="avertissement">
          Créer ce projet remplace le projet ouvert : {travauxEnCours} modification(s) et l’historique d’annulation seront perdus. Enregistrez d’abord pour les garder.
        </p>
      )}

      <div className="assistant-pied">
        <button type="button" className="plat" onClick={() => (n === 0 ? fermer() : setN(n - 1))} disabled={calcul && n > 0}>
          {n === 0 ? 'Annuler' : '← Précédent'}
        </button>
        <span className="separateur" />
        {n < ETAPES.length - 1 ? (
          <button type="button" onClick={() => setN(n + 1)} disabled={bloquantes.length > 0} title={bloquantes.length > 0 ? 'Corrigez d’abord les erreurs de cette étape' : undefined}>
            Suivant →
          </button>
        ) : (
          <button type="button" onClick={creer} disabled={bloquantes.length > 0 || calcul}>
            {calcul ? `Dimensionnement${avancement ? ` — ${avancement.libelle} (${avancement.fait}/${avancement.total})` : '…'}` : 'Créer le projet'}
          </button>
        )}
      </div>
    </Modale>
  );
}

/** Ce qui va être créé, avec la masse et le taux de travail du projet tel quel. */
function Recapitulatif({ p, dimensionnerAuto, setDimensionnerAuto }: { p: ProjectParams; dimensionnerAuto: boolean; setDimensionnerAuto: (v: boolean) => void }): JSX.Element {
  const bilan = useMemo(() => {
    try {
      const m = buildProject(p);
      return { masse: m.stats.massKg, barres: m.stats.memberCount, taux: runChecks(p, m).maxRatio };
    } catch {
      return null;
    }
  }, [p]);
  const g = p.grid;
  return (
    <div className="fiche">
      <h3>Récapitulatif</h3>
      <dl className="paires">
        <dt>Projet</dt>
        <dd>{p.meta.nom || '—'}</dd>
        <dt>Dimensions</dt>
        <dd>
          {mm(g.span)} × {mm(buildingLength(g))} mm, égout à {mm(g.eaveHeight)} mm
        </dd>
        <dt>Trame</dt>
        <dd>
          {g.nBays} travées de {mm(g.baySpacing)} mm
        </dd>
        <dt>Toiture</dt>
        <dd>
          {g.roofType === 'monopente' ? 'un versant' : 'deux versants'}, {p.truss.enabled ? 'ferme treillis' : 'traverse à âme pleine'}
        </dd>
        <dt>Charges</dt>
        <dd>{p.site.mode === 'eurocode' ? 'calculées depuis le site' : 'saisies à la main'}</dd>
        {bilan && (
          <>
            <dt>Barres</dt>
            <dd className="derive">{num(bilan.barres, 0)}</dd>
            <dt>Masse d’acier</dt>
            <dd className="derive">{num(bilan.masse, 0)} kg</dd>
            <dt>Taux de travail maximal, profils du gabarit</dt>
            <dd className={bilan.taux > 1 ? 'alerte' : 'derive'}>{num(bilan.taux, 2)}</dd>
          </>
        )}
      </dl>
      <label className="etiquette" style={{ display: 'block', marginTop: 10 }}>
        <input type="checkbox" checked={dimensionnerAuto} onChange={(e) => setDimensionnerAuto(e.target.checked)} /> Dimensionner automatiquement les profils (le plus léger qui tient, dans la famille du gabarit)
      </label>
      <p className="note" style={{ marginBottom: 0 }}>
        {bilan && bilan.taux > 1
          ? 'Les profils du gabarit ne tiennent pas pour ces dimensions et ces charges : le dimensionnement automatique les renforcera.'
          : 'Tout se règle ensuite dans l’onglet Projet ; la vue 3D, les plans et les nomenclatures sont prêts dès la création.'}
      </p>
    </div>
  );
}
