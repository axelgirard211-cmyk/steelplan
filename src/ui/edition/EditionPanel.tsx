import { useEffect, useMemo, useRef, useState } from 'react';
import type { Sheet, SheetKind } from '../../core/drawing/sheet';
import { Editeur } from '../editeur/Editeur';
import { LIBELLES } from '../panels/PlansPanel';
import { useDossier } from '../useDossier';
import { Edition3d } from './Edition3d';
import '../theme/edition.css';

/**
 * PAGE D'ÉDITION — le modèle en 3D et les plans en 2D, sur toute la page.
 *
 * ⚠ L'éditeur de planches tenait dans un coin de l'onglet Plans, entre la liste
 * des planches et le panneau : la feuille y faisait la moitié de l'écran. Ici,
 * la vue prend toute la place — et toute la fenêtre en plein écran —, et l'on
 * passe du modèle à ses plans sans changer d'onglet.
 */

type Mode = '3d' | '2d';

export function EditionPanel(): JSX.Element {
  const page = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<Mode>('3d');
  const [pleinEcran, setPleinEcran] = useState(false);
  const { dossier, retouches } = useDossier();
  const [plancheId, setPlancheId] = useState<string>(() => dossier[0]?.id ?? '');
  const planche: Sheet | undefined = dossier.find((s) => s.id === plancheId) ?? dossier[0];
  const [fondClair, setFondClair] = useState(true);

  const groupes = useMemo(() => {
    const m = new Map<SheetKind, Sheet[]>();
    for (const s of dossier) m.set(s.kind, [...(m.get(s.kind) ?? []), s]);
    return [...m.entries()];
  }, [dossier]);

  useEffect(() => {
    const suivre = (): void => setPleinEcran(document.fullscreenElement === page.current);
    document.addEventListener('fullscreenchange', suivre);
    return () => document.removeEventListener('fullscreenchange', suivre);
  }, []);

  const basculerPleinEcran = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void page.current?.requestFullscreen?.();
  };

  return (
    <section ref={page} className="principal edition">
      <div className="edition-entete">
        <div className="segments" role="tablist" aria-label="Que modifier">
          <button type="button" role="tab" aria-selected={mode === '3d'} onClick={() => setMode('3d')}>
            Modèle 3D
          </button>
          <button type="button" role="tab" aria-selected={mode === '2d'} onClick={() => setMode('2d')}>
            Plans 2D
          </button>
        </div>
        {mode === '2d' && planche && (
          <>
            <label className="etiquette">
              Planche
              <select value={planche.id} onChange={(e) => setPlancheId(e.target.value)} style={{ maxWidth: 360 }}>
                {groupes.map(([kind, l]) => (
                  <optgroup key={kind} label={LIBELLES[kind]}>
                    {l.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.titre}
                        {retouches.has(s.id) ? ' ✎' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="etiquette">
              <input type="checkbox" checked={fondClair} onChange={(e) => setFondClair(e.target.checked)} /> Fond papier
            </label>
          </>
        )}
        <span className="separateur" />
        <button type="button" className="plat" onClick={basculerPleinEcran} title="Échap pour sortir">
          {pleinEcran ? 'Quitter le plein écran' : 'Plein écran'}
        </button>
      </div>

      <div className="edition-corps">
        {mode === '3d' ? (
          <Edition3d />
        ) : planche ? (
          <Editeur key={planche.id} sheet={planche} retouches={retouches.get(planche.id)} fondClair={fondClair} />
        ) : (
          <p className="note">Aucune planche dans le dossier.</p>
        )}
      </div>
    </section>
  );
}
