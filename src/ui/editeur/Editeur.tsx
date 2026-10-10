import { castDraft } from 'immer';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  accrocher,
  boitesSeTouchent,
  contenuDans,
  distanceA,
  emprise,
  ortho,
  toucheLaFenetre,
  transformer,
  type PointAccroche,
} from '../../core/drawing/geometrie2d';
import { FORMATS } from '../../core/drawing/layout';
import {
  ajouter,
  appliquerRetouches,
  cleDeRef,
  copier,
  effacer,
  elementsEditables,
  modifier,
  retouchesVides,
  traitsDe,
  valider,
  type EntiteDessin,
  type RetouchesDePlanche,
} from '../../core/drawing/retouches';
import { pt, type Bbox, type DrawEntity, type Layer, type Pt } from '../../core/drawing/scene';
import type { Sheet } from '../../core/drawing/sheet';
import { sheetToSvg } from '../../render2d/svgString';
import { useProjectStore } from '../../state/store';
import { num } from '../format';
import { dansUnChamp } from '../raccourcis';
import {
  ALIAS,
  apercu,
  avancer,
  demarrer,
  dernierPoint,
  invite,
  LIBELLE_COMMANDE,
  REPOS,
  transformationEnCours,
  type Action,
  type Contexte,
  type Etape,
  type NomCommande,
  type Resultat,
} from './commandes';
import { EditeurPanneau } from './EditeurPanneau';
import { LIBELLE_ACCROCHAGE, Marqueur, Reticule, Trait } from './Traits';
import { auxProportions, deplacer, mmParPixel, versFeuille, vueEtendue, zoomer, type Vue } from './vue';
import '../theme/editeur.css';

/**
 * ÉDITEUR DE PLANCHE — retoucher le plan comme dans un logiciel de DAO.
 *
 * Le plan généré est affiché dessous, tel que l'imprimera le dossier ; tout ce
 * que le dessinateur y fait est rangé dans les retouches de la planche, qui
 * survivent à la régénération. La ligne de commande garde le clavier : on tape
 * « L », Entrée, on clique ou l'on tape « @1000,0 » — comme partout ailleurs.
 */

const OUTILS: readonly NomCommande[] = ['ligne', 'polyligne', 'rectangle', 'cercle', 'texte', 'cote', 'deplacer', 'copier', 'rotation', 'miroir', 'echelle', 'effacer'];

type Glisse =
  | { readonly type: 'pan'; readonly x: number; readonly y: number }
  | { readonly type: 'fenetre'; readonly a: Pt; readonly x: number; readonly y: number; readonly maj: boolean };

