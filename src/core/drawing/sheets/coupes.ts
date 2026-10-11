import { getProfile } from '../../catalog/index';
import { plateFrame } from '../../build/connections/geom';
import type { Plate } from '../../build/types';
import { contourDeTrou } from '../../geometry/holes';
import { fibreAbscissa, memberFrame, type Member } from '../../geometry/member';
import { sectionOutline, type Pt2 } from '../../geometry/section';
import { add, dot, scale } from '../../math/vec3';
import { dansLaBarre } from '../barre/vue';
import { bulleRepere } from '../dimension';
import { ECHELLES } from '../scale';
import { pt, type Bbox, type DrawScene, type Pt } from '../scene';
import { symboleSoudure } from '../weldSymbol';
import type { ElementFabrication } from './element';

/**
 * COUPES DE L'ÉLÉMENT ASSEMBLÉ — une par repère soudé, à grande échelle.
 *
 * ⚠ La vue de face d'un poteau de six mètres dit À QUELLE HAUTEUR souder un
 * gousset, jamais DE QUEL CÔTÉ de l'âme, à quelle distance de l'axe, ni ce qui
 * dépasse des semelles. Le soudeur le devinait. Comme sur un plan d'atelier
 * tracé à la main, chaque pièce soudée reçoit sa coupe repérée — A-A, B-B… —,
 * dont le trait est porté sur la vue de face à chaque endroit où elle se pose.
 *
 * Une tôle perpendiculaire à la barre — platine d'about, de pied, gousset de
 * tête — se montre en VUE, de face : son contour, ses trous, le profil derrière
 * elle. Une tôle ou une pièce parallèle à la barre se montre en COUPE : le
 * profil tranché et hachuré, la pièce à sa place. Toutes les cotes partent de
 * l'AXE du profil, d'où le traceur pointe.
 */

export interface Coupe {
  readonly lettre: string;
  readonly mode: 'coupe' | 'vue';
  /** Sens de vision le long de l'axe de la barre : +1 de l'origine vers l'extrémité. */
  readonly sens: 1 | -1;
  /** Abscisses de chaque occurrence, dans le repère de la barre : où se pose le trait. */
  readonly abscisses: readonly number[];
  readonly repere: string;
  /** Repères du même type que la coupe représente aussi : « idem GT2 ». */
  readonly idem: readonly string[];
  /** Première occurrence : c'est elle qui est dessinée. */
  readonly objet: { readonly kind: 'tole'; readonly pl: Plate } | { readonly kind: 'piece'; readonly m: Member };
}

/** Lettres de coupe, sans I ni O : on les confondrait avec 1 et 0. */
const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Point 3D de l'objet, dans le repère de la barre. */
type PointBarre = { s: number; y: number; z: number };

/** Les huit coins de l'objet, épaisseur comprise, dans le repère de la barre. */
function coins(e: ElementFabrication, o: Coupe['objet']): PointBarre[] {
  const m = e.membre;
  const f = memberFrame(m);
  if (o.kind === 'tole') {
    const { n } = plateFrame(o.pl);
    return o.pl.outline.flatMap((q) =>
      [-1, 1].map((k) =>
        dansLaBarre(f, m.start, add(add(o.pl.origin, add(scale(o.pl.u, q.y), scale(o.pl.v, q.z))), scale(n, (k * o.pl.thickness) / 2))),
      ),
    );
  }
  const x = o.m;
  const fx = memberFrame(x);
  const c = sectionOutline(getProfile(x.profileId), 4).outer;
  return (['cutStart', 'cutEnd'] as const).flatMap((cote) =>
    c.map((q) => {
      const sAbs = fibreAbscissa(fx, x.start, x[cote], q);
      return dansLaBarre(f, m.start, add(add(x.start, scale(fx.ax, sAbs)), add(scale(fx.ay, q.y), scale(fx.az, q.z))));
    }),
  );
}

/** Abscisse moyenne d'un objet le long de la barre. */
function abscisse(e: ElementFabrication, o: Coupe['objet']): number {
  const c = coins(e, o);
  return c.reduce((t, q) => t + q.s, 0) / Math.max(1, c.length);
}

