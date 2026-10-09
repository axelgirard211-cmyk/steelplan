import { getProfile } from '../../catalog/index';
import { diametreNominal, type BoltPlacement } from '../../build/bolts';
import { contourJarret } from '../../build/jarret';
import type { Haunch, Plate } from '../../build/types';
import { contourDeTrou } from '../../geometry/holes';
import { fibreAbscissa, memberFrame, sectionPointAt, type Member } from '../../geometry/member';
import type { Pt2 } from '../../geometry/section';
import type { Weld } from '../../geometry/weld';
import { add, dot, scale, type Vec3 } from '../../math/vec3';
import { bulleRepere, chaineDeCotes, coteLineaire } from '../dimension';
import { choisirEchelle } from '../scale';
import { pt, type Bbox, type DrawScene, type Pt } from '../scene';
import { appliquer, cadrer, project, viewNormal, type Transform2D, type ViewDir } from '../view';
import { symboleSoudure } from '../weldSymbol';
import { sectionCoupee, silhouette } from './ensemble';

/**
 * VUE D'ÉLÉVATION D'UN NŒUD — ce que l'atelier regarde pour préfabriquer.
 *
 * ⚠ La planche de détail dessinait des silhouettes : un poteau en I y était un
 * rectangle, sans semelles ; aucun boulon n'y figurait ; ses cotes de perçage
 * étaient calculées sur un point faux et partaient en biais. Ici :
 *  - les barres sont tracées avec leurs semelles et coupées par une LIGNE DE
 *    RUPTURE là où le détail les interrompt ;
 *  - les barres que la vue traverse sont en section hachurée ;
 *  - chaque boulon est dessiné à ses cotes — tête, tige, écrou — ou vu en bout ;
 *  - les repères sont rangés en marge, sans se chevaucher ni chevaucher le
 *    dessin ; les soudures en colonne, chacune reliée à son cordon.
 */

export interface ContexteNoeud {
  readonly noeud: Vec3;
  readonly rayon: number;
  readonly v: ViewDir;
  readonly barres: readonly Member[];
  readonly toles: readonly Plate[];
  readonly jarrets: readonly Haunch[];
  readonly cordons: readonly Weld[];
  readonly boulons: readonly BoltPlacement[];
}

/** Marge papier réservée autour du dessin pour repères et soudures (mm). */
const MARGE = 22;

