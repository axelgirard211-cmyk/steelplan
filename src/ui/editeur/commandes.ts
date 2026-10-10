import {
  homothetie,
  rotationAutour,
  symetrie,
  translation,
  type Affine,
} from '../../core/drawing/geometrie2d';
import type { CoteDessin, EntiteDessin } from '../../core/drawing/retouches';
import { pt, type Layer, type Pt } from '../../core/drawing/scene';
import { lireSaisie, pointSaisi } from './saisie';

/**
 * COMMANDES DE L'ÉDITEUR — une machine à états, sans écran.
 *
 * Chaque commande avance d'étape en étape au gré des points cliqués, des valeurs
 * tapées, d'Entrée et d'Échap, exactement comme la ligne de commande d'un
 * logiciel de DAO. Elle ne touche à rien : elle rend des ACTIONS (ajouter des
 * entités, transformer la sélection, l'effacer), que l'éditeur applique aux
 * retouches de la planche. C'est ce qui permet de la vérifier sans navigateur.
 */

export type NomCommande =
  | 'ligne'
  | 'polyligne'
  | 'rectangle'
  | 'cercle'
  | 'texte'
  | 'cote'
  | 'deplacer'
  | 'copier'
  | 'rotation'
  | 'miroir'
  | 'echelle'
  | 'effacer';

/** Alias de la ligne de commande : ceux de la DAO, en français et en anglais. */
export const ALIAS: Readonly<Record<string, NomCommande>> = {
  L: 'ligne',
  LIGNE: 'ligne',
  LINE: 'ligne',
  PL: 'polyligne',
  POLYLIGNE: 'polyligne',
  PLINE: 'polyligne',
  REC: 'rectangle',
  RECTANG: 'rectangle',
  RECTANGLE: 'rectangle',
  C: 'cercle',
  CERCLE: 'cercle',
  CIRCLE: 'cercle',
  T: 'texte',
  TEXTE: 'texte',
  TEXT: 'texte',
  COT: 'cote',
  COTE: 'cote',
  DIM: 'cote',
  M: 'deplacer',
  D: 'deplacer',
  DEPLACER: 'deplacer',
  MOVE: 'deplacer',
  CO: 'copier',
  CP: 'copier',
  COPIER: 'copier',
  COPY: 'copier',
  RO: 'rotation',
  ROTATION: 'rotation',
  ROTATE: 'rotation',
  MI: 'miroir',
  MIROIR: 'miroir',
  MIRROR: 'miroir',
  SC: 'echelle',
  EC: 'echelle',
  ECHELLE: 'echelle',
  SCALE: 'echelle',
  E: 'effacer',
  EF: 'effacer',
  EFFACER: 'effacer',
  ERASE: 'effacer',
};

export const LIBELLE_COMMANDE: Readonly<Record<NomCommande, string>> = {
  ligne: 'Ligne',
  polyligne: 'Polyligne',
  rectangle: 'Rectangle',
  cercle: 'Cercle',
  texte: 'Texte',
  cote: 'Cote',
  deplacer: 'Déplacer',
  copier: 'Copier',
  rotation: 'Rotation',
  miroir: 'Miroir',
  echelle: 'Échelle',
  effacer: 'Effacer',
};

/** Commandes qui portent sur la sélection : on sélectionne d'abord, puis on agit. */
const SUR_SELECTION: ReadonlySet<NomCommande> = new Set(['deplacer', 'copier', 'rotation', 'miroir', 'echelle', 'effacer']);

export type Etape =
  | { readonly cmd: 'repos' }
  | { readonly cmd: 'ligne' | 'polyligne'; readonly points: readonly Pt[] }
  | { readonly cmd: 'rectangle' | 'cercle' | 'texte' | 'miroir'; readonly a: Pt | null }
  | { readonly cmd: 'cote'; readonly a: Pt | null; readonly b: Pt | null }
  | { readonly cmd: 'deplacer' | 'copier' | 'rotation' | 'echelle'; readonly base: Pt | null };

export type Evenement =
  | { readonly type: 'point'; readonly p: Pt }
  | { readonly type: 'saisie'; readonly texte: string }
  | { readonly type: 'valider' }
  | { readonly type: 'echap' };

export type Action =
  | { readonly type: 'ajouter'; readonly entites: readonly EntiteDessin[]; readonly libelle: string }
  | { readonly type: 'transformer'; readonly affine: Affine; readonly copie: boolean; readonly libelle: string }
  | { readonly type: 'effacer' };

