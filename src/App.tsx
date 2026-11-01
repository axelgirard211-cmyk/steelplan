import { lazy, Suspense, useEffect, useState } from 'react';
import { CataloguePanel } from './ui/panels/CataloguePanel';
import { ProjetPanel } from './ui/panels/ProjetPanel';
import { selectCanRedo, selectCanUndo, useProjectStore } from './state/store';
import { AideRaccourcis } from './ui/AideRaccourcis';
import { BarreDeFichier } from './ui/BarreDeFichier';
import { BandeauModele, BarriereErreur } from './ui/GardeFou';
import { trouverRaccourci } from './ui/raccourcis';
import { useNavigation, type Onglet } from './state/navigation';
import { useEtatDuProjet, type EtatDuProjet } from './ui/useEtatDuProjet';
import { num } from './ui/format';
import {
  IconeAnnuler,
  IconeCube,
  IconeEdition,
  IconeListe,
  IconePlans,
  IconeProfil,
  IconeProjet,
  IconeRetablir,
  IconeVerification,
  Marque,
} from './ui/icones';

/*
 * ⚠ La vue 3D est chargée À LA DEMANDE. Elle embarque tout le moteur de rendu —
 * plusieurs centaines de kilo-octets — que l'onglet Projet, celui qui s'ouvre en
 * premier, n'utilise pas. Le charger d'emblée faisait attendre la première
 * saisie derrière un moteur 3D qu'on n'avait pas encore demandé.
 */
const Vue3dPanel = lazy(() =>
  import('./ui/panels/Vue3dPanel').then((m) => ({ default: m.Vue3dPanel })),
);
// La page d'édition embarque elle aussi le moteur 3D : même chargement à la demande.
const EditionPanel = lazy(() =>
  import('./ui/edition/EditionPanel').then((m) => ({ default: m.EditionPanel })),
);
// Plans, nomenclatures et vérifications : rien de cela n'est lu à l'ouverture,
// qui se fait sur l'onglet Projet. Les charger d'emblée alourdissait le premier
// paquet de tout le dessin et de toutes les vérifications.
const PlansPanel = lazy(() => import('./ui/panels/PlansPanel').then((m) => ({ default: m.PlansPanel })));
const NomenclaturesPanel = lazy(() =>
  import('./ui/panels/NomenclaturesPanel').then((m) => ({ default: m.NomenclaturesPanel })),
);
const VerificationsPanel = lazy(() =>
  import('./ui/panels/VerificationsPanel').then((m) => ({ default: m.VerificationsPanel })),
);


/**
 * Les onglets, dans l'ORDRE DU TRAVAIL : concevoir, voir, vérifier, dessiner,
 * fabriquer — puis les outils, à part. Une barre qui suit le travail se lit
 * comme un mode d'emploi.
 */
const ONGLETS: readonly { readonly id: Onglet; readonly libelle: string; readonly icone: () => JSX.Element; readonly outil?: boolean }[] = [
  { id: 'projet', libelle: 'Projet', icone: IconeProjet },
  { id: 'vue3d', libelle: 'Vue 3D', icone: IconeCube },
  { id: 'verifications', libelle: 'Vérifications', icone: IconeVerification },
  { id: 'plans', libelle: 'Plans', icone: IconePlans },
  { id: 'nomenclatures', libelle: 'Nomenclatures', icone: IconeListe },
  { id: 'edition', libelle: 'Édition 3D / 2D', icone: IconeEdition, outil: true },
  { id: 'catalogue', libelle: 'Catalogue de profils', icone: IconeProfil, outil: true },
];