export function dessinerElevationDuNoeud(
  s: DrawScene,
  c: ContexteNoeud,
  zone: Bbox,
): { t: Transform2D; echelle: number; dessin: Bbox; ancres: Map<string, Pt>; cadre: Bbox } {
  const n0 = project(c.noeud, c.v);
  /*
   * ⚠ Le cadre du détail serre l'ASSEMBLAGE — ses tôles, son jarret, ses
   * boulons —, à 250 mm près, pas un carré du rayon de voisinage : au genou, ce
   * carré descendait de deux mètres le long du poteau, et le nœud tombait au
   * 1:20 dans un coin de la feuille.
   */
  const large: Bbox = { min: pt(n0.x - c.rayon, n0.y - c.rayon), max: pt(n0.x + c.rayon, n0.y + c.rayon) };
  // Les tôles du NŒUD — pas les plats d'une lisse qui passe plus bas sur le poteau.
  const DU_NOEUD: readonly Plate['kind'][] = ['platine-about', 'platine-pied', 'gousset-cv', 'plat-tube', 'gousset-tete', 'eclisse', 'gousset'];
  const toles = c.toles.filter((pl) => DU_NOEUD.includes(pl.kind));
  const ids = new Set(toles.map((pl) => pl.id));
  const assemblage = [
    n0,
    ...toles.flatMap((pl) => pl.outline.map((q) => project(sommet(pl, q), c.v))),
    ...c.jarrets.flatMap((j) => {
      const k = contourJarret(j);
      return [k.haut, k.bas, k.pointe].map((q) => project(q, c.v));
    }),
    ...c.boulons.filter((b) => b.pieces.some((id) => ids.has(id))).map((b) => project(b.at, c.v)),
  ].filter((q) => dans(q, large));
  const serre = boite(assemblage);
  const rect: Bbox = {
    min: pt(Math.max(large.min.x, serre.min.x - 200), Math.max(large.min.y, serre.min.y - 200)),
    max: pt(Math.min(large.max.x, serre.max.x + 200), Math.min(large.max.y, serre.max.y + 200)),
  };
  const vues = c.barres.map((m) => ({ m, coupe: estVueEnSection(m, c.v), sil: decouper(silhouette(m, c.v), rect) }));

  const points = [
    ...vues.flatMap((x) => x.sil),
    ...c.toles.flatMap((pl) => pl.outline.map((q) => project(sommet(pl, q), c.v))),
  ].filter((q) => dans(q, rect));
  const emprise = boite(points.length > 0 ? points : [n0]);
  const interieur: Bbox = { min: pt(zone.min.x + MARGE, zone.min.y + MARGE), max: pt(zone.max.x - MARGE - 12, zone.max.y - MARGE) };
  const echelle = choisirEchelle(emprise, interieur, 1.02);
  const t = cadrer(emprise, interieur, echelle);
  const P = (q: Pt): Pt => appliquer(t, q);

  /* --- Barres --- */
  // Où pointer le repère de chaque barre DESSINÉE : sur sa partie visible.
  const ancres = new Map<string, Pt>();
  for (const x of vues) {
    if (x.coupe) {
      const q = project(x.m.start, c.v);
      if (!dans(q, rect)) continue;
      sectionCoupee(s, t, x.m, c.v);
      ancres.set(x.m.id, P(q));
      continue;
    }
    if (x.sil.length < 3) continue;
    tracerAvecRuptures(s, x.sil.map(P), rect, t);
    lignesInterieures(s, t, x.m, c.v, rect);
    const g = x.sil.reduce((a, q) => pt(a.x + q.x / x.sil.length, a.y + q.y / x.sil.length), pt(0, 0));
    ancres.set(x.m.id, P(g));
  }

  /* --- Jarrets : la tôle d'âme et sa semelle --- */
  for (const j of c.jarrets) {
    const k = contourJarret(j);
    const poly = decouper([k.haut, k.bas, k.pointe].map((q) => project(q, c.v)), rect);
    if (poly.length >= 3) tracerAvecRuptures(s, poly.map(P), rect, t);
  }

  /* --- Tôles --- */
  for (const pl of c.toles) dessinerTole(s, t, pl, c.v);

  /* --- Boulons --- */
  for (const b of c.boulons) {
    if (!dans(project(b.at, c.v), rect)) continue;
    dessinerBoulon(s, t, b, c.v);
  }

  const dessin = boite([...vues.flatMap((x) => x.sil), ...points].map(P));
  return { t, echelle, dessin, ancres, cadre: rect };
}

/** Une barre que le plan de vue traverse se voit en section. */
function estVueEnSection(m: Member, v: ViewDir): boolean {
  const f = memberFrame(m);
  return Math.abs(dot(f.ax, v.right)) < 0.05 && Math.abs(dot(f.ax, v.up)) < 0.05;
}

/**
 * Contour d'une barre, ses côtés coupés par le cadre du détail remplacés par une
 * ligne de rupture : la pièce continue au-delà.
 */
function tracerAvecRuptures(s: DrawScene, poly: readonly Pt[], rect: Bbox, t: Transform2D): void {
  const r = { min: appliquer(t, rect.min), max: appliquer(t, rect.max) };
  const surLeBord = (a: Pt, b: Pt): boolean => {
    const eps = 0.05;
    return (
      (Math.abs(a.x - r.min.x) < eps && Math.abs(b.x - r.min.x) < eps) ||
      (Math.abs(a.x - r.max.x) < eps && Math.abs(b.x - r.max.x) < eps) ||
      (Math.abs(a.y - r.min.y) < eps && Math.abs(b.y - r.min.y) < eps) ||
      (Math.abs(a.y - r.max.y) < eps && Math.abs(b.y - r.max.y) < eps)
    );
  };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    if (surLeBord(a, b)) rupture(s, a, b);
    else s.ligne(a, b, 'contour');
  }
}

/** Ligne de rupture : un trait fin brisé en son milieu. */
export function rupture(s: DrawScene, a: Pt, b: Pt): void {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l < 1e-6) return;
  const ux = (b.x - a.x) / l;
  const uy = (b.y - a.y) / l;
  const nx = -uy;
  const ny = ux;
  const m = (k: number): Pt => pt(a.x + ux * l * k, a.y + uy * l * k);
  const h = Math.min(2.5, l / 4);
  const c = m(0.5);
  s.polyligne(
    [a, pt(c.x - ux * h * 0.6, c.y - uy * h * 0.6), pt(c.x - ux * h * 0.2 + nx * h, c.y - uy * h * 0.2 + ny * h), pt(c.x + ux * h * 0.2 - nx * h, c.y + uy * h * 0.2 - ny * h), pt(c.x + ux * h * 0.6, c.y + uy * h * 0.6), b],
    false,
    'contour-fin',
  );
}

