import { ajuster, arcPar3Points, decaler, prolonger } from '../../core/drawing/operations2d';
import type { EntiteDessin } from '../../core/drawing/retouches';
import type { Pt } from '../../core/drawing/scene';
import type { Action, Contexte, Evenement, NomCommande, Resultat } from './commandes';
import { lireSaisie } from './saisie';

/**
 * COMMANDES QUI DÉSIGNENT UN OBJET — arc, décaler, ajuster, prolonger, hachurer.
 *
 * Comme les autres, une machine à états sans écran ; elles reçoivent en plus,
 * avec le point cliqué, l'objet qui se trouve dessous.
 */

/** Objet désigné au clic : sa clé d'édition et l'entité qu'il est. */
export interface ObjetDesigne {
  readonly cle: string;
  readonly entite: EntiteDessin;
}

export type EtapeObjet =
  | { readonly cmd: 'arc'; readonly points: readonly Pt[] }
  | { readonly cmd: 'decaler'; readonly distance: number | null; readonly objet: ObjetDesigne | null }
  | { readonly cmd: 'ajuster' | 'prolonger' };

export const NOMS_OBJET: ReadonlySet<NomCommande> = new Set(['arc', 'decaler', 'ajuster', 'prolonger', 'hachurer']);
export const estEtapeObjet = (e: { readonly cmd: string }): e is EtapeObjet =>
  e.cmd === 'arc' || e.cmd === 'decaler' || e.cmd === 'ajuster' || e.cmd === 'prolonger';

/**
 * L'étape attend-elle un OBJET plutôt qu'un point ? L'accrochage est alors
 * coupé : ramené sur une extrémité, le clic désignerait la ligne voisine, ou
 * le mauvais côté de la coupure.
 */
export const attendUnObjet = (e: { readonly cmd: string }): boolean =>
  e.cmd === 'ajuster' || e.cmd === 'prolonger' || (e.cmd === 'decaler' && (e as Extract<EtapeObjet, { cmd: 'decaler' }>).distance !== null && (e as Extract<EtapeObjet, { cmd: 'decaler' }>).objet === null);

const reste = (etape: EtapeObjet, actions: Action[] = [], message?: string): Resultat => ({ etape, actions, ...(message ? { message } : {}) });
const fini = (actions: Action[] = [], message?: string): Resultat => ({ etape: { cmd: 'repos' }, actions, ...(message ? { message } : {}) });

export function demarrerObjet(nom: NomCommande, ctx: Contexte): Resultat {
  switch (nom) {
    case 'arc':
      return reste({ cmd: 'arc', points: [] });
    case 'decaler':
      return reste({ cmd: 'decaler', distance: null, objet: null });
    case 'ajuster':
    case 'prolonger':
      return reste({ cmd: nom });
    default: {
      // Hachurer : les contours fermés de la sélection.
      const fermes = (ctx.selection ?? []).filter((e): e is Extract<EntiteDessin, { kind: 'polyligne' }> => e.kind === 'polyligne' && e.fermee && e.points.length >= 3);
      if (fermes.length === 0) return fini([], 'Hachurer : sélectionnez d’abord des contours fermés (rectangle, polyligne fermée).');
      return fini([
        {
          type: 'ajouter',
          libelle: 'Hachure',
          entites: fermes.map((e) => ({ kind: 'hachure', contour: e.points, trous: [], pas: 2, angle: 45, layer: 'hachure' })),
        },
      ]);
    }
  }
}

export function inviteObjet(e: EtapeObjet): string {
  switch (e.cmd) {
    case 'arc':
      return ['Arc — point de départ', 'Arc — point de passage', 'Arc — point d’arrivée'][e.points.length] ?? 'Arc';
    case 'decaler':
      return e.distance === null ? 'Décaler — distance (mm réels)' : e.objet ? 'Décaler — cliquez le côté' : 'Décaler — objet à décaler [Entrée pour finir]';
    case 'ajuster':
      return 'Ajuster — cliquez le tronçon à retirer [Entrée pour finir]';
    case 'prolonger':
      return 'Prolonger — cliquez la ligne près du bout à allonger [Entrée pour finir]';
  }
}