/** Les coupes d'un élément, dans l'ordre où l'on rencontre leurs pièces depuis l'origine. */
export function coupesDe(e: ElementFabrication): Coupe[] {
  const m = e.membre;
  const f = memberFrame(m);
  const axe = { y: 0, z: 0 };
  const s0 = fibreAbscissa(f, m.start, m.cutStart, axe);
  const s1 = fibreAbscissa(f, m.start, m.cutEnd, axe);
  const groupes = new Map<string, { objets: Coupe['objet'][] }>();
  for (const pl of e.toles) {
    const g = groupes.get(pl.mark) ?? { objets: [] };
    g.objets.push({ kind: 'tole', pl });
    groupes.set(pl.mark, g);
  }
  for (const x of e.pieces) {
    const g = groupes.get(x.mark) ?? { objets: [] };
    g.objets.push({ kind: 'piece', m: x });
    groupes.set(x.mark, g);
  }
  const brutes = [...groupes.entries()].map(([repere, g]) => {
    const premier = g.objets[0] as Coupe['objet'];
    const abscisses = g.objets.map((o) => abscisse(e, o)).sort((a, b) => a - b);
    const perpendiculaire = premier.kind === 'tole' && Math.abs(dot(plateFrame(premier.pl).n, f.ax)) > 0.9;
    const auBout = (abscisses[0] as number) > (s0 + s1) / 2;
    return {
      repere,
      idem: [] as string[],
      objet: premier,
      abscisses,
      mode: perpendiculaire ? ('vue' as const) : ('coupe' as const),
      // Une platine se regarde depuis l'extérieur de son about.
      sens: perpendiculaire && auBout ? (-1 as const) : (1 as const),
    };
  });
  return brutes
    .sort((a, b) => (a.abscisses[0] as number) - (b.abscisses[0] as number))
    .map((c, i) => ({ ...c, lettre: LETTRES[i % LETTRES.length] as string }));
}

/**
 * LE PLAN DES VUES d'un élément — ce que chaque vue doit montrer, et rien de plus.
 *
 * ⚠ Une coupe par pièce soudée faisait sept coupes pour une traverse : le
 * soudeur ne savait plus laquelle regarder. Comme sur un plan d'atelier :
 *  - une platine posée sur un about se montre en VUE DE BOUT, désignée par une
 *    flèche repérée sur la vue de face (ISO 128-30) et dessinée SOUS
 *    l'extrémité qu'elle montre : la vue A sous l'about d'origine, à gauche, la
 *    dernière sous l'about d'extrémité, à droite ;
 *  - ce qui dépasse du profil se voit et se cote sur la VUE DE DESSUS ;
 *  - il ne reste en COUPE que ce qu'aucune de ces vues ne montre — une équerre
 *    entre les semelles, un gousset sous la traverse —, et UNE coupe par type
 *    de pièce : les autres du même type se posent pareil.
 */
export interface PlanDeVues {
  readonly gauche: Coupe | null;
  /** La même platine ferme les DEUX abouts : une seule vue, une flèche à chacun. */
  readonly deuxBouts: boolean;
  readonly droite: Coupe | null;
  readonly dessus: boolean;
  readonly coupes: readonly Coupe[];
}