/**
 * Arêtes intérieures d'un profil vu de côté : les semelles d'un I ou d'un U vu
 * dans le plan de son âme, l'âme cachée d'un I vu de semelle.
 */
function lignesInterieures(s: DrawScene, t: Transform2D, m: Member, v: ViewDir, rect: Bbox): void {
  const pr = getProfile(m.profileId);
  if (pr.shape !== 'I' && pr.shape !== 'U') return;
  const f = memberFrame(m);
  const n = viewNormal(v);
  const ameVisible = Math.abs(dot(f.az, n)) < 0.2;
  const fibres: { q: { y: number; z: number }; layer: 'contour-fin' | 'cachee' }[] = ameVisible
    ? [-1, 1].map((k) => ({ q: { y: 0, z: k * (pr.h / 2 - pr.tf) }, layer: 'contour-fin' as const }))
    : Math.abs(dot(f.ay, n)) < 0.2 && pr.shape === 'I'
      ? [-1, 1].map((k) => ({ q: { y: (k * pr.tw) / 2, z: 0 }, layer: 'cachee' as const }))
      : [];
  for (const { q, layer } of fibres) {
    const s0 = fibreAbscissa(f, m.start, m.cutStart, q);
    const s1 = fibreAbscissa(f, m.start, m.cutEnd, q);
    const seg = decouperSegment(project(sectionPointAt(f, m.start, s0, q), v), project(sectionPointAt(f, m.start, s1, q), v), rect);
    if (seg) s.ligne(appliquer(t, seg[0]), appliquer(t, seg[1]), layer);
  }
}

/** Tôle vue de chant (hachurée) ou de face (contour et perçages). */
function dessinerTole(s: DrawScene, t: Transform2D, pl: Plate, v: ViewDir): void {
  const P = (q: Pt2): Pt => appliquer(t, project(sommet(pl, q), v));
  const contour = pl.outline.map(P);
  const nPl = normale(pl);
  const deChant = Math.abs(dot(nPl, viewNormal(v))) < 0.2;
  if (deChant) {
    // Vue de chant : l'épaisseur se dessine — les deux faces, décalées de ±t/2.
    const e = scale(nPl, pl.thickness / 2);
    const faces = [-1, 1].map((k) => pl.outline.map((q) => appliquer(t, project(add(sommet(pl, q), scale(e, k)), v))));
    const tous = [...(faces[0] as Pt[]), ...(faces[1] as Pt[])];
    const enveloppe = envelopper(tous);
    s.hachure(enveloppe, [], 0.9, 135);
    s.polyligne(enveloppe, true, 'contour');
    return;
  }
  s.polyligne(contour, true, 'contour');
  for (const h of pl.holes) {
    const c = P(h.at);
    const r = (h.d / 2) * t.facteur;
    if (h.oblong) s.polyligne(contourDeTrou(h).map(P), true, 'contour-fin');
    else s.cercle(c, Math.max(r, 0.4), 'contour-fin');
  }
}

/**
 * Boulon à ses cotes : vu de côté, sa tête, sa tige et son écrou ; vu en bout,
 * l'hexagone de sa tête et la croix de son axe.
 */
