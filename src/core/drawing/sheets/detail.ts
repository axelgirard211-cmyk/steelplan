import { getProfile } from '../../catalog/index';
import { contourDeTrou, designationDeTrou } from '../../geometry/holes';
import type { Plate, StructuralModel } from '../../build/types';
import { memberFrame, type Member } from '../../geometry/member';
import { sectionOutline, type Pt2 } from '../../geometry/section';
import { designationSoudure, type Weld } from '../../geometry/weld';
import { add, cross, dot, normalize, scale, type Vec3 } from '../../math/vec3';
import { roundMm } from '../../math/tolerance';
import { buildingLength } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import { bulleRepere, chaineDeCotes } from '../dimension';
import { dessinerCadre, fenetreDe, type CartoucheData, type SheetFormat } from '../layout';
import { choisirEchelle } from '../scale';
import { DrawScene, pt, type Bbox, type Pt } from '../scene';
import type { Sheet } from '../sheet';
import { appliquer, cadrer, project, VUE_LONG_PAN, VUE_TRANSVERSALE, type Transform2D, type ViewDir } from '../view';
import { symboleSoudure } from '../weldSymbol';
import { silhouette } from './ensemble';

/**
 * DÉTAILS D'ASSEMBLAGE.
 *
 * Une planche par nœud remarquable : le genou, le faîtage, le pied de poteau.
 * On y voit les barres en vraie forme, les tôles avec leurs perçages, les cotes
 * d'implantation des trous et les symboles de soudure — soit tout ce qu'il faut
 * pour préfabriquer le nœud sans avoir à interpréter.
 *
 * L'échelle est nécessairement plus grande que sur les plans d'ensemble : c'est
 * ce qui distingue un détail d'une vue. Elle reste normalisée.
 */

export interface DetailOptions {
  readonly format?: SheetFormat;
  readonly page: number;
  readonly total: number;
  readonly meta: CartoucheData['meta'];
  /**
   * Lettre du renvoi, la même que porte la bulle tracée sur la coupe. Attribuée
   * par le dossier, une seule fois, pour que les deux ne puissent pas diverger.
   */
  readonly lettre?: string;
}

/** Nœuds détaillés, dans l'ordre de lecture d'un dossier. */
export type DetailKind = 'genou' | 'faitage' | 'pied' | 'palee';

const TITRES: Record<DetailKind, string> = {
  genou: 'Détail — assemblage traverse / poteau',
  faitage: 'Détail — assemblage de faîtage',
  pied: 'Détail — pied de poteau',
  palee: 'Détail — attache de palée de stabilité',
};

/**
 * Plan de vue de chaque détail : celui où l'assemblage se lit en vraie grandeur.
 * Les nœuds du portique sont dans son plan ; l'attache de palée est dans celui
 * du long pan.
 */
const VUES: Record<DetailKind, ViewDir> = {
  genou: VUE_TRANSVERSALE,
  faitage: VUE_TRANSVERSALE,
  pied: VUE_TRANSVERSALE,
  palee: VUE_LONG_PAN,
};

/**
 * Construit la planche de détail d'un nœud.
 *
 * Le nœud est choisi géométriquement : on prend le point remarquable de la
 * première file courante et on ne garde que ce qui se trouve dans son voisinage.
 * Le rayon du voisinage est déduit des pièces assemblées, pas fixé à l'aveugle.
 */