export function planDeVues(e: ElementFabrication): PlanDeVues {
  const toutes = coupesDe(e);
  const enc = sectionOutline(getProfile(e.membre.profileId), 4).outer;
  const yMax = Math.max(...enc.map((q) => Math.abs(q.y)));
  const zMax = Math.max(...enc.map((q) => q.z));
  const m = e.membre;
  const f = memberFrame(m);
  const axe = { y: 0, z: 0 };
  const s0 = fibreAbscissa(f, m.start, m.cutStart, axe);
  const s1 = fibreAbscissa(f, m.start, m.cutEnd, axe);

  let gauche: Coupe | null = null;
  let droite: Coupe | null = null;
  let deuxBouts = false;
  const restantes: Coupe[] = [];
  for (const c of toutes) {
    const pres = (x: number): boolean => Math.abs(x - s0) < Math.abs(x - s1);
    if (aLAbout(e, c) && c.abscisses.some(pres) && c.abscisses.some((x) => !pres(x)) && !gauche && !droite) {
      gauche = { ...c, sens: 1 };
      deuxBouts = true;
      continue;
    }
    if (aLAbout(e, c)) {
      const aLOrigine = Math.abs((c.abscisses[0] as number) - s0) < Math.abs((c.abscisses[0] as number) - s1);
      if (aLOrigine && !gauche) gauche = { ...c, sens: 1 };
      else if (!aLOrigine && !droite) droite = { ...c, sens: -1 };
      else restantes.push(c);
    } else restantes.push(c);
  }
  // ⚠ Un plat de tube se voit d'en haut, mais pas COMMENT il traverse le tube
  // fendu : celui-là garde sa coupe.
  const visibleDuDessus = (c: Coupe): boolean =>
    !(c.objet.kind === 'tole' && c.objet.pl.kind === 'plat-tube') &&
    coins(e, c.objet).some((q) => Math.abs(q.y) > yMax + 1 || q.z > zMax - 1);
  const dessus = restantes.some(visibleDuDessus);
  // Une coupe par TYPE de pièce cachée ; la première rencontrée vaut pour les autres.
  const parType = new Map<string, Coupe>();
  for (const c of restantes.filter((x) => !visibleDuDessus(x))) {
    const type = c.objet.kind === 'tole' ? `tole:${c.objet.pl.kind}:${c.mode}` : `piece:${c.objet.m.role}`;
    const deja = parType.get(type);
    if (!deja) parType.set(type, { ...c, abscisses: [c.abscisses[0] as number], idem: [] });
    else parType.set(type, { ...deja, idem: [...deja.idem, c.repere] });
  }
  // Lettres dans l'ordre de lecture : vue de l'origine, coupes, vue de l'extrémité.
  let rang = 0;
  const lettre = (): string => LETTRES[rang++ % LETTRES.length] as string;
  const g = gauche ? { ...gauche, lettre: lettre() } : null;
  const coupes = [...parType.values()].map((c) => ({ ...c, lettre: lettre() }));
  const d = droite ? { ...droite, lettre: lettre() } : null;
  return { gauche: g, droite: d, deuxBouts, dessus, coupes };
}

/** Titre d'une coupe, tel qu'il s'écrit sous elle et se cherche sur la vue de face. */
export function titreDeCoupe(c: Coupe): string {
  return c.mode === 'vue' ? `VUE ${c.lettre}` : `COUPE ${c.lettre}-${c.lettre}`;
}

/* ------------------------------------------------------------------ */

const MARGE_G = 14;
const MARGE_D = 30;
const MARGE_B = 14;
const MARGE_H = 9;

/**
 * Trace une coupe dans sa case : titre, profil, pièce, perçages, cotes depuis
 * l'axe, symbole de soudure au joint et bulle de repère.
 */
export interface OptionsCoupe {
  /**
   * Ordonnée papier de l'axe du profil : une vue de bout se place à la hauteur
   * de la vue de face, comme le veut la projection.
   */
  readonly axeY?: number;
  /** Titre à la place de « COUPE A-A » : « VUE DE GAUCHE », par exemple. */
  readonly titre?: string;
}