export interface Contexte {
  /** Dénominateur de l'échelle de la planche : les saisies sont en mm réels. */
  readonly echelle: number;
  /** Position du pointeur, accrochage et ortho appliqués (mm papier). */
  readonly curseur: Pt;
  readonly nbSelection: number;
  readonly calque: Layer;
  /** Hauteur des textes et des chiffres de cote (mm papier). */
  readonly hauteurTexte: number;
}

export interface Resultat {
  readonly etape: Etape;
  readonly actions: readonly Action[];
  /** Message d'erreur ou d'information, s'il y a lieu. */
  readonly message?: string;
}

export const REPOS: Etape = { cmd: 'repos' };

const fin = (actions: Action[] = [], message?: string): Resultat => ({ etape: REPOS, actions, ...(message ? { message } : {}) });

/** Lance une commande depuis son nom ou son alias. */
export function demarrer(nom: NomCommande, ctx: Contexte): Resultat {
  if (SUR_SELECTION.has(nom) && ctx.nbSelection === 0) {
    return fin([], `${LIBELLE_COMMANDE[nom]} : sélectionnez d’abord les objets, puis relancez la commande.`);
  }
  switch (nom) {
    case 'effacer':
      return fin([{ type: 'effacer' }]);
    case 'ligne':
    case 'polyligne':
      return { etape: { cmd: nom, points: [] }, actions: [] };
    case 'rectangle':
    case 'cercle':
    case 'texte':
    case 'miroir':
      return { etape: { cmd: nom, a: null }, actions: [] };
    case 'cote':
      return { etape: { cmd: 'cote', a: null, b: null }, actions: [] };
    default:
      return { etape: { cmd: nom, base: null }, actions: [] };
  }
}

/** Ce que la ligne de commande demande à cette étape. */
export function invite(e: Etape): string {
  switch (e.cmd) {
    case 'repos':
      return 'Commande (L, PL, REC, C, T, COT, M, CO, RO, MI, SC, E) — ou sélectionnez des objets';
    case 'ligne':
      return e.points.length === 0 ? 'Ligne — premier point' : 'Ligne — point suivant [C pour fermer, Entrée pour finir]';
    case 'polyligne':
      return e.points.length === 0 ? 'Polyligne — premier point' : 'Polyligne — point suivant [C pour fermer, Entrée pour finir]';
    case 'rectangle':
      return e.a ? 'Rectangle — coin opposé (@largeur,hauteur)' : 'Rectangle — premier coin';
    case 'cercle':
      return e.a ? 'Cercle — rayon (mm) ou point du cercle' : 'Cercle — centre';
    case 'texte':
      return e.a ? 'Texte — tapez le texte puis Entrée' : 'Texte — point d’insertion';
    case 'cote':
      return !e.a ? 'Cote — première origine' : !e.b ? 'Cote — seconde origine' : 'Cote — position de la ligne de cote';
    case 'miroir':
      return e.a ? 'Miroir — second point de l’axe' : 'Miroir — premier point de l’axe';
    case 'deplacer':
    case 'copier':
      return e.base ? `${LIBELLE_COMMANDE[e.cmd]} — point de destination${e.cmd === 'copier' ? ' [Entrée pour finir]' : ''}` : `${LIBELLE_COMMANDE[e.cmd]} — point de base`;
    case 'rotation':
      return e.base ? 'Rotation — angle (degrés) ou point' : 'Rotation — centre de rotation';
    case 'echelle':
      return e.base ? 'Échelle — facteur (ex. 2 ou 0.5)' : 'Échelle — point de base';
  }
}

/** Le dernier point posé : base des saisies relatives et de l'ortho. */
export function dernierPoint(e: Etape): Pt | null {
  switch (e.cmd) {
    case 'ligne':
    case 'polyligne':
      return e.points[e.points.length - 1] ?? null;
    case 'rectangle':
    case 'cercle':
    case 'miroir':
    case 'texte':
      return e.a;
    case 'cote':
      return e.b ?? e.a;
    case 'deplacer':
    case 'copier':
    case 'rotation':
    case 'echelle':
      return e.base;
    default:
      return null;
  }
}

const angleDe = (base: Pt, p: Pt): number => Math.atan2(p.y - base.y, p.x - base.x);

/** Décalage d'une ligne de cote passant par `p`, à gauche de a→b. */
function decalageVers(a: Pt, b: Pt, p: Pt): number {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return ((p.x - a.x) * -(b.y - a.y) + (p.y - a.y) * (b.x - a.x)) / l;
}

const cote = (a: Pt, b: Pt, decalage: number): CoteDessin => ({ kind: 'cote', a, b, decalage, texte: '', layer: 'cotation' });

