import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pt, type Bbox, type Pt } from '../../core/drawing/scene';
import { auxProportions, deplacer, mmParPixel, versFeuille, vueEtendue, vueSur, zoomer, type Vue } from './vue';

/**
 * LA VUE DE L'ÉDITEUR — cadre d'affichage, cadrage, zoom et déplacement.
 *
 * Le plan est un SVG figé : seule sa fenêtre (viewBox) suit la vue, sans le
 * reconstruire ; le calque d'aperçu partage la même fenêtre.
 */
export function useVueEditeur(W: number, H: number, svg: string, cadrageInitial: Bbox | null) {
  const cadre = useRef<HTMLDivElement>(null);
  const fond = useRef<HTMLDivElement>(null);
  const [taille, setTaille] = useState({ l: 800, h: 500 });
  const [vue, setVue] = useState<Vue>(() => vueEtendue(W, H, 800, 500));
  const cadrage = useRef(cadrageInitial);

  // Cadre d'affichage : la vue garde ses proportions, la feuille s'ouvre entière
  // — ou cadrée sur la pièce venue de la 3D.
  useEffect(() => {
    const el = cadre.current;
    if (!el) return undefined;
    let premier = true;
    const mesurer = (): void => {
      const l = el.clientWidth;
      const h = el.clientHeight;
      if (l === 0 || h === 0) return;
      setTaille({ l, h });
      // ⚠ La vue d'ouverture se calcule ICI, pas dans une fonction de mise à
      // jour : celle-ci s'exécute au rendu, quand `premier` est déjà faux, et la
      // feuille s'ouvrait alors cadrée pour un écran supposé de 800 × 500.
      const c = cadrage.current;
      if (premier) setVue(c ? vueSur(c, H, l, h) : vueEtendue(W, H, l, h));
      else setVue((v) => auxProportions(v, l, h));
      premier = false;
    };
    // ⚠ Mesure immédiate, sans attendre l'observateur : il ne se déclenche qu'au
    // prochain affichage — jamais dans une page en arrière-plan —, et d'ici là le
    // pointeur et le dessin auraient deux échelles différentes.
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  useLayoutEffect(() => {
    const s = fond.current?.querySelector('svg');
    if (!s) return;
    s.setAttribute('viewBox', `${vue.x} ${vue.y} ${vue.w} ${vue.h}`);
    s.setAttribute('width', '100%');
    s.setAttribute('height', '100%');
    s.setAttribute('preserveAspectRatio', 'none');
  }, [svg, vue]);

  // Molette native (non passive) : la page ne doit ni défiler ni zoomer avec la planche.
  useEffect(() => {
    const el = cadre.current;
    if (!el) return undefined;
    const surMolette = (e: WheelEvent): void => {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const q = versFeuille(vue, e.clientX - b.left, e.clientY - b.top, taille.l, taille.h);
      // Molette de souris ou pincement : zoom au pointeur. Pavé tactile : déplacement.
      const souris = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50);
      if (e.ctrlKey || e.metaKey || souris) setVue((v) => zoomer(v, Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), q.x, q.y));
      else setVue((v) => deplacer(v, -e.deltaX, -e.deltaY, taille.l));
    };
    el.addEventListener('wheel', surMolette, { passive: false });
    return () => el.removeEventListener('wheel', surMolette);
  }, [vue, taille]);

  /** Point de la feuille (mm papier, Y vers le haut) sous un évènement du pointeur. */
  const auPapier = (e: { clientX: number; clientY: number }): Pt => {
    const b = cadre.current?.getBoundingClientRect();
    const q = versFeuille(vue, e.clientX - (b?.left ?? 0), e.clientY - (b?.top ?? 0), taille.l, taille.h);
    return pt(q.x, H - q.y);
  };

  return {
    cadre,
    fond,
    vue,
    k: mmParPixel(vue, taille.l),
    auPapier,
    /** Déplacement de la vue, en pixels d'écran. */
    glisser: (dx: number, dy: number): void => setVue((v) => deplacer(v, dx, dy, taille.l)),
    toutVoir: (): void => setVue(vueEtendue(W, H, taille.l, taille.h)),
  };
}