export function dessinerCoupe(s: DrawScene, e: ElementFabrication, c: Coupe, zone: Bbox, opts: OptionsCoupe = {}): number {
  const m = e.membre;
  const profil = getProfile(m.profileId);
  const section = sectionOutline(profil, 8);
  const X = (y: number): number => -c.sens * y;
  const objet = coins(e, c.objet);
  const pts2 = (l: readonly Pt2[]): { x: number; y: number }[] => l.map((q) => ({ x: X(q.y), y: q.z }));
  const profilPts = pts2(section.outer);
  const objetPts = enveloppe(objet.map((q) => ({ x: X(q.y), y: q.z })));

  // Échelle : la plus grande qui loge profil et pièce dans la case, cotes comprises.
  const tous = [...profilPts, ...objetPts];
  const xMin = Math.min(...tous.map((q) => q.x));
  const xMax = Math.max(...tous.map((q) => q.x));
  const yMin = Math.min(...tous.map((q) => q.y));
  const yMax = Math.max(...tous.map((q) => q.y));
  const largeur = zone.max.x - zone.min.x - MARGE_G - MARGE_D;
  const hauteur = zone.max.y - zone.min.y - MARGE_B - MARGE_H;
  const axeY = opts.axeY;
  const tient = (k: number): boolean =>
    (xMax - xMin) / k <= largeur &&
    (axeY === undefined
      ? (yMax - yMin) / k <= hauteur
      : yMax / k <= zone.max.y - MARGE_H - axeY && -yMin / k <= axeY - zone.min.y - MARGE_B);
  const d = ECHELLES.find(tient) ?? (ECHELLES[ECHELLES.length - 1] as number);
  const cx = zone.min.x + MARGE_G + (largeur - (xMax - xMin) / d) / 2 - xMin / d;
  const cy = axeY ?? zone.min.y + MARGE_B + (hauteur - (yMax - yMin) / d) / 2 - yMin / d;
  const P = (q: { x: number; y: number }): Pt => pt(cx + q.x / d, cy + q.y / d);
  const versPapier = (q: PointBarre): Pt => P({ x: X(q.y), y: q.z });

  /* --- Profil : tranché et hachuré en coupe, caché derrière une platine en vue --- */
  const derriere = c.mode === 'vue' && aLAbout(e, c);
  const ext = profilPts.map(P);
  const trous = section.holes.map((r) => pts2(r).map(P));
  if (derriere) {
    s.polyligne(ext, true, 'cachee');
  } else {
    s.hachure(ext, trous, 1.2, 45);
    s.polyligne(ext, true, 'contour');
    for (const r of trous) s.polyligne(r, true, 'contour');
  }
  // Axes du profil : c'est d'eux que partent les cotes.
  const o = P({ x: 0, y: 0 });
  s.ligne(pt(P({ x: xMin, y: 0 }).x - 3, o.y), pt(P({ x: xMax, y: 0 }).x + 3, o.y), 'axe');
  s.ligne(pt(o.x, P({ x: 0, y: yMin }).y - 3), pt(o.x, P({ x: 0, y: yMax }).y + 3), 'axe');

  /* --- La pièce à sa place --- */
  const contour = objetPts.map(P);
  // Une tôle tranchée se hachure ; une pièce soudée — cornière, échantignolle —
  // se montre par sa silhouette : la hachurer en bloc la ferait croire pleine.
  if (c.mode === 'coupe' && c.objet.kind === 'tole') s.hachure(contour, [], 0.9, 135);
  s.polyligne(contour, true, 'contour');

  /* --- Perçages : en vraie forme s'ils sont vus de face, par leur axe sinon --- */
  const cotesX = new Set<number>([Math.round(Math.min(...objetPts.map((q) => q.x))), Math.round(Math.max(...objetPts.map((q) => q.x)))]);
  const cotesY = new Set<number>([Math.round(Math.min(...objetPts.map((q) => q.y))), Math.round(Math.max(...objetPts.map((q) => q.y)))]);
  if (c.objet.kind === 'tole') {
    const pl = c.objet.pl;
    const f = memberFrame(m);
    const { n } = plateFrame(pl);
    const local = (q: Pt2): PointBarre => dansLaBarre(f, m.start, add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z))));
    const deFace = Math.abs(dot(n, f.ax)) > 0.9;
    for (const h of pl.holes) {
      const centre = versPapier(local(h.at));
      if (deFace) {
        if (h.oblong) s.polyligne(contourDeTrou(h, 16).map((q) => versPapier(local(q))), true, 'contour');
        else s.cercle(centre, Math.max(0.4, h.d / 2 / d), 'contour');
        const q = local(h.at);
        cotesX.add(Math.round(X(q.y)));
        cotesY.add(Math.round(q.z));
      } else {
        // L'axe du boulon, à travers la tôle et un peu au-delà.
        const a = versPapier(dansLaBarre(f, m.start, add(add(pl.origin, add(scale(pl.u, h.at.y), scale(pl.v, h.at.z))), scale(n, pl.thickness + 6))));
        const b = versPapier(dansLaBarre(f, m.start, add(add(pl.origin, add(scale(pl.u, h.at.y), scale(pl.v, h.at.z))), scale(n, -(pl.thickness + 6)))));
        s.ligne(a, b, 'axe');
      }
    }
  }

  /* --- Cotes depuis l'axe : en travers sous le dessin, en hauteur à gauche --- */
  const yLigne = P({ x: 0, y: yMin }).y - 6;
  const xLigne = P({ x: xMin, y: 0 }).x - 6;
  ordonnees(s, [...cotesX].sort((a, b) => a - b), (v) => P({ x: v, y: yMin }), o, yLigne, 'h');
  ordonnees(s, [...cotesY].sort((a, b) => a - b), (v) => P({ x: xMin, y: v }), o, xLigne, 'v');

  /* --- Soudure au joint, repère de la pièce --- */
  const id = c.objet.kind === 'tole' ? c.objet.pl.id : c.objet.m.id;
  // Une platine d'about porte DEUX cordons — semelles et âme, à des gorges
  // différentes : un symbole chacun, empilés. Un seul aurait laissé l'âme au
  // jugement du soudeur.
  const cordons = [...new Map(e.soudures.filter((x) => x.between[1] === id).map((x) => [`${x.type}|${x.throat}`, x])).values()];
  const w = cordons[0];
  /*
   * Bulle À DROITE de la pièce, à mi-hauteur, et symbole de soudure AU-DESSUS :
   * les cotes occupent le dessous et la gauche. Posés au point le plus éloigné
   * de l'axe, bulle et symbole tombaient l'un sur l'autre, ou sur les cotes.
   */
  const xDroit = Math.max(...contour.map((q) => q.x));
  const yMinC = Math.min(...contour.map((q) => q.y));
  const yMaxC = Math.max(...contour.map((q) => q.y));
  const flanc = contour
    .filter((q) => q.x > xDroit - 0.5)
    .reduce((a, q) => (Math.abs(q.y - (yMinC + yMaxC) / 2) < Math.abs(a.y - (yMinC + yMaxC) / 2) ? q : a));
  const xLibre = Math.max(xDroit, ...ext.map((q) => q.x)) + 8;
  const bulle = pt(Math.min(zone.max.x - 5, xLibre), Math.max(zone.min.y + MARGE_B, Math.min(zone.max.y - MARGE_H - 4, (yMinC + yMaxC) / 2)));
  bulleRepere(s, bulle, flanc, c.repere, 3.4);
  if (w) {
    const joint = w.pourtour
      ? P({ x: Math.max(...profilPts.map((q) => q.x)), y: Math.max(...profilPts.map((q) => q.y)) })
      : contour.reduce((a, q) => (Math.hypot(q.x - o.x, q.y - o.y) < Math.hypot(a.x - o.x, a.y - o.y) ? q : a), contour[0] as Pt);
    const haut = Math.max(yMaxC, ...ext.map((q) => q.y)) + 4;
    const coude = pt(Math.min(zone.max.x - 28, Math.max(joint.x, o.x) + 8), Math.min(zone.max.y - MARGE_H - 1, Math.max(haut, bulle.y + 7)));
    for (const [k, x] of cordons.entries()) symboleSoudure(s, joint, pt(coude.x, coude.y - 7 * k), x);
  }

  s.texte(pt((zone.min.x + zone.max.x) / 2, zone.max.y - 4), `${opts.titre ?? titreDeCoupe(c)} — ${c.repere}${c.idem.length > 0 ? ` (idem ${c.idem.join(', ')})` : c.abscisses.length > 1 ? ` (×${c.abscisses.length})` : ''} — 1:${d}`, {
    hauteur: 2.2,
    gras: true,
    ancrage: 'centre',
  });
  return d;
}

