import { castDraft } from 'immer';
import { useMemo, useRef, useState } from 'react';
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
import { poigneesDe, type Poignee } from '../../core/drawing/operations2d';
import {
  appliquerRetouches,
  cleDeRef,
  elementsEditables,
  modifier,
  retouchesVides,
  traitsDe,
  valider,
  type ElementEditable,
  type EntiteDessin,
  type RetouchesDePlanche,
} from '../../core/drawing/retouches';
import { DrawScene, pt, type Bbox, type DrawEntity, type Layer, type Pt } from '../../core/drawing/scene';
import type { Sheet } from '../../core/drawing/sheet';
import { sheetToSvg } from '../../render2d/svgString';
import { useProjectStore } from '../../state/store';
import { num } from '../format';
import { dansUnChamp } from '../raccourcis';
import { appliquerActions } from './actions';
import { CalqueEditeur } from './CalqueEditeur';
import { ALIAS, apercu, avancer, demarrer, dernierPoint, invite, LIBELLE_COMMANDE, REPOS, transformationEnCours, type Action, type Contexte, type Etape, type NomCommande, type Resultat } from './commandes';
import { attendUnObjet } from './commandesObjets';
import { EditeurPanneau } from './EditeurPanneau';
import { LigneDeCommande } from './LigneDeCommande';
import { lireSaisie, pointSaisi } from './saisie';
import { LIBELLE_ACCROCHAGE } from './Traits';
import { useVueEditeur } from './useVueEditeur';
import '../theme/editeur.css';

/**
 * ÉDITEUR DE PLANCHE — retoucher le plan comme dans un logiciel de DAO.
 *
 * Le plan généré est affiché dessous, tel que l'imprimera le dossier ; tout ce
 * que le dessinateur y fait est rangé dans les retouches de la planche, qui
 * survivent à la régénération. La ligne de commande garde le clavier : on tape
 * « L », Entrée, on clique ou l'on tape « @1000,0 » — comme partout ailleurs.
 */

const DESSIN: readonly NomCommande[] = ['ligne', 'polyligne', 'rectangle', 'cercle', 'arc', 'texte', 'cote', 'hachurer'];
const MODIFICATION: readonly NomCommande[] = ['deplacer', 'copier', 'rotation', 'miroir', 'echelle', 'decaler', 'ajuster', 'prolonger', 'effacer'];
/** Au-delà, les poignées encombreraient l'écran sans servir. */
const MAX_POIGNEES = 30;

type Glisse =
  | { readonly type: 'pan'; readonly x: number; readonly y: number }
  | { readonly type: 'fenetre'; readonly a: Pt; readonly x: number; readonly y: number; readonly maj: boolean };