export function sheetDetail(
  model: StructuralModel,
  p: ProjectParams,
  kind: DetailKind,
  opts: DetailOptions,
): Sheet | null {
  const zone = zoneDeDetail(model, p, kind);
  if (!zone) return null;
  const noeud = zone.point;
  const rayon = zone.rayon;
  const v = VUES[kind];

  // Les barres du plan de vue : celles de la file pour un nœud de portique,
  // celles du plan des poteaux pour une palée — pas les lisses posées devant.
  const epaisseurDuPlan = getProfile(p.frame.columnProfile).h / 2 + 100;
  const dansLePlan = (m: Member): boolean =>
    kind === 'palee'
      ? Math.abs(m.start.y - noeud.y) < epaisseurDuPlan && Math.abs(m.end.y - noeud.y) < epaisseurDuPlan
      : Math.abs(m.start.x - noeud.x) < 1;
  const barres = model.members.filter((m) => dansLePlan(m) && distanceAuNoeud(m, noeud) < rayon);
  const toles = model.plates.filter((pl) => distance(pl.origin, noeud) < rayon);
  const jarrets = model.haunches.filter(
    (h) => Math.abs(h.root.x - noeud.x) < 1 && distance(h.root, noeud) < rayon,
  );
  const cordons = model.welds.filter((w) => distance(w.at, noeud) < rayon);
  if (barres.length === 0) return null;

  // ⚠ Un détail ne montre PAS les pièces entières : elles sont coupées à la
  // limite du voisinage. Sans cela le poteau descendrait jusqu'au sol et la
  // traverse filerait au faîtage, et le nœud — le sujet de la planche — se
  // retrouverait minuscule au milieu d'une feuille vide.
  const projeteNoeud = project(noeud, v);
  const voisinage: Bbox = {
    min: pt(projeteNoeud.x - rayon, projeteNoeud.y - rayon),
    max: pt(projeteNoeud.x + rayon, projeteNoeud.y + rayon),
  };
  const silhouettes = barres
    .map((m) => ({ m, sil: silhouetteLimitee(m, v, voisinage) }))
    .filter((x) => x.sil.length > 0);

  // L'emprise est celle du contenu réellement tracé, pas un carré arbitraire :
  // c'est ce qui permet de remplir la feuille.
  const emprise = empriseDe(silhouettes.map((x) => x.sil).flat(), projeteNoeud);
  const format = opts.format ?? 'A3';
  const fenetre = fenetreDe(format);
  const echelle = choisirEchelle(emprise, fenetre, 1.08);
  const t = cadrer(emprise, fenetre, echelle);

  const s = new DrawScene();
  const titre = titreDetail(kind, opts.lettre);
  dessinerCadre(s, format, {
    meta: opts.meta,
    titre,
    echelle,
    page: opts.page,
    total: opts.total,
  });

  /* --- Barres, coupées au voisinage, en section hachurée si elles sont vues en bout --- */
  for (const { m, sil } of silhouettes) {
    s.polyligne(sil.map((q) => appliquer(t, q)), true, 'contour');
    hachurerProfil(s, t, m, v);
  }
  for (const h of jarrets) {
    const a = project(h.root, v);
    const b = project(h.tip, v);
    const prof = getProfile(h.profileId);
    s.polyligne(
      [a, b, pt(b.x, b.y - prof.h / 2), pt(a.x, a.y - prof.h / 2 - h.rootDepth)].map((q) =>
        appliquer(t, q),
      ),
      true,
      'contour',
    );
  }

  /* --- Tôles et leurs perçages, en vraie forme --- */
  for (const pl of toles) dessinerTole(s, t, pl, v);

  /* --- Cotation des perçages sur la pièce percée --- */
  for (const m of barres) coterPercagesDuNoeud(s, t, m, v, noeud, echelle);

  /* --- Symboles de soudure : ligne de repère COURTE, au voisinage du cordon --- */
  for (const [i, w] of cordons.slice(0, 3).entries()) {
    const at = appliquer(t, project(w.at, v));
    symboleSoudure(s, at, pt(at.x + 16, at.y + 14 + i * 9), w);
  }

  /* --- Repères et nomenclature du nœud --- */
  for (const pl of toles) {
    const c = appliquer(t, project(pl.origin, v));
    bulleRepere(s, pt(c.x + 24, c.y + 24), c, pl.mark, 4);
  }
  nomenclatureDuNoeud(s, fenetre, barres, toles, cordons);

  return {
    id: `detail-${kind}`,
    kind: 'detail',
    titre,
    format,
    echelle,
    scene: s,
  };
}

/* ------------------------------------------------------------------ */

/**
 * File sur laquelle les nœuds sont détaillés : une file COURANTE, le nœud de
 * pignon étant un cas particulier.
 *
 * ⚠ Exportée parce que le dossier en a besoin pour choisir la coupe qui portera
 * les bulles de renvoi. La formule était recopiée de part et d'autre : le jour
 * où l'une aurait changé seule, les bulles auraient désigné des nœuds dessinés
 * sur une autre file que celle détaillée.
 */
export function fileDesDetails(p: ProjectParams): number {
  return Math.max(1, Math.floor(p.grid.nBays / 2));
}

/** Titre d'une planche de détail, avec sa lettre de renvoi si elle en a une. */
export function titreDetail(kind: DetailKind, lettre?: string): string {
  return lettre ? TITRES[kind].replace('Détail —', `Détail ${lettre} —`) : TITRES[kind];
}