export function dernierPointObjet(e: EtapeObjet): Pt | null {
  return e.cmd === 'arc' ? (e.points[e.points.length - 1] ?? null) : null;
}

export function apercuObjet(e: EtapeObjet, ctx: Contexte): EntiteDessin[] {
  if (e.cmd === 'arc') {
    if (e.points.length === 1) return [{ kind: 'ligne', a: e.points[0] as Pt, b: ctx.curseur, layer: ctx.calque }];
    if (e.points.length === 2) {
      const a = arcPar3Points(e.points[0] as Pt, e.points[1] as Pt, ctx.curseur, ctx.calque);
      return a ? [a] : [];
    }
    return [];
  }
  if (e.cmd === 'decaler' && e.distance !== null && e.objet) {
    const d = decaler(e.objet.entite, e.distance, ctx.curseur);
    return d ? [d] : [];
  }
  return [];
}

export function avancerObjet(e: EtapeObjet, ev: Evenement, ctx: Contexte): Resultat {
  if (ev.type === 'echap' || ev.type === 'valider') return fini();
  switch (e.cmd) {
    case 'arc': {
      if (ev.type !== 'point') return reste(e, [], 'Arc : cliquez trois points.');
      const points = [...e.points, ev.p];
      if (points.length < 3) return reste({ cmd: 'arc', points });
      const arc = arcPar3Points(points[0] as Pt, points[1] as Pt, points[2] as Pt, ctx.calque);
      return arc ? fini([{ type: 'ajouter', libelle: 'Arc', entites: [arc] }]) : reste({ cmd: 'arc', points: points.slice(0, 2) }, [], 'Arc : les trois points sont alignés.');
    }
    case 'decaler': {
      if (e.distance === null) {
        if (ev.type !== 'saisie') return reste(e, [], 'Décaler : tapez d’abord la distance.');
        const s = lireSaisie(ev.texte);
        if (s.type !== 'nombre' || s.v <= 0) return reste(e, [], 'Décaler : la distance est un nombre positif, en mm réels.');
        return reste({ ...e, distance: s.v / ctx.echelle });
      }
      if (ev.type !== 'point') return reste(e);
      if (!e.objet) {
        if (!ev.sous) return reste(e, [], 'Décaler : aucun objet sous le pointeur.');
        if (!decaler(ev.sous.entite, e.distance, ev.p)) return reste(e, [], 'Décaler : lignes, polylignes, cercles et arcs seulement.');
        return reste({ ...e, objet: ev.sous });
      }
      const copie = decaler(e.objet.entite, e.distance, ev.p);
      // Comme en DAO, la commande reprend sur un nouvel objet, à la même distance.
      return reste({ ...e, objet: null }, copie ? [{ type: 'ajouter', libelle: 'Décaler', entites: [copie] }] : []);
    }
    case 'ajuster':
    case 'prolonger': {
      if (ev.type !== 'point') return reste(e);
      const o = ev.sous;
      if (!o || o.entite.kind !== 'ligne') return reste(e, [], `${e.cmd === 'ajuster' ? 'Ajuster' : 'Prolonger'} : cliquez une ligne.`);
      const autres = (ctx.traits ?? []).filter((t) => t !== o.entite);
      if (e.cmd === 'ajuster') {
        const morceaux = ajuster(o.entite, ev.p, autres);
        return morceaux
          ? reste(e, [{ type: 'remplacer', cle: o.cle, par: morceaux, libelle: 'Ajuster' }])
          : reste(e, [], 'Ajuster : aucun trait ne coupe cette ligne.');
      }
      const longue = prolonger(o.entite, ev.p, autres);
      return longue
        ? reste(e, [{ type: 'remplacer', cle: o.cle, par: [longue], libelle: 'Prolonger' }])
        : reste(e, [], 'Prolonger : la ligne ne rencontre aucun trait de ce côté.');
    }
  }
}