function rectangle(a: Pt, b: Pt, calque: Layer): EntiteDessin {
  return { kind: 'polyligne', points: [a, pt(b.x, a.y), b, pt(a.x, b.y)], fermee: true, layer: calque };
}

/**
 * Transformation que produirait la commande si le point courant était validé,
 * pour l'aperçu de la sélection qui suit le pointeur.
 */
export function transformationEnCours(e: Etape, p: Pt): Affine | null {
  switch (e.cmd) {
    case 'deplacer':
    case 'copier':
      return e.base ? translation(p.x - e.base.x, p.y - e.base.y) : null;
    case 'rotation':
      return e.base ? rotationAutour(e.base, angleDe(e.base, p)) : null;
    case 'miroir':
      return e.a && Math.hypot(p.x - e.a.x, p.y - e.a.y) > 1e-6 ? symetrie(e.a, p) : null;
    default:
      return null;
  }
}

/** Entités en cours de tracé, pour l'aperçu élastique. */
export function apercu(e: Etape, ctx: Contexte): EntiteDessin[] {
  const p = ctx.curseur;
  switch (e.cmd) {
    case 'ligne':
    case 'polyligne': {
      const l = [...e.points, p];
      return l.length >= 2 ? [{ kind: 'polyligne', points: l, fermee: false, layer: ctx.calque }] : [];
    }
    case 'rectangle':
      return e.a ? [rectangle(e.a, p, ctx.calque)] : [];
    case 'cercle':
      return e.a ? [{ kind: 'cercle', c: e.a, r: Math.max(0.01, Math.hypot(p.x - e.a.x, p.y - e.a.y)), layer: ctx.calque }] : [];
    case 'cote':
      if (e.a && e.b) return [cote(e.a, e.b, decalageVers(e.a, e.b, p))];
      return e.a ? [{ kind: 'ligne', a: e.a, b: p, layer: 'cotation' }] : [];
    case 'miroir':
      return e.a ? [{ kind: 'ligne', a: e.a, b: p, layer: 'axe' }] : [];
    case 'rotation':
    case 'echelle':
    case 'deplacer':
    case 'copier':
      return e.base ? [{ kind: 'ligne', a: e.base, b: p, layer: 'axe' }] : [];
    default:
      return [];
  }
}

/** Fait avancer la commande d'un évènement. */
export function avancer(e: Etape, ev: Evenement, ctx: Contexte): Resultat {
  if (ev.type === 'echap') return finir(e, ctx);
  if (e.cmd === 'repos') {
    if (ev.type !== 'saisie') return { etape: e, actions: [] };
    const nom = ALIAS[ev.texte.trim().toUpperCase()];
    return nom ? demarrer(nom, ctx) : { etape: e, actions: [], message: `Commande inconnue : « ${ev.texte.trim()} ».` };
  }

  // Le texte en cours de saisie n'est pas une coordonnée : on le pose tel quel.
  if (e.cmd === 'texte' && e.a && ev.type === 'saisie') {
    const t = ev.texte.trim();
    if (t === '') return fin();
    return fin([{ type: 'ajouter', libelle: 'Texte', entites: [{ kind: 'texte', at: e.a, texte: t, hauteur: ctx.hauteurTexte, ancrage: 'gauche', ligneDeBase: 'bas', rotation: 0, gras: false, layer: 'texte' }] }]);
  }

  if (ev.type === 'valider') return finir(e, ctx);

  const base = dernierPoint(e);
  let p: Pt | null = null;
  if (ev.type === 'point') p = ev.p;
  else {
    const s = lireSaisie(ev.texte);
    // Valeurs propres à une étape : rayon, angle, facteur, fermeture.
    if (s.type === 'nombre') {
      if (e.cmd === 'cercle' && e.a) {
        if (s.v <= 0) return { etape: e, actions: [], message: 'Le rayon doit être positif.' };
        return fin([{ type: 'ajouter', libelle: 'Cercle', entites: [{ kind: 'cercle', c: e.a, r: s.v / ctx.echelle, layer: ctx.calque }] }]);
      }
      if (e.cmd === 'rotation' && e.base) {
        return fin([{ type: 'transformer', copie: false, libelle: 'Rotation', affine: rotationAutour(e.base, (s.v * Math.PI) / 180) }]);
      }
      if (e.cmd === 'echelle' && e.base) {
        if (s.v <= 0) return { etape: e, actions: [], message: 'Le facteur doit être positif.' };
        return fin([{ type: 'transformer', copie: false, libelle: 'Échelle', affine: homothetie(e.base, s.v) }]);
      }
      if (e.cmd === 'cote' && e.a && e.b) {
        // Décalage tapé en mm réels, du côté où se trouve le pointeur.
        const signe = Math.sign(decalageVers(e.a, e.b, ctx.curseur)) || 1;
        return fin([{ type: 'ajouter', libelle: 'Cote', entites: [cote(e.a, e.b, (signe * s.v) / ctx.echelle)] }]);
      }
    }
    if (s.type === 'mot' && /^[CF]$/i.test(s.texte) && (e.cmd === 'ligne' || e.cmd === 'polyligne')) return fermer(e, ctx);
    p = pointSaisi(s, base, ctx.curseur, ctx.echelle);
    if (!p) return { etape: e, actions: [], message: `Saisie non comprise : « ${ev.texte.trim()} ».` };
  }
  return poser(e, p, ctx);
}