/**
 * Zone détaillée : le nœud et le rayon de voisinage que montre la planche.
 *
 * La bulle de la coupe entoure EXACTEMENT cette zone. Un cercle tracé à vue
 * promettrait un détail plus large ou plus étroit que celui qu'on trouve en
 * tournant la page.
 */
export function zoneDeDetail(
  model: StructuralModel,
  p: ProjectParams,
  kind: DetailKind,
): { readonly point: Vec3; readonly rayon: number } | null {
  if (kind === 'palee') return zoneDePalee(model, p);
  const point = pointDuNoeud(model, p, kind);
  return point ? { point, rayon: rayonDeVoisinage(p, kind) } : null;
}

/**
 * Attache de palée détaillée : le pied de palée sur un poteau COURANT du long
 * pan avant — celui d'angle porte aussi le contreventement de pignon, qui
 * brouillerait la vue. Le voisinage englobe le gousset, les plats qui s'y
 * boulonnent et un bout de tube.
 */
function zoneDePalee(model: StructuralModel, p: ProjectParams): { point: Vec3; rayon: number } | null {
  const parId = new Map(model.members.map((m) => [m.id, m]));
  const L = buildingLength(p.grid);
  const pied = model.plates
    .filter((pl) => pl.kind === 'gousset-cv')
    .map((pl) => ({ pl, po: parId.get(pl.porteur ?? '') }))
    .filter(
      (x): x is { pl: Plate; po: Member } =>
        x.po !== undefined &&
        x.po.role === 'poteau' &&
        x.po.start.y < p.grid.span / 2 &&
        x.po.start.x > 1 &&
        x.po.start.x < L - 1 &&
        Math.abs(dot(normalize(cross(x.pl.u, x.pl.v)), { x: 0, y: 1, z: 0 })) > 0.99,
    )
    .sort((a, b) => a.pl.origin.z - b.pl.origin.z || a.po.start.x - b.po.start.x)[0];
  if (!pied) return null;
  const point = pied.po.start;
  const trous = pied.pl.holes.map((h) => sommet(pied.pl, h.at));
  const plats = model.plates.filter(
    (pl) => pl.kind === 'plat-tube' && pl.holes.some((h) => trous.some((q) => distance(sommet(pl, h.at), q) < 1)),
  );
  const loin = Math.max(...[pied.pl, ...plats].flatMap((pl) => pl.outline.map((q) => distance(sommet(pl, q), point))));
  return { point, rayon: Math.max(600, loin + 250) };
}

/** Point d'une tôle donné dans son repère local. */
function sommet(pl: Plate, q: Pt2): Vec3 {
  return add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z)));
}

function pointDuNoeud(model: StructuralModel, p: ProjectParams, kind: DetailKind): Vec3 | null {
  const x = fileDesDetails(p) * p.grid.baySpacing;
  const poteau = model.members.find(
    (m) => m.role === 'poteau' && Math.abs(m.start.x - x) < 1 && m.start.y === 0,
  );
  if (!poteau) return null;

  if (kind === 'pied') return poteau.start;
  if (kind === 'genou') return poteau.end;

  // Faîtage : le point le plus haut d'une traverse de cette file.
  const traverses = model.members.filter(
    (m) => m.role === 'traverse' && Math.abs(m.start.x - x) < 1,
  );
  if (traverses.length === 0) return null;
  const sommets = traverses.flatMap((m) => [m.start, m.end]);
  return sommets.reduce((a, b) => (b.z > a.z ? b : a));
}

/**
 * Rayon du voisinage à représenter : assez large pour montrer l'assemblage en
 * entier, déduit de la hauteur des pièces assemblées et de la longueur du jarret.
 */
function rayonDeVoisinage(p: ProjectParams, kind: DetailKind): number {
  const hPoteau = getProfile(p.frame.columnProfile).h;
  const hTraverse = p.frame.enabled ? getProfile(p.frame.rafterProfile).h : hPoteau;
  if (kind === 'pied') return Math.max(500, 3 * hPoteau);
  if (kind === 'genou') {
    const jarret = p.frame.haunch.enabled ? p.frame.haunch.length : 0;
    return Math.max(900, jarret + 2 * hTraverse);
  }
  return Math.max(700, 4 * hTraverse);
}

/**
 * Silhouette d'une barre LIMITÉE à un rectangle du plan de vue : le contour
 * réel de la pièce — coupes comprises — découpé par le rectangle (algorithme
 * de Sutherland-Hodgman).
 *
 * ⚠ On découpait l'AXE D'ÉPURE, puis on reconstruisait un rectangle autour : la
 * pièce s'étendait jusqu'à son point de travail, quelles que soient ses coupes.
 * Au genou, la console entrait jusqu'à l'axe du poteau.
 */
