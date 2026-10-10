import { useEffect, useRef } from 'react';
import { SteelScene, type StandardView } from '../../render3d/scene';
import { useEtatModele, useStructuralModel } from '../../state/derived';

/**
 * APERÇU 3D À CÔTÉ DE LA SAISIE.
 *
 * ⚠ On tapait une portée, une pente, un entraxe de pannes… puis on changeait
 * d'onglet pour voir ce que cela donnait, et l'on revenait. L'aperçu suit la
 * saisie à chaque frappe : le bâtiment se déforme sous les yeux, et une valeur
 * aberrante se voit avant d'être lue.
 */

const VUES: readonly (readonly [StandardView, string])[] = [
  ['iso', 'Iso'],
  ['face', 'Face'],
  ['cote', 'Côté'],
  ['dessus', 'Dessus'],
];

export function Apercu3d(): JSX.Element {
  const model = useStructuralModel();
  const etat = useEtatModele();
  const conteneur = useRef<HTMLDivElement>(null);
  const scene = useRef<SteelScene | null>(null);

  useEffect(() => {
    if (!conteneur.current) return undefined;
    const s = new SteelScene(conteneur.current, { onSelect: () => undefined, onMeasure: () => undefined, onHover: () => undefined });
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => scene.current?.setModel(model), [model]);

  return (
    <aside className="apercu3d" aria-label="Aperçu 3D">
      <div className="apercu3d-outils">
        {VUES.map(([v, l]) => (
          <button key={v} type="button" className="plat" onClick={() => scene.current?.setView(v)}>
            {l}
          </button>
        ))}
        <span className="compte">
          {model.stats.memberCount} barres · {Math.round(model.stats.massKg).toLocaleString('fr-FR')} kg
        </span>
      </div>
      <div ref={conteneur} className="apercu3d-canevas" />
      {!etat.aJour && <p className="note avertissement-apercu">Saisie invalide : l’aperçu montre le dernier état valide.</p>}
    </aside>
  );
}
