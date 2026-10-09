import { getProfile } from '../../catalog/index';
import { diametreNominal, listerBoulons, type BoltPlacement } from '../../build/bolts';
import { LIBELLE_TOLE, type Plate, type StructuralModel } from '../../build/types';
import { boltLength, classeDe } from '../../bom/boulonnerie';
import { designationDeTrou } from '../../geometry/holes';
import { cutLengths, type Member } from '../../geometry/member';
import type { Pt2 } from '../../geometry/section';
import { designationSoudure, type Weld } from '../../geometry/weld';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../../math/vec3';
import { roundMm } from '../../math/tolerance';
import { buildingLength } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import { chaineDeCotes } from '../dimension';
import { dessinerCadre, fenetreDe, type CartoucheData, type SheetFormat } from '../layout';
import { DrawScene, pt, type Bbox, type Pt } from '../scene';
import type { Sheet } from '../sheet';
import { appliquer, project, viewNormal, VUE_LONG_PAN, VUE_TRANSVERSALE, type Transform2D, type ViewDir } from '../view';
import { dessinerElevationDuNoeud, reperesEnMarge, rupture, souduresEnColonne } from './detailVues';
import { contourJarret } from '../../build/jarret';
import type { Haunch } from '../../build/types';
import { coteLineaire } from '../dimension';
import { dessinerTableau } from './nomenclature';
import { dessinerToleAPlat } from './toleAPlat';

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
  // Les pannes et lisses que la vue traverse se dessinent en section.
  const traverseLaVue = (m: Member): boolean =>
    kind !== 'palee' && Math.min(m.start.x, m.end.x) < noeud.x && Math.max(m.start.x, m.end.x) > noeud.x;
  const barres = model.members.filter(
    (m) => (dansLePlan(m) || traverseLaVue(m)) && distanceAuNoeud(m, noeud) < rayon,
  );
  const enProfondeur = (q: Vec3): boolean => Math.abs(dot(sub(q, noeud), viewNormal(v))) < epaisseurDuPlan + 200;
  const toles = model.plates.filter((pl) => distance(pl.origin, noeud) < rayon && enProfondeur(pl.origin));
  const jarrets = model.haunches.filter((h) => Math.abs(h.root.x - noeud.x) < 1 && distance(h.root, noeud) < rayon);
  const cordons = model.welds.filter((w) => distance(w.at, noeud) < rayon && enProfondeur(w.at));
  const boulons = listerBoulons(model.members, model.plates).filter(
    (b) => distance(b.at, noeud) < rayon && enProfondeur(b.at),
  );
  if (barres.length === 0) return null;

  const format = opts.format ?? 'A3';
  const fenetre = fenetreDe(format);
  const xDroite = fenetre.max.x - LARGEUR_COLONNE;
  const s = new DrawScene();
  const titre = titreDetail(kind, opts.lettre);

  /* --- Élévation, à gauche --- */
  const zoneVue: Bbox = { min: fenetre.min, max: pt(xDroite - 4, fenetre.max.y - 6) };
  const vue = dessinerElevationDuNoeud(
    s,
    { noeud, rayon, v, barres, toles, jarrets, cordons, boulons },
    zoneVue,
  );
  s.texte(pt(fenetre.min.x, fenetre.max.y - 3), `ÉLÉVATION — 1:${vue.echelle}`, { hauteur: 2.6, gras: true });
  const P3 = (q: Vec3): Pt => appliquer(vue.t, project(q, v));

  const principale = platinePrincipale(kind, toles, noeud);
  // Les rangées de boulons se cotent sur la platine en vraie grandeur ; ici, le jarret.
  for (const j of jarrets) coterJarret(s, vue.t, j, v);
  // Place prise par les cotes sous le dessin : les bulles du bas se posent au-delà.
  let occupe = vue.dessin;
  if (principale && kind === 'pied') {
    coterAncrages(s, vue.t, principale, v, p);
    occupe = { min: pt(vue.dessin.min.x, vue.dessin.min.y - 26), max: vue.dessin.max };
  }

  // Repères : une bulle par repère, en marge, reliée à la partie VISIBLE de la pièce.
  const dansLeCadre = (q: Vec3): boolean => {
    const r = project(q, v);
    return r.x >= vue.cadre.min.x && r.x <= vue.cadre.max.x && r.y >= vue.cadre.min.y && r.y <= vue.cadre.max.y;
  };
  const cibles = [
    ...new Map(
      [
        ...barres
          .filter((m) => vue.ancres.has(m.id))
          .map((m) => [m.mark, { repere: m.mark, vers: vue.ancres.get(m.id) as Pt }] as const),
        ...toles.filter((pl) => dansLeCadre(pl.origin)).map((pl) => [pl.mark, { repere: pl.mark, vers: P3(pl.origin) }] as const),
      ],
    ).values(),
  ];
  reperesEnMarge(s, occupe, cibles);
  souduresEnColonne(
    s,
    vue.dessin,
    // Un symbole par désignation, au cordon le plus proche du nœud.
    [...new Map([...cordons].sort((a, b) => distance(b.at, noeud) - distance(a.at, noeud)).map((w) => [designationSoudure(w), w])).values()]
      .slice(0, 6)
      .map((w) => ({ w, at: P3(w.at) })),
  );

  /* --- Platine principale en vraie grandeur, en haut à droite --- */
  const hauteurPlatine = Math.min(130, (fenetre.max.y - fenetre.min.y) * 0.56);
  if (principale) {
    const nombre = model.plates.filter((x) => x.mark === principale.mark).length;
    s.texte(pt(xDroite, fenetre.max.y - 3), `${LIBELLE_TOLE[principale.kind].toUpperCase()} ${principale.mark} — VRAIE GRANDEUR`, {
      hauteur: 2.6,
      gras: true,
    });
    dessinerToleAPlat(s, principale, nombre, {
      min: pt(xDroite + 4, fenetre.max.y - hauteurPlatine),
      max: pt(fenetre.max.x - 2, fenetre.max.y - 10),
    });
  }
  s.ligne(pt(xDroite - 2, fenetre.min.y), pt(xDroite - 2, fenetre.max.y), 'cotation');

  /* --- Nomenclature du nœud, en bas à droite : ce que le dessin montre --- */
  nomenclatureDuNoeud(
    s,
    { min: pt(xDroite, fenetre.min.y), max: pt(fenetre.max.x, fenetre.max.y - hauteurPlatine - 14) },
    p,
    barres.filter((m) => vue.ancres.has(m.id)),
    toles.filter((pl) => dansLeCadre(pl.origin)),
    boulons.filter((b) => dansLeCadre(b.at)),
    cordons.filter((w) => dansLeCadre(w.at)),
  );

  dessinerCadre(s, format, { meta: opts.meta, titre, echelle: vue.echelle, page: opts.page, total: opts.total });
  return { id: `detail-${kind}`, kind: 'detail', titre, format, echelle: vue.echelle, scene: s };
}