/** Un point est posé : la commande avance, ou se termine. */
function poser(e: Etape, p: Pt, ctx: Contexte): Resultat {
  switch (e.cmd) {
    case 'ligne': {
      const prec = e.points[e.points.length - 1];
      const actions: Action[] = prec ? [{ type: 'ajouter', libelle: 'Ligne', entites: [{ kind: 'ligne', a: prec, b: p, layer: ctx.calque }] }] : [];
      return { etape: { cmd: 'ligne', points: [...e.points, p] }, actions };
    }
    case 'polyligne':
      return { etape: { cmd: 'polyligne', points: [...e.points, p] }, actions: [] };
    case 'rectangle':
      if (!e.a) return { etape: { ...e, a: p }, actions: [] };
      return fin([{ type: 'ajouter', libelle: 'Rectangle', entites: [rectangle(e.a, p, ctx.calque)] }]);
    case 'cercle':
      if (!e.a) return { etape: { ...e, a: p }, actions: [] };
      return fin([{ type: 'ajouter', libelle: 'Cercle', entites: [{ kind: 'cercle', c: e.a, r: Math.hypot(p.x - e.a.x, p.y - e.a.y), layer: ctx.calque }] }]);
    case 'texte':
      return { etape: { ...e, a: e.a ?? p }, actions: [] };
    case 'cote':
      if (!e.a) return { etape: { ...e, a: p }, actions: [] };
      if (!e.b) return { etape: { ...e, b: p }, actions: [] };
      return fin([{ type: 'ajouter', libelle: 'Cote', entites: [cote(e.a, e.b, decalageVers(e.a, e.b, p))] }]);
    case 'miroir':
      if (!e.a) return { etape: { ...e, a: p }, actions: [] };
      return fin([{ type: 'transformer', copie: true, libelle: 'Miroir', affine: symetrie(e.a, p) }]);
    case 'deplacer':
    case 'copier':
    case 'rotation':
    case 'echelle': {
      if (!e.base) return { etape: { ...e, base: p }, actions: [] };
      // ⚠ Une échelle « au point » n'a pas de référence sur le papier : le facteur se tape.
      if (e.cmd === 'echelle') return { etape: e, actions: [], message: 'Tapez le facteur d’échelle (ex. 2 ou 0.5).' };
      const affine = transformationEnCours(e, p);
      if (!affine) return { etape: e, actions: [] };
      const action: Action = { type: 'transformer', copie: e.cmd === 'copier', libelle: LIBELLE_COMMANDE[e.cmd], affine };
      // La copie se répète jusqu'à Entrée, depuis la même base.
      return e.cmd === 'copier' ? { etape: e, actions: [action] } : fin([action]);
    }
    default:
      return { etape: e, actions: [] };
  }
}

/** « C » : la ligne ou la polyligne revient à son premier point. */
function fermer(e: Extract<Etape, { cmd: 'ligne' | 'polyligne' }>, ctx: Contexte): Resultat {
  const [premier] = e.points;
  const dernier = e.points[e.points.length - 1];
  if (!premier || !dernier || e.points.length < 3) return { etape: e, actions: [], message: 'Il faut au moins trois points pour fermer.' };
  if (e.cmd === 'ligne') return fin([{ type: 'ajouter', libelle: 'Ligne', entites: [{ kind: 'ligne', a: dernier, b: premier, layer: ctx.calque }] }]);
  return fin([{ type: 'ajouter', libelle: 'Polyligne', entites: [{ kind: 'polyligne', points: e.points, fermee: true, layer: ctx.calque }] }]);
}

/** Entrée ou Échap : la commande se termine, en gardant ce qui est acquis. */
function finir(e: Etape, ctx: Contexte): Resultat {
  if (e.cmd === 'polyligne' && e.points.length >= 2) {
    return fin([{ type: 'ajouter', libelle: 'Polyligne', entites: [{ kind: 'polyligne', points: e.points, fermee: false, layer: ctx.calque }] }]);
  }
  return fin();
}
