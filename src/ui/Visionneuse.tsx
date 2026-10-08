import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * VISIONNEUSE DE PLANCHE — zoom et déplacement.
 *
 * ⚠ Sans zoom, une planche A1 se lit à quelques centaines de pixels de large :
 * un repère de 1,8 mm y fait moins d'un pixel de haut. Tout le travail de
 * repérage — chaque pièce étiquetée de son repère et de son profil — devenait
 * invisible à l'écran précisément sur la planche qui en porte le plus.
 *
 * Le zoom agit sur la LARGEUR de la feuille, et non par une transformation
 * graphique : le SVG est alors redessiné à la taille demandée, net à toutes les
 * échelles. Une mise à l'échelle par `transform` agrandirait une image déjà
 * tramée, et les traits fins deviendraient flous au moment où l'on zoome pour
 * les lire.
 *
 * Gestes retenus, ceux d'une visionneuse de plans sur Mac comme ailleurs :
 *  — pincement du pavé tactile, ou ⌘/Ctrl + molette : zoom autour du pointeur ;
 *  — molette ou glissé à deux doigts : déplacement, comme dans une page ;
 *  — glisser à la souris : déplacement ;
 *  — double-clic : zoom ×2 au point cliqué.
 * La molette seule ne zoome PAS : elle déplacerait la vue chaque fois qu'on veut
 * simplement faire défiler, et un pavé tactile la déclenche en continu.
 */

const ZOOM_MIN = 1;
const ZOOM_MAX = 16;
/** Largeur d'affichage maximale à zoom 1 (px) : au-delà, la feuille flotte. */
const LARGEUR_MAX = 1400;

interface Ancre {
  /** Point visé, en fraction de la feuille (0 à 1). */
  readonly u: number;
  readonly v: number;
  /** Position du pointeur dans la fenêtre (px). */
  readonly cx: number;
  readonly cy: number;
}

export function Visionneuse({
  svg,
  largeur,
  hauteur,
  cle,
}: {
  svg: string;
  /** Format de la feuille (mm), pour en garder les proportions. */
  largeur: number;
  hauteur: number;
  /** Identifiant de la planche : en changer ramène le zoom à 1. */
  cle: string;
}): JSX.Element {
  const fenetre = useRef<HTMLDivElement>(null);
  const feuille = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [base, setBase] = useState(800);
  const ancre = useRef<Ancre | null>(null);
  const glisse = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  // Une autre planche s'ouvre ajustée, pas au zoom de la précédente.
  useEffect(() => setZoom(1), [cle]);

  // Largeur de base : celle de la fenêtre, marges déduites, plafonnée.
  useEffect(() => {
    const el = fenetre.current;
    if (!el) return;
    const mesurer = (): void => setBase(Math.max(200, Math.min(LARGEUR_MAX, el.clientWidth - 16)));
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Zoom autour d'un point de la fenêtre.
   *
   * ⚠ Le point sous le pointeur doit RESTER sous le pointeur. Zoomer autour du
   * coin haut-gauche — ce que donne un simple changement de largeur — ferait
   * fuir hors de l'écran la zone qu'on cherchait justement à agrandir.
   */
  const zoomer = (facteur: number, cx?: number, cy?: number): void => {
    const el = fenetre.current;
    const f = feuille.current;
    if (!el || !f) return;
    const x = cx ?? el.clientWidth / 2;
    const y = cy ?? el.clientHeight / 2;
    ancre.current = {
      u: (el.scrollLeft + x - f.offsetLeft) / f.offsetWidth,
      v: (el.scrollTop + y - f.offsetTop) / f.offsetHeight,
      cx: x,
      cy: y,
    };
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * facteur)));
  };

  // Après le nouveau rendu, on replace la vue pour garder le point visé.
  useLayoutEffect(() => {
    const a = ancre.current;
    const el = fenetre.current;
    const f = feuille.current;
    if (!a || !el || !f) return;
    el.scrollLeft = f.offsetLeft + a.u * f.offsetWidth - a.cx;
    el.scrollTop = f.offsetTop + a.v * f.offsetHeight - a.cy;
    ancre.current = null;
  }, [zoom, base]);

  /*
   * ⚠ Écouteur NATIF, et non `onWheel` de React : React l'enregistre en mode
   * passif, qui interdit `preventDefault`. Le pincement zoomerait alors toute la
   * page du navigateur en même temps que la planche.
   */
  useEffect(() => {
    const el = fenetre.current;
    if (!el) return;
    const surMolette = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return; // molette seule : défilement natif
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomer(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', surMolette, { passive: false });
    return () => el.removeEventListener('wheel', surMolette);
  });

  const auPointeur = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const el = fenetre.current;
    if (!el) return;
    glisse.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  };
  const enDeplacement = (e: React.PointerEvent<HTMLDivElement>): void => {
    const g = glisse.current;
    const el = fenetre.current;
    if (!g || !el) return;
    el.scrollLeft = g.sl - (e.clientX - g.x);
    el.scrollTop = g.st - (e.clientY - g.y);
  };
  const relache = (): void => {
    glisse.current = null;
  };

  const largeurAffichee = base * zoom;

  return (
    <div className="visionneuse">
      <div className="visionneuse-outils">
        <button type="button" className="plat" onClick={() => zoomer(1 / 1.5)} disabled={zoom <= ZOOM_MIN} title="Dézoomer">
          −
        </button>
        <span className="compte zoom">{Math.round(zoom * 100)} %</span>
        <button type="button" className="plat" onClick={() => zoomer(1.5)} disabled={zoom >= ZOOM_MAX} title="Zoomer">
          +
        </button>
        <button type="button" className="plat" onClick={() => setZoom(1)} disabled={zoom === 1} title="Ajuster à la largeur">
          Ajuster
        </button>
        <span className="aide-gestes">Pincer ou ⌘ + molette pour zoomer · glisser pour se déplacer · double-clic pour agrandir</span>
      </div>
      <div
        ref={fenetre}
        className={`feuille-enveloppe${zoom > 1 ? ' zoomee' : ''}`}
        onPointerDown={auPointeur}
        onPointerMove={enDeplacement}
        onPointerUp={relache}
        onPointerCancel={relache}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          zoomer(2, e.clientX - r.left, e.clientY - r.top);
        }}
      >
        <div
          ref={feuille}
          className="feuille"
          style={{ width: largeurAffichee, aspectRatio: `${largeur} / ${hauteur}` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
