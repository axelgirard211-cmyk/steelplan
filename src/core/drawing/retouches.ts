import { coteLineaire } from './dimension';
import { DrawScene, type DrawEntity, type Pt } from './scene';
import type { Sheet } from './sheet';

/**
 * RETOUCHES DU DESSINATEUR SUR LES PLANCHES GÉNÉRÉES.
 *
 * ⚠ Les planches sont reconstruites depuis le modèle à chaque modification. Une
 * retouche écrite DANS la planche disparaîtrait donc au premier changement de
 * portée. Elle est gardée à côté, planche par planche, et réappliquée sur la
 * planche régénérée — c'est le fonctionnement des logiciels de charpente qui
 * séparent le dessin généré des retouches manuelles.
 *
 * Deux sortes de retouches suffisent à tout :
 *  - un AJOUT : une entité du dessinateur (trait, texte, cote…) ;
 *  - un MASQUE : une entité générée qu'il a effacée.
 * Modifier une entité générée, c'est la masquer et ajouter sa version modifiée,
 * qui garde trace de son ORIGINE. Si le modèle change cette entité, son
 * empreinte disparaît de la planche régénérée : la retouche est alors dite « à
 * revoir », jamais appliquée ni perdue en silence.
 */

/** Cote gardée entière, pour rester modifiable : sa valeur suit sa longueur. */
export interface CoteDessin {
  readonly kind: 'cote';
  readonly a: Pt;
  readonly b: Pt;
  /** Décalage de la ligne de cote, à gauche de a→b (mm papier). */
  readonly decalage: number;
  /** Texte imposé ; vide : la longueur réelle, à l'échelle de la planche. */
  readonly texte: string;
  readonly layer: 'cotation';
}

export type EntiteDessin = DrawEntity | CoteDessin;

export interface Ajout {
  readonly id: string;
  readonly entite: EntiteDessin;
  /** Empreinte de l'entité générée que cet ajout remplace, s'il en remplace une. */
  readonly origine: string;
}

export interface RetouchesDePlanche {
  /** Identifiant de la planche (`Sheet.id`). */
  readonly planche: string;
  readonly ajouts: readonly Ajout[];
  /** Empreintes des entités générées effacées. */
  readonly masques: readonly string[];
}

/** Référence d'une entité affichée : générée (par son empreinte) ou ajoutée. */
export type RefEntite = { readonly type: 'generee'; readonly cle: string } | { readonly type: 'ajout'; readonly id: string };

export const cleDeRef = (r: RefEntite): string => (r.type === 'generee' ? `g:${r.cle}` : `a:${r.id}`);

/** Une entité éditable : sa référence, sa source, et les traits qui la dessinent. */
export interface ElementEditable {
  readonly ref: RefEntite;
  readonly source: EntiteDessin;
  readonly traits: readonly DrawEntity[];
  /** Ajout dont l'entité d'origine a disparu de la planche régénérée. */
  readonly aRevoir: boolean;
}

const r2 = (v: number): string => (Math.round(v * 100) / 100).toFixed(2);
const pts = (l: readonly Pt[]): string => l.map((p) => `${r2(p.x)},${r2(p.y)}`).join(';');

/**
 * Empreinte d'une entité générée : sa nature, son calque, sa géométrie au
 * centième de millimètre et son texte. Deux régénérations d'un même modèle
 * donnent les mêmes empreintes ; un changement de modèle qui déplace l'entité
 * change la sienne.
 */
export function empreinte(e: DrawEntity): string {
  const t = `${e.kind}|${e.layer}`;
  switch (e.kind) {
    case 'ligne':
      return `${t}|${pts([e.a, e.b])}`;
    case 'polyligne':
      return `${t}|${e.fermee ? 'f' : 'o'}|${pts(e.points)}`;
    case 'cercle':
      return `${t}|${pts([e.c])}|${r2(e.r)}`;
    case 'arc':
      return `${t}|${pts([e.c])}|${r2(e.r)}|${r2(e.a0)}|${r2(e.a1)}`;
    case 'texte':
      return `${t}|${pts([e.at])}|${r2(e.hauteur)}|${r2(e.rotation)}|${e.texte}`;
    case 'hachure':
      return `${t}|${pts(e.contour)}|${e.trous.map(pts).join('/')}|${r2(e.pas)}|${r2(e.angle)}`;
    case 'remplissage':
      return `${t}|${pts(e.contour)}|${e.trous.map(pts).join('/')}|${r2(e.gris)}`;
  }
}