function dessinerBoulon(s: DrawScene, t: Transform2D, b: BoltPlacement, v: ViewDir): void {
  const dn = diametreNominal(b);
  const k = t.facteur;
  const a = project(b.at, v);
  const ax = pt(dot(b.axis, v.right), dot(b.axis, v.up));
  const la = Math.hypot(ax.x, ax.y);
  const A = appliquer(t, a);
  const e = 0.75 * dn / Math.cos(Math.PI / 6); // demi-diagonale sur angles
  if (la < 0.3) {
    const r = e * k;
    s.polyligne(Array.from({ length: 6 }, (_, i) => pt(A.x + r * Math.cos((i * Math.PI) / 3), A.y + r * Math.sin((i * Math.PI) / 3))), true, 'contour-fin');
    s.cercle(A, (dn / 2) * k, 'contour-fin');
    s.ligne(pt(A.x - r - 1, A.y), pt(A.x + r + 1, A.y), 'axe');
    s.ligne(pt(A.x, A.y - r - 1), pt(A.x, A.y + r + 1), 'axe');
    return;
  }
  const u = pt(ax.x / la, ax.y / la);
  const nrm = pt(-u.y, u.x);
  const le = (d: number, lat: number): Pt => pt(A.x + (u.x * d + nrm.x * lat) * k, A.y + (u.y * d + nrm.y * lat) * k);
  const rect = (d0: number, d1: number, demi: number): Pt[] => [le(d0, -demi), le(d1, -demi), le(d1, demi), le(d0, demi)];
  const tete = 0.65 * dn;
  const ecrou = 0.8 * dn;
  const depasse = b.grip + ecrou + Math.max(3, 0.3 * dn);
  s.polyligne(rect(-tete, 0, e), true, 'contour-fin');
  s.polyligne(rect(b.grip, b.grip + ecrou, e), true, 'contour-fin');
  s.ligne(le(0, -dn / 2), le(depasse, -dn / 2), 'contour-fin');
  s.ligne(le(0, dn / 2), le(depasse, dn / 2), 'contour-fin');
  s.ligne(le(-tete - 2 / k, 0), le(depasse + 2 / k, 0), 'axe');
}

/* ------------------------------------------------------------------ */
/* Repères en marge et soudures en colonne                              */
/* ------------------------------------------------------------------ */

/**
 * Bulles de repère rangées sur le pourtour du dessin, chacune reliée à sa pièce.
 * ⚠ Posées à côté de la pièce, elles se superposaient aux symboles de soudure et
 * aux autres bulles — « PL2 » se lisait à travers un « a6 ».
 */
export function reperesEnMarge(
  s: DrawScene,
  dessin: Bbox,
  cibles: readonly { repere: string; vers: Pt }[],
): void {
  const centre = pt((dessin.min.x + dessin.max.x) / 2, (dessin.min.y + dessin.max.y) / 2);
  const ecart = 11;
  const cotes = new Map<'gauche' | 'haut' | 'bas', { repere: string; vers: Pt; pos: number }[]>([
    ['gauche', []],
    ['haut', []],
    ['bas', []],
  ]);
  for (const c of cibles) {
    const dx = c.vers.x - centre.x;
    const dy = c.vers.y - centre.y;
    const cote = Math.abs(dy) > Math.abs(dx) * 0.6 ? (dy > 0 ? 'haut' : 'bas') : 'gauche';
    (cotes.get(cote) as { repere: string; vers: Pt; pos: number }[]).push({ ...c, pos: cote === 'gauche' ? c.vers.y : c.vers.x });
  }
  for (const [cote, liste] of cotes) {
    liste.sort((a, b) => a.pos - b.pos);
    for (let i = 1; i < liste.length; i++) {
      const prec = liste[i - 1] as { pos: number };
      const x = liste[i] as { pos: number };
      if (x.pos - prec.pos < ecart) x.pos = prec.pos + ecart;
    }
    for (const x of liste) {
      const at =
        cote === 'gauche'
          ? pt(dessin.min.x - 12, x.pos)
          : cote === 'haut'
            ? pt(x.pos, dessin.max.y + 10)
            : pt(x.pos, dessin.min.y - 10);
      bulleRepere(s, at, x.vers, x.repere, 4);
    }
  }
}

/**
 * Symboles de soudure posés PRÈS de leur cordon, en haut à droite, décalés
 * l'un de l'autre quand ils se toucheraient.
 * ⚠ En colonne au bord du dessin, leurs lignes de repère traversaient tout le
 * nœud et se croisaient.
 */
export function souduresEnColonne(s: DrawScene, dessin: Bbox, cordons: readonly { w: Weld; at: Pt }[]): void {
  const poses: Pt[] = [];
  const libre = (q: Pt): boolean => poses.every((x) => Math.abs(x.y - q.y) > 7 || Math.abs(x.x - q.x) > 42);
  for (const c of [...cordons].sort((a, b) => b.at.y - a.at.y)) {
    let q = pt(Math.min(c.at.x + 14, dessin.max.x - 30), c.at.y + 12);
    for (let k = 0; k < 12 && !libre(q); k++) q = pt(q.x, q.y + 7);
    poses.push(q);
    symboleSoudure(s, c.at, q, c.w);
  }
}

/**
 * Chaîne de cotes des rangées de boulons d'une platine vue de chant, de son bord
 * haut à son bord bas, à côté du dessin.
 */