export function Editeur({ sheet, retouches, fondClair, onQuitter }: { sheet: Sheet; retouches: RetouchesDePlanche | undefined; fondClair: boolean; onQuitter: () => void }): JSX.Element {
  const edit = useProjectStore((s) => s.edit);
  const r = useMemo(() => retouches ?? retouchesVides(sheet.id), [retouches, sheet.id]);
  const { largeur: W, hauteur: H } = FORMATS[sheet.format];

  const elements = useMemo(() => elementsEditables(sheet, r), [sheet, r]);
  const compose = useMemo(() => appliquerRetouches(sheet, r), [sheet, r]);
  const svg = useMemo(() => sheetToSvg(compose.sheet, fondClair ? {} : { encre: '#e6e9ef', papier: '#1b1f26' }), [compose, fondClair]);
  // Index à plat des traits, avec leur emprise : la désignation au pointeur et
  // l'accrochage ne parcourent que ceux dont la boîte est proche.
  const index = useMemo(() => elements.flatMap((el, i) => el.traits.map((t) => ({ t, i, b: emprise([t]) }))), [elements]);

  const cadre = useRef<HTMLDivElement>(null);
  const fond = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const [taille, setTaille] = useState({ l: 800, h: 500 });
  const [vue, setVue] = useState<Vue>(() => vueEtendue(W, H, 800, 500));
  const [etape, setEtape] = useState<Etape>(REPOS);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [brut, setBrut] = useState<Pt | null>(null);
  const [orthoActif, setOrtho] = useState(false);
  const [accrochageActif, setAccrochage] = useState(true);
  const [calque, setCalque] = useState<Layer>('contour');
  const [hauteurTexte, setHauteurTexte] = useState(2.5);
  const [journal, setJournal] = useState<readonly string[]>([]);
  const [saisie, setSaisie] = useState('');
  const [fenetre, setFenetre] = useState<{ a: Pt; b: Pt } | null>(null);
  const glisse = useRef<Glisse | null>(null);
  const derniere = useRef<NomCommande | null>(null);

  const k = mmParPixel(vue, taille.l);
  const noter = (m: string): void => setJournal((j) => [...j.slice(-4), m]);

  // Cadre d'affichage : la vue garde ses proportions, la feuille s'ouvre entière.
  useEffect(() => {
    const el = cadre.current;
    if (!el) return undefined;
    let premier = true;
    const ro = new ResizeObserver(() => {
      const l = el.clientWidth;
      const h = el.clientHeight;
      setTaille({ l, h });
      setVue((v) => (premier ? vueEtendue(W, H, l, h) : auxProportions(v, l, h)));
      premier = false;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  // Le plan est un SVG figé : seule sa fenêtre suit la vue, sans le reconstruire.
  useLayoutEffect(() => {
    const s = fond.current?.querySelector('svg');
    if (!s) return;
    s.setAttribute('viewBox', `${vue.x} ${vue.y} ${vue.w} ${vue.h}`);
    s.setAttribute('width', '100%');
    s.setAttribute('height', '100%');
    s.setAttribute('preserveAspectRatio', 'none');
  }, [svg, vue]);

  const auPapier = (e: { clientX: number; clientY: number }): Pt => {
    const b = cadre.current?.getBoundingClientRect();
    const q = versFeuille(vue, e.clientX - (b?.left ?? 0), e.clientY - (b?.top ?? 0), taille.l, taille.h);
    return pt(q.x, H - q.y);
  };

  /** Traits proches d'un point, d'après leur emprise. */
  const proches = (p: Pt, tol: number): { t: DrawEntity; i: number }[] => {
    const zone: Bbox = { min: pt(p.x - tol, p.y - tol), max: pt(p.x + tol, p.y + tol) };
    return index.filter((x) => boitesSeTouchent(x.b, zone));
  };

  const base = dernierPoint(etape);
  /** Le point visé depuis une position du pointeur : accrochage d'abord, ortho sinon. */
  const viser = (p: Pt): { p: Pt; accroche: PointAccroche | null } => {
    if (accrochageActif && etape.cmd !== 'repos') {
      const deja: DrawEntity[] =
        (etape.cmd === 'ligne' || etape.cmd === 'polyligne') && etape.points.length >= 2 ? [{ kind: 'polyligne', points: etape.points, fermee: false, layer: 'contour' }] : [];
      const a = accrocher(p, [...proches(p, 12 * k).map((x) => x.t), ...deja], 10 * k);
      if (a) return { p: a.p, accroche: a };
    }
    return { p: orthoActif && base && etape.cmd !== 'repos' ? ortho(base, p) : p, accroche: null };
  };
  const vise = brut ? viser(brut) : null;
  const accroche = vise?.accroche ?? null;
  const curseur: Pt | null = vise?.p ?? null;

  const ctx: Contexte = { echelle: sheet.echelle, curseur: curseur ?? pt(0, 0), nbSelection: selection.size, calque, hauteurTexte };
  const choisis = elements.filter((el) => selection.has(cleDeRef(el.ref)));

  /** Élément sous le pointeur, au repos : celui qu'un clic sélectionnerait. */
  const designe = (p: Pt): number | null => {
    const tol = 6 * k;
    let best: number | null = null;
    let d = tol;
    for (const x of proches(p, tol)) {
      const dx = distanceA(p, x.t);
      if (dx <= d) {
        d = dx;
        best = x.i;
      }
    }
    return best;
  };
  const survol = etape.cmd === 'repos' && brut && !fenetre ? designe(brut) : null;

  /* ---------------- Écriture des retouches ---------------- */

  const ecrire = (libelle: string, r2: RetouchesDePlanche): void => {
    edit(`Plan « ${sheet.titre} » — ${libelle}`, (d) => {
      const i = d.retouches.findIndex((x) => x.planche === sheet.id);
      const vide = r2.ajouts.length === 0 && r2.masques.length === 0;
      if (i >= 0) {
        if (vide) d.retouches.splice(i, 1);
        else d.retouches[i] = castDraft(r2);
      } else if (!vide) d.retouches.push(castDraft(r2));
    });
  };

  const appliquer = (actions: readonly Action[]): void => {
    let r2 = r;
    let libelle = '';
    let vider = false;
    for (const a of actions) {
      if (a.type === 'ajouter') {
        r2 = ajouter(r2, a.entites);
        libelle = a.libelle;
      } else if (a.type === 'effacer') {
        r2 = effacer(r2, choisis.map((el) => el.ref));
        libelle = 'Effacer';
        vider = true;
      } else {
        const f = (e: EntiteDessin): EntiteDessin => transformer(e, a.affine);
        r2 = a.copie ? copier(r2, choisis, f) : modifier(r2, choisis, f);
        libelle = a.libelle;
        // Une entité générée modifiée devient un ajout : son ancienne référence n'existe plus.
        if (!a.copie) vider = true;
      }
    }
    if (r2 !== r) ecrire(libelle, r2);
    if (vider) setSelection(new Set());
  };

  const traiter = (res: Resultat): void => {
    if (res.actions.length > 0) appliquer(res.actions);
    setEtape(res.etape);
    if (res.message) noter(res.message);
  };

  const lancer = (nom: NomCommande): void => {
    derniere.current = nom;
    noter(`> ${LIBELLE_COMMANDE[nom]}`);
    traiter(demarrer(nom, ctx));
    champ.current?.focus();
  };

  const soumettre = (): void => {
    const t = saisie;
    setSaisie('');
    if (t.trim() === '') {
      // Entrée seule : termine la commande, ou relance la dernière.
      if (etape.cmd === 'repos' && derniere.current) lancer(derniere.current);
      else traiter(avancer(etape, { type: 'valider' }, ctx));
      return;
    }
    noter(`> ${t}`);
    if (etape.cmd === 'repos') {
      const nom = ALIAS[t.trim().toUpperCase()];
      if (nom) derniere.current = nom;
    }
    traiter(avancer(etape, { type: 'saisie', texte: t }, ctx));
  };

  const auClavier = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const enTexte = etape.cmd === 'texte' && etape.a !== null;
    if (e.key === 'Enter' || (e.key === ' ' && !enTexte)) {
      e.preventDefault();
      soumettre();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSaisie('');
      if (etape.cmd === 'repos') setSelection(new Set());
      else traiter(avancer(etape, { type: 'echap' }, ctx));
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && saisie === '' && etape.cmd === 'repos' && selection.size > 0) {
      e.preventDefault();
      lancer('effacer');
    } else if (e.key === 'F8') {
      e.preventDefault();
      setOrtho((o) => !o);
    } else if (e.key === 'F3') {
      e.preventDefault();
      setAccrochage((a) => !a);
    }
  };

  /* ---------------- Pointeur ---------------- */

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

  const auPointeur = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    champ.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    // Bouton du milieu ou clic droit glissé : déplacement, comme en DAO.
    if (e.button === 1 || e.button === 2) {
      glisse.current = { type: 'pan', x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    if (etape.cmd !== 'repos') {
      // Le point se lit sur le clic lui-même : un clic sans mouvement préalable compte.
      const p = viser(auPapier(e)).p;
      setBrut(auPapier(e));
      traiter(avancer(etape, { type: 'point', p }, { ...ctx, curseur: p }));
      return;
    }
    glisse.current = { type: 'fenetre', a: auPapier(e), x: e.clientX, y: e.clientY, maj: e.shiftKey };
  };

  const enDeplacement = (e: React.PointerEvent<HTMLDivElement>): void => {
    const p = auPapier(e);
    setBrut(p);
    const g = glisse.current;
    if (g?.type === 'pan') {
      setVue((v) => deplacer(v, e.clientX - g.x, e.clientY - g.y, taille.l));
      glisse.current = { ...g, x: e.clientX, y: e.clientY };
    } else if (g?.type === 'fenetre' && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) {
      setFenetre({ a: g.a, b: p });
    }
  };

  const relache = (e: React.PointerEvent<HTMLDivElement>): void => {
    const g = glisse.current;
    glisse.current = null;
    if (g?.type !== 'fenetre') return;
    const basculer = (cles: string[]): void =>
      setSelection((s) => {
        const n = new Set(s);
        for (const c of cles) (g.maj ? n.delete(c) : n.add(c));
        return n;
      });
    if (fenetre) {
      const f: Bbox = { min: pt(Math.min(fenetre.a.x, fenetre.b.x), Math.min(fenetre.a.y, fenetre.b.y)), max: pt(Math.max(fenetre.a.x, fenetre.b.x), Math.max(fenetre.a.y, fenetre.b.y)) };
      // Vers la droite : entièrement dedans. Vers la gauche : tout ce qui est touché.
      const capture = fenetre.b.x < fenetre.a.x;
      basculer(elements.filter((el) => (capture ? toucheLaFenetre(el.traits, f) : contenuDans(el.traits, f))).map((el) => cleDeRef(el.ref)));
      setFenetre(null);
      return;
    }
    const i = designe(auPapier(e));
    if (i === null) {
      if (!g.maj) setSelection(new Set());
    } else basculer([cleDeRef((elements[i] as (typeof elements)[number]).ref)]);
  };

  /* ---------------- Rendu ---------------- */

  const enCours = curseur ? transformationEnCours(etape, curseur) : null;
  const fantomes = enCours ? choisis.flatMap((el) => traitsDe(transformer(el.source, enCours), sheet.echelle)) : [];
  const elastique = curseur ? apercu(etape, ctx).flatMap((e) => traitsDe(e, sheet.echelle)) : [];
  const longueurReelle = base && curseur ? Math.hypot(curseur.x - base.x, curseur.y - base.y) * sheet.echelle : null;

  const modifierSelection = (libelle: string, f: (e: EntiteDessin) => EntiteDessin): void => {
    if (choisis.length === 0) return;
    ecrire(libelle, modifier(r, choisis, f));
    setSelection(new Set());
  };

  /*
   * ⚠ Une frappe hors de la ligne de commande — après un clic sur un bouton du
   * panneau — y est ramenée, comme en DAO. Sans cela « 3 » changeait d'onglet
   * au lieu de s'écrire dans une coordonnée.
   */
  const rameneLaFrappe = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (dansUnChamp(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    e.stopPropagation();
    champ.current?.focus();
  };

  return (
    <div className="editeur" onKeyDown={rameneLaFrappe}>
      <div className="editeur-outils">
        {OUTILS.map((o) => (
          <button key={o} type="button" className={`plat${etape.cmd === o ? ' actif' : ''}`} onClick={() => lancer(o)} title={`${LIBELLE_COMMANDE[o]} (${Object.entries(ALIAS).find(([, n]) => n === o)?.[0] ?? ''})`}>
            {LIBELLE_COMMANDE[o]}
          </button>
        ))}
        <span className="separateur" />
        <button type="button" className={`plat${accrochageActif ? ' actif' : ''}`} onClick={() => setAccrochage((a) => !a)} title="F3">
          Accrochage
        </button>
        <button type="button" className={`plat${orthoActif ? ' actif' : ''}`} onClick={() => setOrtho((o) => !o)} title="F8">
          Ortho
        </button>
        <button type="button" className="plat" onClick={() => setVue(vueEtendue(W, H, taille.l, taille.h))}>
          Tout voir
        </button>
        <span className="separateur" />
        <button type="button" onClick={onQuitter}>
          Terminer l’édition
        </button>
      </div>

      <div className="editeur-corps">
        <div
          ref={cadre}
          className="editeur-cadre"
          onPointerDown={auPointeur}
          onPointerMove={enDeplacement}
          onPointerUp={relache}
          onPointerLeave={() => setBrut(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div ref={fond} className="editeur-fond" dangerouslySetInnerHTML={{ __html: svg }} />
          <svg className="editeur-calque" viewBox={`${vue.x} ${vue.y} ${vue.w} ${vue.h}`} preserveAspectRatio="none">
            {elements.map((el) => (el.aRevoir ? el.traits.map((t, j) => <Trait key={`${cleDeRef(el.ref)}-${j}`} e={t} H={H} couleur="#f08c00" epaisseur={2} />) : null))}
            {survol !== null && !selection.has(cleDeRef((elements[survol] as (typeof elements)[number]).ref)) &&
              (elements[survol] as (typeof elements)[number]).traits.map((t, j) => <Trait key={`s${j}`} e={t} H={H} couleur="#3b82f6" epaisseur={2} tirets="6 4" />)}
            {choisis.flatMap((el) => el.traits.map((t, j) => <Trait key={`${cleDeRef(el.ref)}-${j}`} e={t} H={H} couleur="#3b82f6" epaisseur={2.5} />))}
            {fantomes.map((t, j) => <Trait key={`f${j}`} e={t} H={H} couleur="#22a06b" epaisseur={1.5} />)}
            {elastique.map((t, j) => <Trait key={`e${j}`} e={t} H={H} couleur="#22a06b" epaisseur={1.5} />)}
            {fenetre && (
              <rect
                x={Math.min(fenetre.a.x, fenetre.b.x)}
                y={H - Math.max(fenetre.a.y, fenetre.b.y)}
                width={Math.abs(fenetre.b.x - fenetre.a.x)}
                height={Math.abs(fenetre.b.y - fenetre.a.y)}
                style={{ vectorEffect: 'non-scaling-stroke', stroke: fenetre.b.x < fenetre.a.x ? '#22a06b' : '#3b82f6', strokeWidth: 1, strokeDasharray: fenetre.b.x < fenetre.a.x ? '6 4' : undefined, fill: fenetre.b.x < fenetre.a.x ? 'rgba(34,160,107,0.08)' : 'rgba(59,130,246,0.08)' }}
              />
            )}
            {accroche && <Marqueur a={accroche} H={H} k={k} />}
            {curseur && <Reticule p={curseur} H={H} k={k} />}
          </svg>
        </div>
        <EditeurPanneau
          selection={choisis}
          calque={calque}
          setCalque={setCalque}
          hauteurTexte={hauteurTexte}
          setHauteurTexte={setHauteurTexte}
          modifier={modifierSelection}
          bilan={{ ajouts: r.ajouts.length, masques: r.masques.length, aRevoir: compose.aRevoir, masquesCaducs: compose.masquesCaducs }}
          valider={() => ecrire('Retouches vérifiées', valider(r, sheet))}
          reinitialiser={() => {
            ecrire('Retour à la planche générée', retouchesVides(sheet.id));
            setSelection(new Set());
          }}
        />
      </div>

      <div className="editeur-commande">
        <div className="journal">
          {journal.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
        <label className="ligne-de-commande">
          <span className="invite">{invite(etape)} :</span>
          <input
            ref={champ}
            autoFocus
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={auClavier}
            aria-label="Ligne de commande"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="etat">
          {curseur ? `X ${num(curseur.x, 1)}  Y ${num(curseur.y, 1)} mm papier` : '—'}
          {longueurReelle !== null ? ` · longueur ${num(longueurReelle, 0)} mm réels` : ''}
          {accroche ? ` · ${LIBELLE_ACCROCHAGE[accroche.mode]}` : ''} · échelle 1:{sheet.echelle} · {selection.size} sélectionné(s)
        </div>
      </div>
    </div>
  );
}
