import { lazy, Suspense, useEffect, useState } from 'react';
import { CataloguePanel } from './ui/panels/CataloguePanel';
import { ProjetPanel } from './ui/panels/ProjetPanel';
import { NomenclaturesPanel } from './ui/panels/NomenclaturesPanel';
import { PlansPanel } from './ui/panels/PlansPanel';
import { VerificationsPanel } from './ui/panels/VerificationsPanel';
import { selectCanRedo, selectCanUndo, useProjectStore } from './state/store';
import { AideRaccourcis } from './ui/AideRaccourcis';
import { BarreDeFichier } from './ui/BarreDeFichier';
import { BandeauModele, BarriereErreur } from './ui/GardeFou';
import { trouverRaccourci } from './ui/raccourcis';

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

type Onglet = 'projet' | 'vue3d' | 'plans' | 'edition' | 'nomenclatures' | 'verifications' | 'catalogue';

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
  const [onglet, setOnglet] = useState<Onglet>('projet');
  const [theme, setTheme] = useState<Theme>(themeMemorise);
  const [aide, setAide] = useState(false);
  const [demandeGabarits, setDemandeGabarits] = useState(0);

  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);
  const nbEditions = useProjectStore((s) => s.past.length);

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
        <h1>SteelPlan</h1>
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
          <span className="phase">{nbEditions} édition(s)</span>
          <button type="button" className="plat" onClick={undo} disabled={!canUndo} title="Ctrl+Z">
            Annuler
          </button>
          <button type="button" className="plat" onClick={redo} disabled={!canRedo} title="Ctrl+Maj+Z">
            Rétablir
          </button>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            title="Thème"
          >
            <option value="auto">Thème système</option>
            <option value="clair">Clair</option>
            <option value="sombre">Sombre</option>
          </select>
          <button
            type="button"
            className="plat"
            onClick={() => setAide(true)}
            title="Maj+? — raccourcis clavier"
            aria-label="Raccourcis clavier"
          >
            ?
          </button>
        </div>
      </header>

      <nav className="onglets" role="tablist">
        <button type="button" role="tab" aria-selected={onglet === 'projet'} onClick={() => setOnglet('projet')}>
          Projet
        </button>
        <button type="button" role="tab" aria-selected={onglet === 'vue3d'} onClick={() => setOnglet('vue3d')}>
          Vue 3D
        </button>
        <button type="button" role="tab" aria-selected={onglet === 'plans'} onClick={() => setOnglet('plans')}>
          Plans
        </button>
        <button type="button" role="tab" aria-selected={onglet === 'edition'} onClick={() => setOnglet('edition')}>
          Édition 3D / 2D
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={onglet === 'nomenclatures'}
          onClick={() => setOnglet('nomenclatures')}
        >
          Nomenclatures
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={onglet === 'verifications'}
          onClick={() => setOnglet('verifications')}
        >
          Vérifications
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={onglet === 'catalogue'}
          onClick={() => setOnglet('catalogue')}
        >
          Catalogue de profils
        </button>
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
          <PlansPanel />
        ) : onglet === 'edition' ? (
          <Suspense fallback={<p className="chargement">Chargement de l’édition…</p>}>
            <EditionPanel />
          </Suspense>
        ) : onglet === 'nomenclatures' ? (
          <NomenclaturesPanel />
        ) : onglet === 'verifications' ? (
          <VerificationsPanel />
        ) : (
          <CataloguePanel />
        )}
        </BarriereErreur>
      </main>

      <AideRaccourcis ouvert={aide} onFermer={() => setAide(false)} />
    </div>
  );
}