export function coterRangees(s: DrawScene, t: Transform2D, pl: Plate, v: ViewDir, cote: 'gauche' | 'droite'): void {
  const P = (q: Pt2): Pt => appliquer(t, project(sommet(pl, q), v));
  const ys = pl.outline.map((q) => P(q).y);
  const xs = pl.outline.map((q) => P(q).x);
  const rangees = [...new Set(pl.holes.map((h) => Math.round(P(h.at).y * 100) / 100))];
  const lignes = [Math.max(...ys), ...rangees, Math.min(...ys)].sort((a, b) => b - a);
  const x = cote === 'gauche' ? Math.min(...xs) : Math.max(...xs);
  const points = lignes.map((y) => pt(x, y));
  const valeurs = lignes.slice(1).map((y, i) => Math.round(((lignes[i] as number) - y) / t.facteur));
  if (points.length < 2) return;
  chaineDeCotes(s, points, cote === 'gauche' ? 10 : -10, valeurs, { total: true, decalageTotal: cote === 'gauche' ? 20 : -20 });
}

/** Cote simple entre deux points du modèle. */
export function coteModele(s: DrawScene, t: Transform2D, v: ViewDir, a: Vec3, b: Vec3, decalage: number): void {
  const A = appliquer(t, project(a, v));
  const B = appliquer(t, project(b, v));
  coteLineaire(s, A, B, decalage, Math.round(Math.hypot(B.x - A.x, B.y - A.y) / t.facteur));
}

/* ------------------------------------------------------------------ */

export function sommet(pl: Plate, q: Pt2): Vec3 {
  return add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z)));
}

function normale(pl: Plate): Vec3 {
  const u = pl.u;
  const w = pl.v;
  const n = { x: u.y * w.z - u.z * w.y, y: u.z * w.x - u.x * w.z, z: u.x * w.y - u.y * w.x };
  const l = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / l, y: n.y / l, z: n.z / l };
}

function dans(q: Pt, r: Bbox): boolean {
  return q.x >= r.min.x - 1e-6 && q.x <= r.max.x + 1e-6 && q.y >= r.min.y - 1e-6 && q.y <= r.max.y + 1e-6;
}

function boite(pts: readonly Pt[]): Bbox {
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { min: pt(Math.min(...xs), Math.min(...ys)), max: pt(Math.max(...xs), Math.max(...ys)) };
}

/** Polygone découpé par un rectangle (Sutherland–Hodgman). */
function decouper(poly: readonly Pt[], r: Bbox): Pt[] {
  let p = [...poly];
  const bords: ((q: Pt) => number)[] = [(q) => q.x - r.min.x, (q) => r.max.x - q.x, (q) => q.y - r.min.y, (q) => r.max.y - q.y];
  for (const d of bords) {
    if (p.length === 0) break;
    const out: Pt[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i] as Pt;
      const b = p[(i + 1) % p.length] as Pt;
      const da = d(a);
      const db = d(b);
      if (da >= 0) out.push(a);
      if (da >= 0 !== db >= 0) {
        const k = da / (da - db);
        out.push(pt(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k));
      }
    }
    p = out;
  }
  return p.length >= 3 ? p : [];
}

/** Segment découpé par un rectangle (Liang–Barsky), ou null s'il est dehors. */
function decouperSegment(a: Pt, b: Pt, r: Bbox): [Pt, Pt] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - r.min.x],
    [dx, r.max.x - a.x],
    [-dy, a.y - r.min.y],
    [dy, r.max.y - a.y],
  ] as const) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const k = q / p;
    if (p < 0) t0 = Math.max(t0, k);
    else t1 = Math.min(t1, k);
    if (t0 > t1) return null;
  }
  return [pt(a.x + dx * t0, a.y + dy * t0), pt(a.x + dx * t1, a.y + dy * t1)];
}

/** Enveloppe convexe de points du papier. */
function envelopper(points: readonly Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const x = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const bas: Pt[] = [];
  for (const q of p) {
    while (bas.length >= 2 && x(bas[bas.length - 2] as Pt, bas[bas.length - 1] as Pt, q) <= 0) bas.pop();
    bas.push(q);
  }
  const haut: Pt[] = [];
  for (const q of [...p].reverse()) {
    while (haut.length >= 2 && x(haut[haut.length - 2] as Pt, haut[haut.length - 1] as Pt, q) <= 0) haut.pop();
    haut.push(q);
  }
  return [...bas.slice(0, -1), ...haut.slice(0, -1)];
}