function silhouetteLimitee(m: Member, v: ViewDir, rect: Bbox): Pt[] {
  let poly = silhouette(m, v);
  const bords: [(q: Pt) => number][] = [
    [(q) => q.x - rect.min.x],
    [(q) => rect.max.x - q.x],
    [(q) => q.y - rect.min.y],
    [(q) => rect.max.y - q.y],
  ];
  for (const [dedans] of bords) {
    if (poly.length === 0) break;
    const sortie: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i] as Pt;
      const p1 = poly[(i + 1) % poly.length] as Pt;
      const d0 = dedans(p0);
      const d1 = dedans(p1);
      if (d0 >= 0) sortie.push(p0);
      if (d0 >= 0 !== d1 >= 0) {
        const t = d0 / (d0 - d1);
        sortie.push(pt(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t));
      }
    }
    poly = sortie;
  }
  return poly.length >= 3 ? poly : [];
}

/** Emprise des points tracés, élargie d'un peu autour du nœud. */
function empriseDe(points: readonly Pt[], noeud: Pt): Bbox {
  if (points.length === 0) return { min: noeud, max: noeud };
  const xs = points.map((q) => q.x);
  const ys = points.map((q) => q.y);
  // Marge modèle pour loger cotes et symboles de soudure.
  const marge = Math.max(120, (Math.max(...xs) - Math.min(...xs)) * 0.18);
  return {
    min: pt(Math.min(...xs) - marge, Math.min(...ys) - marge),
    max: pt(Math.max(...xs) + marge, Math.max(...ys) + marge),
  };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Distance du nœud au segment de la barre : une barre longue reste retenue. */
function distanceAuNoeud(m: Member, q: Vec3): number {
  const dx = m.end.x - m.start.x;
  const dy = m.end.y - m.start.y;
  const dz = m.end.z - m.start.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  if (l2 < 1e-9) return distance(m.start, q);
  const u =
    ((q.x - m.start.x) * dx + (q.y - m.start.y) * dy + (q.z - m.start.z) * dz) / l2;
  const c = Math.max(0, Math.min(1, u));
  return distance(q, {
    x: m.start.x + dx * c,
    y: m.start.y + dy * c,
    z: m.start.z + dz * c,
  });
}

/** Hachure de la section d'une barre vue en coupe. */
function hachurerProfil(s: DrawScene, t: Transform2D, m: Member, v: ViewDir): void {
  const profil = getProfile(m.profileId);
  const f = memberFrame(m);
  // Barre perpendiculaire au plan de vue : on la voit en section.
  const perpendiculaire = Math.abs(dot(f.ax, v.right)) < 0.05 && Math.abs(dot(f.ax, v.up)) < 0.05;
  if (!perpendiculaire) return;

  const contour = sectionOutline(profil, 8);
  const centre = project(m.start, v);
  const en2d = (q: { y: number; z: number }): Pt => {
    const offset: Vec3 = {
      x: f.ay.x * q.y + f.az.x * q.z,
      y: f.ay.y * q.y + f.az.y * q.z,
      z: f.ay.z * q.y + f.az.z * q.z,
    };
    return appliquer(t, pt(centre.x + dot(offset, v.right), centre.y + dot(offset, v.up)));
  };
  const ext = contour.outer.map(en2d);
  s.hachure(ext, contour.holes.map((r) => r.map(en2d)), 1.4, 45);
  s.polyligne(ext, true, 'contour');
}

/** Tôle d'assemblage vue de face ou de chant, avec ses perçages. */
function dessinerTole(s: DrawScene, t: Transform2D, pl: Plate, v: ViewDir): void {
  // Le contour d'une tôle est dans SON plan (y, z locaux) : on le remonte en 3D
  // par son repère, puis on le projette comme n'importe quel point du modèle.
  const en2d = (q: Pt2): Pt => {
    const p3: Vec3 = {
      x: pl.origin.x + pl.u.x * q.y + pl.v.x * q.z,
      y: pl.origin.y + pl.u.y * q.y + pl.v.y * q.z,
      z: pl.origin.z + pl.u.z * q.y + pl.v.z * q.z,
    };
    return appliquer(t, project(p3, v));
  };
  const contour = pl.outline.map(en2d);
  s.hachure(contour, [], 1.1, 135);
  s.polyligne(contour, true, 'contour');

  for (const h of pl.holes) {
    const c = en2d(h.at);
    const r = (h.d / 2) * t.facteur;
    if (h.oblong) s.polyligne(contourDeTrou(h).map(en2d), true, 'contour');
    else s.cercle(c, Math.max(r, 0.4), 'contour');
    s.ligne(pt(c.x - r - 1.5, c.y), pt(c.x + r + 1.5, c.y), 'axe');
    s.ligne(pt(c.x, c.y - r - 1.5), pt(c.x, c.y + r + 1.5), 'axe');
  }
}

/**
 * Cote les perçages présents au voisinage du nœud, sur la pièce qui les porte.
 * On cote les abscisses ET l'entraxe transversal : ce sont les deux données
 * nécessaires pour percer.
 */
function coterPercagesDuNoeud(
  s: DrawScene,
  t: Transform2D,
  m: Member,
  v: ViewDir,
  noeud: Vec3,
  echelle: number,
): void {
  if (m.holes.length === 0) return;
  const f = memberFrame(m);
  const proches = m.holes.filter((h) => {
    const p3 = pointDuTrou(m, f, h);
    return distance(p3, noeud) < 1200;
  });
  if (proches.length === 0) return;

  const abscisses = [...new Set(proches.map((h) => Math.round(h.s)))].sort((a, b) => a - b);
  if (abscisses.length < 2) return;

  const papier = (abs: number): Pt => {
    const h = proches.find((x) => Math.round(x.s) === abs);
    if (!h) return pt(0, 0);
    return appliquer(t, project(pointDuTrou(m, f, h), v));
  };
  const points = abscisses.map(papier);
  const ecarts = abscisses.slice(1).map((a, i) => a - (abscisses[i] as number));
  chaineDeCotes(s, points, 18 + 400 / echelle, ecarts, { total: false });

  // Diamètre de perçage, une fois pour le groupe.
  const premier = proches[0] as (typeof proches)[number];
  s.texte(pt((points[0] as Pt).x, (points[0] as Pt).y - 8), `${proches.length} trous Ø${premier.d}`, {
    hauteur: 2.2,
  });
}

function pointDuTrou(
  m: Member,
  f: ReturnType<typeof memberFrame>,
  h: { s: number; at: { y: number; z: number } },
): Vec3 {
  return {
    x: m.start.x + f.ax.x * h.s + f.ay.x * h.at.y + f.az.x * h.at.z,
    y: m.start.y + f.ax.y * h.s + f.ay.y * h.at.y + f.az.y * h.at.z,
    z: m.start.z + f.ax.z * h.s + f.ay.z * h.at.z + f.az.z * h.at.z,
  };
}

/** Nomenclature du nœud : pièces, tôles, boulonnerie, soudures. */
function nomenclatureDuNoeud(
  s: DrawScene,
  fenetre: Bbox,
  barres: readonly Member[],
  toles: readonly Plate[],
  cordons: readonly Weld[],
): void {
  const lignes: string[] = [];
  for (const m of [...new Map(barres.map((b) => [b.mark, b])).values()]) {
    lignes.push(`${m.mark} — ${getProfile(m.profileId).id} (${m.grade})`);
  }
  for (const pl of [...new Map(toles.map((x) => [x.mark, x])).values()]) {
    const ys = pl.outline.map((q) => q.y);
    const zs = pl.outline.map((q) => q.z);
    const l = roundMm(Math.max(...ys) - Math.min(...ys));
    const h = roundMm(Math.max(...zs) - Math.min(...zs));
    const trous = pl.holes.length > 0 ? ` — ${pl.holes.length} × ${[...new Set(pl.holes.map((x) => designationDeTrou(x)))].join(' / ')}` : '';
    lignes.push(`${pl.mark} — tôle ${l} × ${h} × ${pl.thickness}${trous}`);
  }
  for (const w of [...new Map(cordons.map((x) => [designationSoudure(x), x])).values()]) {
    lignes.push(`Soudure ${designationSoudure(w)}`);
  }

  let y = fenetre.min.y + 4 + lignes.length * 3.6;
  s.texte(pt(fenetre.max.x, y + 4), 'NOMENCLATURE DU NŒUD', {
    hauteur: 2.2,
    ancrage: 'droite',
    gras: true,
  });
  for (const l of lignes) {
    s.texte(pt(fenetre.max.x, y), l, { hauteur: 2.2, ancrage: 'droite' });
    y -= 3.6;
  }
}