/** L'état du projet, porté par l'onglet où il se lit en détail. */
function Pastille({ onglet, etat }: { onglet: Onglet; etat: EtatDuProjet | null }): JSX.Element | null {
  if (!etat) return null;
  if (onglet === 'projet' && etat.erreurs > 0) {
    return (
      <span className="pastille-onglet erreur" title={`${etat.erreurs} erreur(s) de saisie`}>
        {etat.erreurs}
      </span>
    );
  }
  if (onglet === 'verifications') {
    return etat.enDefaut > 0 ? (
      <span className="pastille-onglet erreur" title={`${etat.enDefaut} repère(s) ou assemblage(s) au-delà de 1,00`}>
        {etat.enDefaut} à reprendre
      </span>
    ) : (
      <span className="pastille-onglet ok" title="Taux de travail maximal, barres et assemblages">
        taux {num(etat.tauxMax, 2)}
      </span>
    );
  }
  if (onglet === 'nomenclatures') {
    return (
      <span className="pastille-onglet neutre" title={`${num(etat.prixHT, 0)} € HT au chiffrage`}>
        {num(etat.masseKg / 1000, 1)} t
      </span>
    );
  }
  return null;
}

/** Onglet visé par chaque raccourci de navigation. */
const ONGLET_PAR_RACCOURCI: Readonly<Record<string, Onglet>> = {
  'onglet-projet': 'projet',
  'onglet-vue3d': 'vue3d',
  'onglet-plans': 'plans',
  'onglet-edition': 'edition',
  'onglet-nomenclatures': 'nomenclatures',
  'onglet-verifications': 'verifications',
  'onglet-catalogue': 'catalogue',
};

type Theme = 'clair' | 'sombre' | 'auto';

const CLE_THEME = 'steelplan.theme';

/*
 * ⚠ Le thème choisi est RETENU par le navigateur. Il revenait à « Thème
 * système » à chaque rechargement : choisir le clair pour travailler en plein
 * jour obligeait à le redemander à chaque ouverture.
 *
 * Préférence d'affichage seulement, propre à ce navigateur — jamais une donnée
 * du projet. Le stockage peut être refusé (navigation privée, données bloquées) :
 * chaque accès est protégé, et l'on retombe alors sur le thème du système.
 */