/**
 * La tôle de cette vue est-elle posée sur un about de la barre ?
 *
 * ⚠ Elle l'est si elle est PARALLÈLE au plan de coupe et plaquée contre lui —
 * pas si son centre tombe sur l'about : la platine de genou, verticale sous une
 * traverse en pente, descend jusqu'au bas du jarret, et son centre se projette
 * à plusieurs centimètres de l'about.
 */
function aLAbout(e: ElementFabrication, c: Coupe): boolean {
  if (c.objet.kind !== 'tole') return false;
  const pl = c.objet.pl;
  const n = plateFrame(pl).n;
  const m = e.membre;
  return [m.cutStart, m.cutEnd].some(
    (plan) =>
      Math.abs(dot(n, plan.normal)) > 0.99 &&
      Math.abs(dot({ x: pl.origin.x - plan.point.x, y: pl.origin.y - plan.point.y, z: pl.origin.z - plan.point.z }, plan.normal)) <=
        pl.thickness,
  );
}

/**
 * Cotes en ordonnées depuis l'axe du profil : une ligne d'attache par valeur,
 * la valeur ABSOLUE écrite près de la ligne de cote — le traceur pointe de part
 * et d'autre de l'axe —, les textes écartés quand ils se toucheraient.
 */
export function ordonnees(
  s: DrawScene,
  valeurs: readonly number[],
  papierDe: (v: number) => Pt,
  origine: Pt,
  ligne: number,
  sens: 'h' | 'v',
  /** Côté de la ligne de cote par rapport au dessin : −1 dessous ou à gauche, +1 dessus. */
  cote: 1 | -1 = -1,
): void {
  const vals = [...new Set(valeurs)].filter((v) => Math.abs(v) > 0.5);
  if (vals.length === 0) return;
  const pos = (v: number): number => (sens === 'h' ? papierDe(v).x : papierDe(v).y);
  const o = sens === 'h' ? origine.x : origine.y;
  const extremes = [Math.min(o, ...vals.map(pos)), Math.max(o, ...vals.map(pos))];
  // Ligne de cote et repère d'origine, sur l'axe.
  if (sens === 'h') {
    s.ligne(pt(extremes[0] as number, ligne), pt(extremes[1] as number, ligne), 'cotation');
    s.cercle(pt(o, ligne), 0.8, 'cotation');
  } else {
    s.ligne(pt(ligne, extremes[0] as number), pt(ligne, extremes[1] as number), 'cotation');
    s.cercle(pt(ligne, o), 0.8, 'cotation');
  }
  let dernier = -Infinity;
  for (const v of [...vals].sort((a, b) => pos(a) - pos(b))) {
    const p = papierDe(v);
    const q = pos(v);
    const t = Math.max(q, dernier + 3);
    if (sens === 'h') {
      s.ligne(pt(q, p.y + cote), pt(q, ligne - cote * 0.8), 'cotation');
      s.texte(pt(t + 0.6, ligne + cote * 1.6), `${Math.abs(v)}`, {
        hauteur: 1.8,
        rotation: 90,
        ancrage: cote < 0 ? 'droite' : 'gauche',
        ligneDeBase: 'milieu',
      });
    } else {
      s.ligne(pt(p.x - cote, q), pt(ligne + cote * 0.8, q), 'cotation');
      s.texte(pt(ligne + cote * 1.4, t), `${Math.abs(v)}`, {
        hauteur: 1.8,
        ancrage: cote < 0 ? 'droite' : 'gauche',
        ligneDeBase: 'milieu',
      });
    }
    dernier = t;
  }
}

/** Enveloppe convexe, sens trigonométrique. */
function enveloppe(points: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const croix = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const bas: { x: number; y: number }[] = [];
  for (const q of p) {
    while (bas.length >= 2 && croix(bas[bas.length - 2]!, bas[bas.length - 1]!, q) <= 0) bas.pop();
    bas.push(q);
  }
  const haut: { x: number; y: number }[] = [];
  for (const q of [...p].reverse()) {
    while (haut.length >= 2 && croix(haut[haut.length - 2]!, haut[haut.length - 1]!, q) <= 0) haut.pop();
    haut.push(q);
  }
  return [...bas.slice(0, -1), ...haut.slice(0, -1)];
}