export function Editeur({
  sheet,
  retouches,
  fondClair,
  onQuitter,
  cible,
}: {
  sheet: Sheet;
  retouches: RetouchesDePlanche | undefined;
  fondClair: boolean;
  onQuitter?: () => void;
  /** Repères d'une pièce venue de la 3D : la vue s'ouvre cadrée sur eux, sélectionnés. */
  cible?: readonly string[];
}): JSX.Element {
  const edit = useProjectStore((s) => s.edit);
  const r = useMemo(() => retouches ?? retouchesVides(sheet.id), [retouches, sheet.id]);
  const { largeur: W, hauteur: H } = FORMATS[sheet.format];
  const [masques, setMasques] = useState<ReadonlySet<Layer>>(new Set());

  const tous = useMemo(() => elementsEditables(sheet, r), [sheet, r]);
  // Les calques masqués disparaissent de l'écran, de la sélection et de l'accrochage — pas du plan imprimé.
  const elements = useMemo(() => (masques.size === 0 ? tous : tous.filter((el) => !masques.has(el.source.layer))), [tous, masques]);
  const compose = useMemo(() => appliquerRetouches(sheet, r), [sheet, r]);
  const svg = useMemo(() => {
    const affichee = masques.size === 0 ? compose.sheet : { ...compose.sheet, scene: filtrer(compose.sheet.scene, masques) };
    return sheetToSvg(affichee, fondClair ? {} : { encre: '#e6e9ef', papier: '#1b1f26' });
  }, [compose, fondClair, masques]);
  // Index à plat des traits, avec leur emprise : la désignation au pointeur et
  // l'accrochage ne parcourent que ceux dont la boîte est proche.
  const index = useMemo(() => elements.flatMap((el, i) => el.traits.map((t) => ({ t, i, b: emprise([t]) }))), [elements]);
  const traits = useMemo(() => index.map((x) => x.t), [index]);

  // Repères de la pièce venue de la 3D, cherchés une fois, à l'ouverture.
  // Ceux du DESSIN d'abord : la nomenclature de la planche porte aussi le repère,
  // et cadrer sur elle éloignerait la vue de la pièce.
  const [cibles] = useState(() => {
    if (!cible || cible.length === 0) return [];
    const trouves = tous.filter((el) => el.source.kind === 'texte' && cible.includes(el.source.texte));
    const dessin = trouves.filter((el) => el.source.layer === 'reperage');
    return dessin.length > 0 ? dessin : trouves;
  });
  const { cadre, fond, vue, k, auPapier, glisser, toutVoir } = useVueEditeur(W, H, svg, cibles.length > 0 ? emprise(cibles.flatMap((el) => el.traits)) : null);

  const champ = useRef<HTMLInputElement>(null);
  const [etape, setEtape] = useState<Etape>(REPOS);
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set(cibles.map((el) => cleDeRef(el.ref))));
  const [brut, setBrut] = useState<Pt | null>(null);
  const [orthoActif, setOrtho] = useState(false);
  const [accrochageActif, setAccrochage] = useState(true);
  const [calque, setCalque] = useState<Layer>('contour');
  const [hauteurTexte, setHauteurTexte] = useState(2.5);
  const [journal, setJournal] = useState<readonly string[]>(() =>
    cible && cible.length > 0
      ? [cibles.length > 0 ? `${cible.join(', ')} : ${cibles.length} repère(s) sur cette planche, sélectionnés` : `${cible.join(', ')} : aucun repère trouvé sur cette planche`]
      : [],
  );
  const [saisie, setSaisie] = useState('');
  const [fenetre, setFenetre] = useState<{ a: Pt; b: Pt } | null>(null);
  /** Poignée saisie : elle suit le pointeur jusqu'au clic qui la dépose. */
  const [chaude, setChaude] = useState<{ el: ElementEditable; poignee: Poignee } | null>(null);
  const glisse = useRef<Glisse | null>(null);
  const derniere = useRef<NomCommande | null>(null);

  const noter = (m: string): void => setJournal((j) => [...j.slice(-4), m]);
  const choisis = elements.filter((el) => selection.has(cleDeRef(el.ref)));
  const poignees = useMemo(
    () => (etape.cmd === 'repos' && choisis.length <= MAX_POIGNEES ? choisis.flatMap((el) => poigneesDe(el.source).map((poignee) => ({ el, poignee }))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [etape, selection, elements],
  );

  /** Traits proches d'un point, d'après leur emprise. */
  const proches = (p: Pt, tol: number): { t: DrawEntity; i: number }[] => {
    const zone: Bbox = { min: pt(p.x - tol, p.y - tol), max: pt(p.x + tol, p.y + tol) };
    return index.filter((x) => boitesSeTouchent(x.b, zone));
  };

  const actif = etape.cmd !== 'repos' || chaude !== null;
  const base = chaude ? chaude.poignee.p : dernierPoint(etape);
  /** Le point visé : accrochage d'abord, ortho sinon — rien quand on désigne un objet. */
  const viser = (p: Pt): { p: Pt; accroche: PointAccroche | null } => {
    if (!actif || attendUnObjet(etape)) return { p, accroche: null };
    if (accrochageActif) {
      const deja: DrawEntity[] =
        (etape.cmd === 'ligne' || etape.cmd === 'polyligne') && etape.points.length >= 2 ? [{ kind: 'polyligne', points: etape.points, fermee: false, layer: 'contour' }] : [];
      const a = accrocher(p, [...proches(p, 12 * k).map((x) => x.t), ...deja], 10 * k);
      if (a) return { p: a.p, accroche: a };
    }
    return { p: orthoActif && base ? ortho(base, p) : p, accroche: null };
  };
  const vise = brut ? viser(brut) : null;
  const accroche = vise?.accroche ?? null;
  const curseur: Pt | null = vise?.p ?? null;

  const ctx: Contexte = { echelle: sheet.echelle, curseur: curseur ?? pt(0, 0), nbSelection: selection.size, calque, hauteurTexte, traits, selection: choisis.map((el) => el.source) };

  /** Élément sous le pointeur : celui qu'un clic désignerait. */
  const designe = (p: Pt): ElementEditable | null => {
    let best: ElementEditable | null = null;
    let d = 6 * k;
    for (const x of proches(p, 6 * k)) {
      const dx = distanceA(p, x.t);
      if (dx <= d) {
        d = dx;
        best = elements[x.i] ?? null;
      }
    }
    return best;
  };
  const survol = (etape.cmd === 'repos' || attendUnObjet(etape)) && brut && !fenetre && !chaude ? designe(brut) : null;

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
    const { retouches: r2, libelle, vider } = appliquerActions(r, actions, choisis, elements);
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
    setChaude(null);
    noter(`> ${LIBELLE_COMMANDE[nom]}`);
    traiter(demarrer(nom, ctx));
    champ.current?.focus();
  };

  /** Dépose la poignée saisie : l'entité est retouchée, la sélection vidée. */
  const deposer = (p: Pt): void => {
    if (!chaude) return;
    ecrire('Poignée', modifier(r, [chaude.el], () => chaude.poignee.vers(p)));
    setChaude(null);
    setSelection(new Set());
  };

  const soumettre = (): void => {
    const t = saisie;
    setSaisie('');
    if (chaude) {
      // Poignée saisie : la valeur tapée est un déplacement depuis elle.
      const p = pointSaisi(lireSaisie(t), chaude.poignee.p, curseur ?? chaude.poignee.p, sheet.echelle);
      if (p) deposer(p);
      else noter(`Saisie non comprise : « ${t} ».`);
      return;
    }
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
      if (chaude) setChaude(null);
      else if (etape.cmd === 'repos') setSelection(new Set());
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
    const brutClic = auPapier(e);
    setBrut(brutClic);
    // Le point se lit sur le clic lui-même : un clic sans mouvement préalable compte.
    const p = viser(brutClic).p;
    if (chaude) return deposer(p);
    if (etape.cmd !== 'repos') {
      const objet = designe(brutClic);
      traiter(avancer(etape, { type: 'point', p, ...(objet ? { sous: { cle: cleDeRef(objet.ref), entite: objet.source } } : {}) }, { ...ctx, curseur: p }));
      return;
    }
    // Une poignée sous le pointeur se saisit ; sinon, sélection par clic ou fenêtre.
    const prise = poignees.find((x) => Math.hypot(x.poignee.p.x - brutClic.x, x.poignee.p.y - brutClic.y) <= 6 * k);
    if (prise) {
      setChaude(prise);
      return;
    }
    glisse.current = { type: 'fenetre', a: brutClic, x: e.clientX, y: e.clientY, maj: e.shiftKey };
  };

  const enDeplacement = (e: React.PointerEvent<HTMLDivElement>): void => {
    const p = auPapier(e);
    setBrut(p);
    const g = glisse.current;
    if (g?.type === 'pan') {
      glisser(e.clientX - g.x, e.clientY - g.y);
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
    const el = designe(auPapier(e));
    if (!el) {
      if (!g.maj) setSelection(new Set());
    } else basculer([cleDeRef(el.ref)]);
  };

  /* ---------------- Rendu ---------------- */

  const enCours = curseur ? transformationEnCours(etape, curseur) : null;
  const fantomes = enCours
    ? choisis.flatMap((el) => traitsDe(transformer(el.source, enCours), sheet.echelle))
    : chaude && curseur
      ? traitsDe(chaude.poignee.vers(curseur), sheet.echelle)
      : [];
  const elastique = curseur ? apercu(etape, ctx).flatMap((x) => traitsDe(x, sheet.echelle)) : [];
  const longueurReelle = base && curseur ? Math.hypot(curseur.x - base.x, curseur.y - base.y) * sheet.echelle : null;

  const modifierSelection = (libelle: string, f: (x: EntiteDessin) => EntiteDessin): void => {
    if (choisis.length === 0) return;
    ecrire(libelle, modifier(r, choisis, f));
    setSelection(new Set());
  };

  // Calques présents sur la planche, avec le nombre d'objets de chacun.
  const calques = useMemo(() => {
    const m = new Map<Layer, number>();
    for (const el of tous) m.set(el.source.layer, (m.get(el.source.layer) ?? 0) + 1);
    return [...m.entries()];
  }, [tous]);

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

  const bouton = (o: NomCommande): JSX.Element => (
    <button key={o} type="button" className={`plat${etape.cmd === o ? ' actif' : ''}`} onClick={() => lancer(o)} title={`${LIBELLE_COMMANDE[o]} (${Object.entries(ALIAS).find(([, n]) => n === o)?.[0] ?? ''})`}>
      {LIBELLE_COMMANDE[o]}
    </button>
  );

  return (
    <div className="editeur" onKeyDown={rameneLaFrappe}>
      <div className="editeur-outils">
        <span className="groupe-outils">Dessiner</span>
        {DESSIN.map(bouton)}
        <span className="separateur" />
        <span className="groupe-outils">Modifier</span>
        {MODIFICATION.map(bouton)}
        <span className="separateur" />
        <button type="button" className={`plat${accrochageActif ? ' actif' : ''}`} onClick={() => setAccrochage((a) => !a)} title="F3">
          Accrochage
        </button>
        <button type="button" className={`plat${orthoActif ? ' actif' : ''}`} onClick={() => setOrtho((o) => !o)} title="F8">
          Ortho
        </button>
        <button type="button" className="plat" onClick={toutVoir}>
          Tout voir
        </button>
        {onQuitter && (
          <button type="button" className="primaire" onClick={onQuitter}>
            Terminer l’édition
          </button>
        )}
      </div>

      <div className="editeur-corps">
        <div ref={cadre} className="editeur-cadre" onPointerDown={auPointeur} onPointerMove={enDeplacement} onPointerUp={relache} onPointerLeave={() => setBrut(null)} onContextMenu={(e) => e.preventDefault()}>
          <div ref={fond} className="editeur-fond" dangerouslySetInnerHTML={{ __html: svg }} />
          <CalqueEditeur
            vue={vue}
            H={H}
            k={k}
            elements={elements}
            survol={survol}
            choisis={choisis}
            fantomes={fantomes}
            elastique={elastique}
            fenetre={fenetre}
            poignees={poignees.map((x) => x.poignee.p)}
            poigneeChaude={chaude?.poignee.p ?? null}
            accroche={accroche}
            curseur={curseur}
          />
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
          calquesPlanche={calques}
          calquesMasques={masques}
          basculerCalque={(l) =>
            setMasques((m) => {
              const n = new Set(m);
              if (n.has(l)) n.delete(l);
              else n.add(l);
              return n;
            })
          }
        />
      </div>

      <LigneDeCommande
        champ={champ}
        journal={journal}
        invite={chaude ? 'Poignée — cliquez la nouvelle position, ou tapez un déplacement (@dx,dy) ; Échap pour annuler' : invite(etape)}
        saisie={saisie}
        setSaisie={setSaisie}
        auClavier={auClavier}
        etat={`${curseur ? `X ${num(curseur.x, 1)}  Y ${num(curseur.y, 1)} mm papier` : '—'}${longueurReelle !== null ? ` · longueur ${num(longueurReelle, 0)} mm réels` : ''}${accroche ? ` · ${LIBELLE_ACCROCHAGE[accroche.mode]}` : ''} · échelle 1:${sheet.echelle} · ${selection.size} sélectionné(s)`}
      />
    </div>
  );
}

/** La scène sans les entités des calques masqués. */
function filtrer(scene: DrawScene, masques: ReadonlySet<Layer>): DrawScene {
  const s = new DrawScene();
  for (const e of scene.entities) if (!masques.has(e.layer)) s.entite(e);
  return s;
}