export function themeMemorise(): Theme {
  try {
    const v = localStorage.getItem(CLE_THEME);
    return v === 'clair' || v === 'sombre' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function memoriserTheme(t: Theme): void {
  try {
    localStorage.setItem(CLE_THEME, t);
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
}

export function App(): JSX.Element {
  // L'onglet est partagé : une pièce cliquée en 3D peut ouvrir sa planche en 2D.
  const onglet = useNavigation((s) => s.onglet);
  const setOnglet = useNavigation((s) => s.setOnglet);
  const [theme, setTheme] = useState<Theme>(themeMemorise);
  const [aide, setAide] = useState(false);
  const [demandeGabarits, setDemandeGabarits] = useState(0);

  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);
  const nbEditions = useProjectStore((s) => s.past.length);
  const meta = useProjectStore((s) => s.project.meta);
  const allerA = useNavigation((s) => s.allerA);
  const etat = useEtatDuProjet();

  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
    memoriserTheme(theme);
  }, [theme]);

  /**
   * Raccourcis clavier, tous issus de la même déclaration.
   *
   * ⚠ Les actions fichier sont relayées par des évènements plutôt qu'appelées
   * ici : elles ont besoin d'un état (poignée du fichier courant, messages) qui
   * vit dans `BarreDeFichier`. Le dupliquer dans deux composants garantirait
   * qu'un jour l'un enregistre et l'autre pas.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const r = trouverRaccourci(e, e.target);
      if (!r) return;

      const onglets = ONGLET_PAR_RACCOURCI[r.id];
      if (onglets) {
        e.preventDefault();
        setOnglet(onglets);
        return;
      }

      switch (r.id) {
        case 'undo':
          e.preventDefault();
          undo();
          return;
        case 'redo':
          e.preventDefault();
          redo();
          return;
        case 'aide':
          e.preventDefault();
          setAide((v) => !v);
          return;
        case 'fermer':
          if (aide) {
            e.preventDefault();
            setAide(false);
          }
          return;
        case 'nouveau':
          e.preventDefault();
          setDemandeGabarits((n) => n + 1);
          return;
        case 'ouvrir':
        case 'enregistrer':
        case 'enregistrer-sous':
          e.preventDefault();
          window.dispatchEvent(new Event(`steelplan:${r.id}`));
          return;
        default:
          // Les raccourcis de vue 3D sont traités par le panneau lui-même : il
          // est le seul à détenir la scène.
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, aide]);

  return (
    <div className="app">
      <header className="entete">
        <div className="marque">
          <Marque />
          <h1>SteelPlan</h1>
        </div>
        {/* Le projet ouvert, toujours en vue : son nom mène au cartouche. */}
        <button type="button" className="projet-courant" onClick={() => allerA('Cartouche et indices')} title="Nom, client, indice — cartouche des plans">
          <span className="nom">{meta.nom || 'Projet sans nom'}</span>
          {meta.indice && <span className="indice">ind. {meta.indice}</span>}
        </button>
        <BarreDeFichier
          demandeGabarits={demandeGabarits}
          onGabaritsTraites={() => setDemandeGabarits(0)}
        />
        {/*
          * Les commandes d'édition et d'affichage forment UN groupe : quand la
          * fenêtre est étroite, elles passent à la ligne ensemble. Sans ce
          * regroupement, le sélecteur de thème et le bouton d'aide partaient seuls
          * sur une seconde ligne, séparés des boutons Annuler et Rétablir.
          */}
        <div className="entete-droite">
          <button type="button" className="plat avec-icone" onClick={undo} disabled={!canUndo} title={`Annuler — Ctrl+Z (${nbEditions} modification${nbEditions > 1 ? 's' : ''})`}>
            <IconeAnnuler /> Annuler
          </button>
          <button type="button" className="plat avec-icone" onClick={redo} disabled={!canRedo} title="Rétablir — Ctrl+Maj+Z">
            <IconeRetablir /> Rétablir
          </button>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            title="Thème"
            aria-label="Thème"
          >
            <option value="auto">Thème système</option>
            <option value="clair">Clair</option>
            <option value="sombre">Sombre</option>
          </select>
          <button
            type="button"
            className="plat rond"
            onClick={() => setAide(true)}
            title="Maj+? — raccourcis clavier"
            aria-label="Raccourcis clavier"
          >
            ?
          </button>
        </div>
      </header>

      <nav className="onglets" role="tablist">
        {ONGLETS.map((o, i) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            className={o.outil && !ONGLETS[i - 1]?.outil ? 'debut-outils' : undefined}
            aria-selected={onglet === o.id}
            onClick={() => setOnglet(o.id)}
            title={`${o.libelle} — touche ${i + 1}`}
          >
            <o.icone />
            <span>{o.libelle}</span>
            <Pastille onglet={o.id} etat={etat} />
          </button>
        ))}
      </nav>

      <BandeauModele />
      <main className="corps">
        <BarriereErreur cle={onglet} onAnnuler={undo}>
        {onglet === 'projet' ? (
          <ProjetPanel />
        ) : onglet === 'vue3d' ? (
          <Suspense fallback={<p className="chargement">Chargement de la vue 3D…</p>}>
            <Vue3dPanel />
          </Suspense>
        ) : onglet === 'plans' ? (
          <Suspense fallback={<p className="chargement">Chargement des plans…</p>}>
            <PlansPanel />
          </Suspense>
        ) : onglet === 'edition' ? (
          <Suspense fallback={<p className="chargement">Chargement de l’édition…</p>}>
            <EditionPanel />
          </Suspense>
        ) : onglet === 'nomenclatures' ? (
          <Suspense fallback={<p className="chargement">Chargement des nomenclatures…</p>}>
            <NomenclaturesPanel />
          </Suspense>
        ) : onglet === 'verifications' ? (
          <Suspense fallback={<p className="chargement">Chargement des vérifications…</p>}>
            <VerificationsPanel />
          </Suspense>
        ) : (
          <CataloguePanel />
        )}
        </BarriereErreur>
      </main>

      <AideRaccourcis ouvert={aide} onFermer={() => setAide(false)} />
    </div>
  );
}