/** Largeur de la colonne de droite : platine en vraie grandeur et nomenclature (mm). */
const LARGEUR_COLONNE = 140;

/** La tôle qui fait l'objet du détail : platine d'about, de faîtage, de pied, gousset. */
function platinePrincipale(kind: DetailKind, toles: readonly Plate[], noeud: Vec3): Plate | undefined {
  const sorte: Plate['kind'] = kind === 'pied' ? 'platine-pied' : kind === 'palee' ? 'gousset-cv' : 'platine-about';
  return toles
    .filter((pl) => pl.kind === sorte && (kind !== 'faitage' || pl.id.endsWith('-PLF')) && (kind !== 'genou' || pl.id.endsWith('-PLA')))
    .sort((a, b) => distance(a.origin, noeud) - distance(b.origin, noeud))[0];
}

/**
 * Tiges d'ancrage en élévation : leur entraxe sous la platine, et leur
 * scellement dans le massif, qu'on dessine en caché.
 */
function coterAncrages(s: DrawScene, t: Transform2D, pl: Plate, v: ViewDir, p: ProjectParams): void {
  const P = (q: Vec3): Pt => appliquer(t, project(q, v));
  const cb = p.connections.columnBase;
  const points = pl.holes.map((h) => sommetDe(pl, h.at));
  const xs = [...new Set(points.map((q) => Math.round(P(q).x * 100) / 100))].sort((a, b) => a - b);
  const bord = pl.outline.map((q) => P(sommetDe(pl, q)));
  const yBas = Math.min(...bord.map((q) => q.y));
  const gauche = Math.min(...bord.map((q) => q.x));
  const droite = Math.max(...bord.map((q) => q.x));
  const lignes = [gauche, ...xs, droite];
  chaineDeCotes(
    s,
    lignes.map((x) => pt(x, yBas)),
    -10,
    lignes.slice(1).map((x, i) => Math.round((x - (lignes[i] as number)) / t.facteur)),
    { total: true, decalageTotal: -20 },
  );
  /*
   * Scellement : les tiges descendent dans le massif, sous l'arase du béton —
   * interrompues sur le papier : 500 mm au 1:5 sortiraient de la feuille.
   */
  const calage = cb.groutThickness * t.facteur;
  const scellement = Math.min(cb.anchorEmbedment * t.facteur, 30);
  const arase = yBas - calage;
  for (const x of xs) {
    s.ligne(pt(x, arase), pt(x, arase - scellement), 'cachee');
    rupture(s, pt(x - 3, arase - scellement), pt(x + 3, arase - scellement));
  }
  s.ligne(pt(gauche - 25, arase), pt(droite + 25, arase), 'contour-fin');
  s.texte(pt(droite + 27, arase), `arase béton — calage ${cb.groutThickness} mm`, { hauteur: 2, ligneDeBase: 'milieu' });
  s.texte(pt(droite + 27, arase - scellement), `scellement ${cb.anchorEmbedment} mm`, { hauteur: 2, ligneDeBase: 'milieu' });
}

