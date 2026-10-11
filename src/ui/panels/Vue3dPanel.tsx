/// <reference types="vite/client" />
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChecksReport, useProjetEffectif, useStructuralModel } from '../../state/derived';
import { maquetteIfc } from '../../export/ifc/index';
import type { ColorMode } from '../../render3d/colorMaps';
import { Legende, LegendeTaux } from './Vue3dLegendes';
import { FicheBarre, FicheJarret, FicheTole } from './Vue3dFiches';
import { trouverRaccourci } from '../raccourcis';
import { SteelScene, type ClipConfig, type StandardView } from '../../render3d/scene';
import { metres, mm, num } from '../format';

const VUES: readonly { id: StandardView; label: string }[] = [
  { id: 'iso', label: 'Isométrique' },
  { id: 'face', label: 'Face' },
  { id: 'arriere', label: 'Arrière' },
  { id: 'cote', label: 'Côté' },
  { id: 'dessus', label: 'Dessus' },
];

/** Vue 3D interactive : orbite, sélection, isolement, coupe dynamique, mesure. */
export function Vue3dPanel(): JSX.Element {
  const model = useStructuralModel();
  const projet = useProjetEffectif();
  const rapport = useChecksReport();
  const conteneur = useRef<HTMLDivElement>(null);
  const scene = useRef<SteelScene | null>(null);

  const [selection, setSelection] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('realiste');
  const [masques, setMasques] = useState<ReadonlySet<string>>(new Set());
  const [isole, setIsole] = useState<ReadonlySet<string> | null>(null);
  const [clip, setClip] = useState<ClipConfig | null>(null);
  const [mesure, setMesure] = useState<number | null>(null);
  const [modeMesure, setModeMesure] = useState(false);
  const [grille, setGrille] = useState(true);
  const [aretes, setAretes] = useState(true);
  const [percagesIfc, setPercagesIfc] = useState(false);

  // --- Création / destruction de la scène ---
  useEffect(() => {
    if (!conteneur.current) return undefined;
    const s = new SteelScene(conteneur.current, {
      onSelect: setSelection,
      onMeasure: setMesure,
      onHover: () => undefined,
    });
    scene.current = s;
    // Accès de mise au point, en développement seulement : piloter la caméra
    // depuis la console pour inspecter un nœud. Absent de l'application construite.
    if (import.meta.env.DEV) (window as unknown as { __scene3d?: SteelScene }).__scene3d = s;
    return () => {
      s.dispose();
      scene.current = null;
    };
  }, []);

  // --- Le modèle change : on reconstruit tout ---
  useEffect(() => {
    scene.current?.setModel(model);
    // Rebâtir les maillages efface les couleurs et l'état d'affichage.
    scene.current?.setHidden(masques);
    scene.current?.setIsolated(isole);
    scene.current?.setClip(clip);
    scene.current?.setSelected(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  useEffect(() => {
    if (scene.current) scene.current.setColorMode(colorMode, model, rapport.byMark);
    scene.current?.setHidden(masques);
    scene.current?.setIsolated(isole);
    scene.current?.setClip(clip);
    scene.current?.setSelected(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, rapport]);

  /*
   * La grille suit le THÈME, choisi ou hérité du système. On relit les jetons
   * CSS à chaque bascule : changement explicite (attribut de la racine) ou
   * changement de préférence du système en mode automatique.
   */
  useEffect(() => {
    const appliquer = (): void => {
      const st = getComputedStyle(document.documentElement);
      const maj = st.getPropertyValue('--grille-majeure').trim();
      const min = st.getPropertyValue('--grille-mineure').trim();
      if (maj && min) scene.current?.teinterGrille(maj, min);
    };
    appliquer();
    const mo = new MutationObserver(appliquer);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', appliquer);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', appliquer);
    };
  }, []);

  useEffect(() => scene.current?.setHidden(masques), [masques]);
  useEffect(() => scene.current?.setIsolated(isole), [isole]);
  useEffect(() => scene.current?.setSelected(selection), [selection]);
  useEffect(() => scene.current?.setClip(clip), [clip]);
  useEffect(() => scene.current?.setMeasureMode(modeMesure), [modeMesure]);

  /**
   * Raccourcis propres à la vue 3D.
   *
   * ⚠ Ils vivent ici et non dans `App` : la scène est détenue par ce composant,
   * et faire remonter une référence impérative jusqu'à l'application entière pour
   * changer de point de vue créerait un couplage sans contrepartie.
   */
  useEffect(() => {
    const vues: Record<string, StandardView> = {
      'vue-iso': 'iso',
      'vue-face': 'face',
      'vue-cote': 'cote',
      'vue-dessus': 'dessus',
    };
    const onKey = (e: KeyboardEvent): void => {
      const r = trouverRaccourci(e, e.target);
      if (!r) return;
      const vue = vues[r.id];
      if (vue) {
        e.preventDefault();
        scene.current?.setView(vue);
        return;
      }
      if (r.id === 'recadrer') {
        e.preventDefault();
        scene.current?.recadrer();
      } else if (r.id === 'fermer' && selection) {
        e.preventDefault();
        setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);
  useEffect(() => scene.current?.setGridVisible(grille), [grille]);
  useEffect(() => scene.current?.setEdgesVisible(aretes), [aretes]);

  const barres = useMemo(() => new Map(model.members.map((m) => [m.id, m])), [model]);
  const jarrets = useMemo(() => new Map(model.haunches.map((h) => [h.id, h])), [model]);
  const toles = useMemo(() => new Map(model.plates.map((pl) => [pl.id, pl])), [model]);
  const barre = selection ? barres.get(selection) : undefined;
  const jarret = selection ? jarrets.get(selection) : undefined;
  const tole = selection ? toles.get(selection) : undefined;

  /** Isoler : ne garder que les pièces portant le même repère que la sélection. */
  const isolerRepere = (): void => {
    if (!barre && !jarret && !tole) return;
    const repere = barre?.mark ?? jarret?.mark ?? tole?.mark;
    const ids = new Set<string>();
    for (const m of model.members) if (m.mark === repere) ids.add(m.id);
    for (const h of model.haunches) if (h.mark === repere) ids.add(h.id);
    for (const pl of model.plates) if (pl.mark === repere) ids.add(pl.id);
    setIsole(ids);
  };

  return (
    <section className="principal vue3d">
      <div className="barre-outils">
        {VUES.map((v) => (
          <button key={v.id} type="button" className="plat" onClick={() => scene.current?.setView(v.id)}>
            {v.label}
          </button>
        ))}
        <button type="button" className="plat" onClick={() => scene.current?.recadrer()}>
          Recadrer
        </button>

        <span className="separateur" />

        <label className="etiquette">
          Couleurs
          <select value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)}>
            <option value="realiste">réaliste (acier)</option>
            <option value="role">par type d’élément</option>
            <option value="profil">par profil</option>
            <option value="taux">par taux de travail</option>
            <option value="uniforme">uniforme</option>
          </select>
        </label>

        <label className="etiquette">
          <input type="checkbox" checked={grille} onChange={(e) => setGrille(e.target.checked)} /> Grille
        </label>
        <label className="etiquette">
          <input type="checkbox" checked={aretes} onChange={(e) => setAretes(e.target.checked)} /> Arêtes
        </label>
        <label className="etiquette">
          <input
            type="checkbox"
            checked={modeMesure}
            onChange={(e) => setModeMesure(e.target.checked)}
          />{' '}
          Mesurer
        </label>
        {mesure !== null && <span className="mesure">{mm(mesure)} mm ({metres(mesure)} m)</span>}

        <span className="separateur" />
        <button
          type="button"
          className="plat"
          onClick={() => exporterIfc(projet, model, percagesIfc)}
          title="Maquette IFC4 de la charpente — barres, tôles, boulons, assemblages et repères — pour la synthèse BIM"
        >
          Exporter en IFC
        </button>
        <label
          className="etiquette"
          title="Évide les barres de leurs perçages. Inutile à la synthèse, et certains lecteurs IFC les soustraient mal : la fabrication a les fichiers DSTV."
        >
          <input type="checkbox" checked={percagesIfc} onChange={(e) => setPercagesIfc(e.target.checked)} /> avec perçages
        </label>
      </div>

      <div className="barre-outils">
        <CoupeDynamique scene={scene} clip={clip} setClip={setClip} />
        <span className="separateur" />
        <button
          type="button"
          className="plat"
          onClick={() => selection && scene.current?.cadrerSur(selection)}
          disabled={!selection}
          title="Cadrer sur la pièce sélectionnée — ou double-cliquer dessus dans la vue"
        >
          Cadrer dessus
        </button>
        <button type="button" className="plat" onClick={isolerRepere} disabled={!selection}>
          Isoler le repère
        </button>
        <button
          type="button"
          className="plat"
          onClick={() => selection && setMasques(new Set([...masques, selection]))}
          disabled={!selection}
        >
          Masquer
        </button>
        <button
          type="button"
          className="plat"
          onClick={() => {
            setMasques(new Set());
            setIsole(null);
          }}
          disabled={masques.size === 0 && isole === null}
        >
          Tout afficher
        </button>
        <span className="compte">
          {model.stats.memberCount} barres · {model.stats.haunchCount} jarrets ·{' '}
          {model.stats.plateCount} tôles · {model.stats.boltCount} boulons ·{' '}
          {num(model.stats.weldMetres, 0)} m de cordon ·{' '}
          {model.stats.markCount} repères · {num(model.stats.massKg, 0)} kg ·{' '}
          {num(model.stats.paintM2, 0)} m² à peindre · généré en {model.buildMs.toFixed(1)} ms
        </span>
      </div>

      <div className="scene-et-fiche">
        <div ref={conteneur} className="canevas3d" />
        <aside className="fiche-selection">
          {barre ? (
            <FicheBarre m={barre} />
          ) : jarret ? (
            <FicheJarret h={jarret} />
          ) : tole ? (
            <FicheTole pl={tole} />
          ) : (
            <div className="fiche">
              <h3>Sélection</h3>
              <p className="note" style={{ margin: 0 }}>
                Cliquez une pièce pour lire ses caractéristiques de débit,{' '}
                <strong>double-cliquez</strong> pour cadrer dessus et voir son assemblage de près.
                Molette pour zoomer, clic-glissé pour orbiter, clic droit pour translater.
              </p>
            </div>
          )}
          {colorMode === 'taux' ? <LegendeTaux /> : <Legende />}
        </aside>
      </div>
    </section>
  );
}


function CoupeDynamique({
  scene,
  clip,
  setClip,
}: {
  scene: React.MutableRefObject<SteelScene | null>;
  clip: ClipConfig | null;
  setClip: (c: ClipConfig | null) => void;
}): JSX.Element {
  // L'étendue du modèle ne peut pas être lue au rendu : la scène n'existe
  // encore pas au premier passage. On la relit à chaque changement d'axe.
  const [etendue, setEtendue] = useState({ min: 0, max: 1 });

  const activerSur = (axe: 'x' | 'y' | 'z'): void => {
    const et = scene.current?.extent(axe) ?? { min: 0, max: 1 };
    setEtendue(et);
    setClip({ axis: axe, position: (et.min + et.max) / 2, flipped: clip?.flipped ?? false });
  };

  return (
    <>
      <label className="etiquette">
        <input
          type="checkbox"
          checked={clip !== null}
          onChange={(e) => (e.target.checked ? activerSur('x') : setClip(null))}
        />{' '}
        Coupe
      </label>
      {clip && (
        <>
          <select
            value={clip.axis}
            onChange={(e) => activerSur(e.target.value as 'x' | 'y' | 'z')}
          >
            <option value="x">selon X (travées)</option>
            <option value="y">selon Y (portée)</option>
            <option value="z">selon Z (hauteur)</option>
          </select>
          <input
            type="range"
            min={etendue.min}
            max={etendue.max}
            step={10}
            value={clip.position}
            onChange={(e) => setClip({ ...clip, position: Number(e.target.value) })}
            style={{ width: 180 }}
          />
          <span className="compte">{mm(clip.position)} mm</span>
          <button
            type="button"
            className="plat"
            onClick={() => setClip({ ...clip, flipped: !clip.flipped })}
          >
            Inverser
          </button>
        </>
      )}
    </>
  );
}

/**
 * Télécharge la maquette IFC du modèle AFFICHÉ — celui que montre la vue, tiré
 * du dernier projet valide.
 */
function exporterIfc(projet: Parameters<typeof maquetteIfc>[0], model: Parameters<typeof maquetteIfc>[1], percages: boolean): void {
  const m = maquetteIfc(projet, model, { percages });
  const url = URL.createObjectURL(new Blob([m.contenu], { type: 'application/x-step' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = m.nom;
  a.click();
  URL.revokeObjectURL(url);
}