/** Empreintes des entités d'une planche, rendues uniques par leur rang d'apparition. */
export function empreintes(entites: readonly DrawEntity[]): string[] {
  const vus = new Map<string, number>();
  return entites.map((e) => {
    const base = empreinte(e);
    const n = vus.get(base) ?? 0;
    vus.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

/** Les traits qui dessinent une entité du dessinateur. */
export function traitsDe(e: EntiteDessin, echelle: number): DrawEntity[] {
  if (e.kind !== 'cote') return [e];
  const s = new DrawScene();
  const longueur = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) * echelle;
  coteLineaire(s, e.a, e.b, e.decalage, longueur, e.texte ? { texte: e.texte } : {});
  return [...s.entities];
}

/**
 * Les entités éditables d'une planche : les générées non effacées, puis les
 * ajouts du dessinateur, dans l'ordre où ils seront dessinés.
 */
export function elementsEditables(sheet: Sheet, r: RetouchesDePlanche | undefined): ElementEditable[] {
  const entites = sheet.scene.entities;
  const cles = empreintes(entites);
  const masques = new Set(r?.masques ?? []);
  const presentes = new Set(cles);
  const out: ElementEditable[] = [];
  for (const [i, e] of entites.entries()) {
    const cle = cles[i] as string;
    if (masques.has(cle)) continue;
    out.push({ ref: { type: 'generee', cle }, source: e, traits: [e], aRevoir: false });
  }
  for (const a of r?.ajouts ?? []) {
    out.push({
      ref: { type: 'ajout', id: a.id },
      source: a.entite,
      traits: traitsDe(a.entite, sheet.echelle),
      aRevoir: a.origine !== '' && !presentes.has(a.origine),
    });
  }
  return out;
}

export interface PlancheRetouchee {
  readonly sheet: Sheet;
  /** Retouches dont l'entité d'origine a disparu : le plan a changé sous elles. */
  readonly aRevoir: number;
  /** Effacements devenus sans objet : l'entité effacée n'existe plus. */
  readonly masquesCaducs: number;
}

/** La planche telle que l'imprimera le dossier : générée, puis retouchée. */
export function appliquerRetouches(sheet: Sheet, r: RetouchesDePlanche | undefined): PlancheRetouchee {
  if (!r || (r.ajouts.length === 0 && r.masques.length === 0)) return { sheet, aRevoir: 0, masquesCaducs: 0 };
  const elements = elementsEditables(sheet, r);
  const s = new DrawScene();
  for (const el of elements) for (const t of el.traits) s.entite(t);
  const presentes = new Set(empreintes(sheet.scene.entities));
  return {
    sheet: { ...sheet, scene: s },
    aRevoir: elements.filter((e) => e.aRevoir).length,
    masquesCaducs: r.masques.filter((m) => !presentes.has(m)).length,
  };
}

/* ------------------------------------------------------------------ */
/* Opérations — pures : chacune rend les nouvelles retouches.           */
/* ------------------------------------------------------------------ */

export const retouchesVides = (planche: string): RetouchesDePlanche => ({ planche, ajouts: [], masques: [] });

let compteur = 0;
/** Identifiant d'ajout : unique dans la session, lisible dans le fichier. */
export function nouvelId(): string {
  compteur += 1;
  return `r${Date.now().toString(36)}${compteur.toString(36)}`;
}

export function ajouter(r: RetouchesDePlanche, entites: readonly EntiteDessin[], id: () => string = nouvelId): RetouchesDePlanche {
  return { ...r, ajouts: [...r.ajouts, ...entites.map((entite) => ({ id: id(), entite, origine: '' }))] };
}

/** Efface : une entité générée est masquée, un ajout est retiré. */
export function effacer(r: RetouchesDePlanche, refs: readonly RefEntite[]): RetouchesDePlanche {
  const ids = new Set(refs.flatMap((x) => (x.type === 'ajout' ? [x.id] : [])));
  const cles = refs.flatMap((x) => (x.type === 'generee' ? [x.cle] : []));
  return {
    ...r,
    ajouts: r.ajouts.filter((a) => !ids.has(a.id)),
    masques: [...new Set([...r.masques, ...cles])],
  };
}

/**
 * Modifie des entités. Un ajout est modifié en place ; une entité générée est
 * masquée et remplacée par un ajout qui garde son origine.
 */
export function modifier(
  r: RetouchesDePlanche,
  elements: readonly ElementEditable[],
  f: (e: EntiteDessin) => EntiteDessin,
  id: () => string = nouvelId,
): RetouchesDePlanche {
  const parId = new Map(elements.flatMap((el) => (el.ref.type === 'ajout' ? [[el.ref.id, el] as const] : [])));
  const generees = elements.filter((el) => el.ref.type === 'generee');
  return {
    ...r,
    ajouts: [
      ...r.ajouts.map((a) => (parId.has(a.id) ? { ...a, entite: f(a.entite) } : a)),
      ...generees.map((el) => ({ id: id(), entite: f(el.source), origine: (el.ref as { cle: string }).cle })),
    ],
    masques: [...new Set([...r.masques, ...generees.map((el) => (el.ref as { cle: string }).cle)])],
  };
}

/** Copie des entités, transformées : de nouveaux ajouts, sans origine. */
export function copier(
  r: RetouchesDePlanche,
  elements: readonly ElementEditable[],
  f: (e: EntiteDessin) => EntiteDessin,
  id: () => string = nouvelId,
): RetouchesDePlanche {
  return ajouter(r, elements.map((el) => f(el.source)), id);
}

/**
 * Retire les effacements devenus sans objet et adopte les retouches à revoir :
 * le dessinateur a vérifié, elles deviennent des ajouts ordinaires.
 */
export function valider(r: RetouchesDePlanche, sheet: Sheet): RetouchesDePlanche {
  const presentes = new Set(empreintes(sheet.scene.entities));
  return {
    ...r,
    masques: r.masques.filter((m) => presentes.has(m)),
    ajouts: r.ajouts.map((a) => (a.origine !== '' && !presentes.has(a.origine) ? { ...a, origine: '' } : a)),
  };
}