/** Jarret : sa longueur le long de la traverse et sa hauteur à la racine. */
function coterJarret(s: DrawScene, t: Transform2D, j: Haunch, v: ViewDir): void {
  const k = contourJarret(j);
  const P = (q: Vec3): Pt => appliquer(t, project(q, v));
  const [haut, bas, pointe] = [P(k.haut), P(k.bas), P(k.pointe)];
  const sens = pointe.x >= haut.x ? 1 : -1;
  coteLineaire(s, bas, pt(pointe.x, bas.y), -8, Math.round(Math.abs(pointe.x - bas.x) / t.facteur));
  coteLineaire(s, haut, bas, sens * 8, Math.round(Math.abs(haut.y - bas.y) / t.facteur));
}

function sommetDe(pl: Plate, q: Pt2): Vec3 {
  return add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z)));
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

/**
 * Nomenclature du nœud, en tableau : les pièces assemblées, les tôles, la
 * boulonnerie par désignation et les cordons — ce que l'atelier sort du magasin
 * pour monter ce nœud-là.
 */
function nomenclatureDuNoeud(
  s: DrawScene,
  zone: Bbox,
  p: ProjectParams,
  barres: readonly Member[],
  toles: readonly Plate[],
  boulons: readonly BoltPlacement[],
  cordons: readonly Weld[],
): void {
  const compte = <T,>(liste: readonly T[], cle: (x: T) => string): Map<string, { x: T; n: number }> => {
    const m = new Map<string, { x: T; n: number }>();
    for (const x of liste) {
      const k = cle(x);
      const d = m.get(k);
      if (d) d.n += 1;
      else m.set(k, { x, n: 1 });
    }
    return m;
  };
  const lignes: string[][] = [];
  for (const { x: m, n } of compte(barres, (b) => b.mark).values()) {
    lignes.push([m.mark, `${LIBELLE_ROLE[m.role] ?? m.role} ${getProfile(m.profileId).id}`, `L = ${roundMm(cutLengths(m).axis)} — ${m.grade}`, `${n}`]);
  }
  for (const { x: pl, n } of compte(toles, (t) => t.mark).values()) {
    const ys = pl.outline.map((q) => q.y);
    const zs = pl.outline.map((q) => q.z);
    const trous = pl.holes.length > 0 ? ` — ${pl.holes.length} × ${[...new Set(pl.holes.map((h) => designationDeTrou(h)))].join(' / ')}` : '';
    lignes.push([
      pl.mark,
      LIBELLE_TOLE[pl.kind],
      `${roundMm(Math.max(...ys) - Math.min(...ys))} × ${roundMm(Math.max(...zs) - Math.min(...zs))} × ${pl.thickness}${trous}`,
      `${n}`,
    ]);
  }
  const designation = (b: BoltPlacement): string => {
    const dn = diametreNominal(b);
    if (b.kind === 'ancrage') return `Tige d’ancrage M${dn} — scellement ${p.connections.columnBase.anchorEmbedment}`;
    return `Boulon M${dn} × ${boltLength(b.grip, dn)} — cl. ${classeDe(b.d, p)}`;
  };
  for (const { x: b, n } of compte(boulons, designation).values()) {
    lignes.push(['', designation(b), b.kind === 'ancrage' ? 'écrou, contre-écrou, rondelle' : 'écrou, 2 rondelles', `${n}`]);
  }
  for (const { x: w, n } of compte(cordons, (c) => designationSoudure(c)).values()) {
    lignes.push(['', 'Soudure', designationSoudure(w), `${n}`]);
  }
  s.texte(pt(zone.min.x, zone.max.y + 2), 'NOMENCLATURE DU NŒUD', { hauteur: 2.6, gras: true });
  dessinerTableau(
    s,
    [
      { titre: 'Rep.', poids: 0.9 },
      { titre: 'Désignation', poids: 3.4 },
      { titre: 'Dimensions', poids: 3.6 },
      { titre: 'Nb', poids: 0.7, aDroite: true },
    ],
    lignes,
    zone,
  );
}

/** Désignation courte d'une barre selon son rôle, pour la nomenclature du nœud. */
const LIBELLE_ROLE: Partial<Record<Member['role'], string>> = {
  poteau: 'Poteau',
  traverse: 'Traverse',
  console: 'Console',
  panne: 'Panne',
  lisse: 'Lisse',
  potelet: 'Potelet',
  contreventement: 'Diagonale',
  attache: 'Échantignolle',
  equerre: 'Équerre',
  lierne: 'Lierne',
};
