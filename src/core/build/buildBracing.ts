import { getProfile } from '../catalog/index';
import { fibreAbscissa, memberFrame, squareCut, type Member } from '../geometry/member';
import { EX, EY, add, cross, defaultUp, dot, normalize, scale, sub, v3, type Vec3 } from '../math/vec3';
import { bracedBays, type BracingSet } from '../model/bracing';
import { frameStations, ridgeHeight, ridgeY, roofNormal, roofZ } from '../model/grid';
import type { ProjectParams } from '../model/project';
import { basDePlatineDeGenou } from './buildFrame';
import { tieLevel } from './buildTruss';
import { aboutDuTube, dispositionDAttache, type AttacheCV, type Disposition, type TypeDAppui } from './connections/contreventement';
import { niveauxSurFerme } from './connections/contreventementFerme';
import { reserveDeTete } from './connections/potelets';
import { gablePostStations } from './secondaire/facades';

/**
 * Contreventements.
 *
 * Ils ne portent pas la toiture : ils empêchent le bâtiment de se coucher.
 * Trois familles, dans trois plans différents :
 *  - la POUTRE AU VENT travaille dans le plan des versants et ramène le vent de
 *    pignon vers les long pans ;
 *  - les PALÉES DE STABILITÉ travaillent dans le plan des façades long pan et
 *    descendent cet effort aux fondations ;
 *  - le CONTREVENTEMENT DE PIGNON raidit la façade pignon elle-même.
 *
 * Les diagonales sont coupées d'équerre : elles s'assemblent sur goussets, pas
 * en about.
 *
 * ⚠ Chaque maille est posée DANS LE PLAN DES AXES des pièces qu'elle relie —
 * poteaux, traverses, potelets —, ses deux brins de part et d'autre. Elle en
 * était écartée — sous les traverses, devant les poteaux, derrière les
 * potelets — pour dégager leur métal : mais un gousset ne se soude que sur une
 * face, et aucune ne se trouvait dans ces plans-là. Les diagonales ne pouvaient
 * s'attacher à rien, et l'effort qu'elles devaient conduire arrivait excentré,
 * tordant les poteaux. Dans le plan des axes, le gousset se soude sur l'âme, entre
 * les semelles, et l'effort passe par l'axe.
 *
 * L'ébout de chaque diagonale est celui que fixe son attache (voir
 * `connections/contreventement`) ; à défaut d'attache possible — membrures de
 * ferme en cornières —, la diagonale s'arrête à la face de la pièce.
 */
export function buildBracing(
  p: ProjectParams,
  porteurs: readonly Member[] = [],
): { members: Member[]; attaches: AttacheCV[] } {
  const out: Member[] = [];
  const attaches: AttacheCV[] = [];
  const ctx: Contexte = { p, porteurs, out, attaches };
  const g = p.grid;
  const stations = frameStations(g);
  const b = p.bracing;

  /*
   * ⚠ Le niveau de tête est un POINT DE TRAVAIL, pas une face. Y mener les
   * palées les fait entrer dans la traverse — ou dans l'entrait d'une ferme —
   * d'une demi-hauteur de section. On descend donc sous la pièce qui coiffe le
   * poteau, ce qui est aussi l'endroit réel du gousset d'attache.
   */
  const hTete = p.truss.enabled
    ? getProfile(p.truss.bottomChordProfile).h
    : getProfile(p.frame.rafterProfile).h;
  const zTete = (p.truss.enabled ? tieLevel(g, p.truss) : g.eaveHeight) - hTete / 2;
  const zTeteDroite =
    g.roofType === 'monopente'
      ? zTete + (ridgeHeight(g) - g.eaveHeight)
      : zTete;

  /* --- Poutre au vent, dans le plan des versants --- */
  const niveaux = p.frame.enabled ? null : niveauxSurFerme(p);
  for (const t of bracedBays(b.roof, g.nBays)) {
    const x0 = stations[t] as number;
    const x1 = stations[t + 1] as number;
    const ySommet = g.roofType === 'monopente' ? g.span : ridgeY(g);
    const versants: [number, number][] =
      g.roofType === 'monopente'
        ? [[0, g.span]]
        : [
            [0, ySommet],
            [g.span, ySommet],
          ];

    for (const [k, [yBas, yHaut]] of versants.entries()) {
      const bas0 = v3(x0, yBas, roofZ(g, yBas));
      const bas1 = v3(x1, yBas, roofZ(g, yBas));
      const haut0 = v3(x0, yHaut, roofZ(g, yHaut));
      const haut1 = v3(x1, yHaut, roofZ(g, yHaut));
      const nrm = roofNormal(g, (yBas + yHaut) / 2);
      croix(
        ctx,
        b.roof,
        `CVT-${t}-${k}`,
        bas0,
        haut1,
        bas1,
        haut0,
        `poutre au vent — travée ${t + 1}, versant ${k + 1}`,
        // Dans le plan des axes de traverses, attachée sur leur âme. Sur des
        // membrures de ferme en cornières, rien ne la reçoit dans ce plan : elle
        // reste sous les membrures.
        {
          normale: v3(0, nrm.y, nrm.z),
          recul: hPorteur(p) / 2,
          decalage: p.frame.enabled ? 0 : -degagement(hPorteur(p), b.roof.profile),
          // Sur ferme : deux niveaux de part et d'autre de l'aile couchée de l'arbalétrier.
          niveaux: niveaux ? { d1: niveaux.dessus, d2: niveaux.dessous ?? niveaux.dessus } : undefined,
        },
      );
    }
  }

  /* --- Palées de stabilité, dans le plan des long pans --- */
  for (const t of bracedBays(b.wall, g.nBays)) {
    const x0 = stations[t] as number;
    const x1 = stations[t + 1] as number;
    for (const [k, y, zT] of [
      [0, 0, zTete],
      [1, g.span, zTeteDroite],
    ] as const) {
      croix(
        ctx,
        b.wall,
        `CVP-${t}-${k}`,
        v3(x0, y, 0),
        v3(x1, y, zT),
        v3(x1, y, 0),
        v3(x0, y, zT),
        `palée de stabilité — travée ${t + 1}, long pan ${k === 0 ? 'gauche' : 'droit'}`,
        // Dans le plan des axes de poteaux, attachée sur leur âme.
        { normale: EY, recul: getProfile(p.frame.columnProfile).b / 2, decalage: 0 },
      );
    }
  }

  /*
   * --- Contreventement de pignon, dans le plan des pignons ---
   *
   * ⚠ Dans les MAILLES DE RIVE, entre le poteau d'angle et le premier potelet —
   * et non en une seule croix d'un angle à l'autre du pignon. Celle-ci donnait
   * des diagonales de 20,65 m sur un pignon de 20 m : un tube qui ne s'achète
   * pas d'une pièce (les tubes se livrent en 12 m), ne tient pas sur un plateau
   * de 13,60 m et fléchit sous son propre poids avant d'avoir rien tenu. Sans
   * potelet, il n'y a pas d'autre attache que les deux poteaux : on garde alors
   * la maille entière.
   */
  if (b.gable.enabled) {
    const L = stations[stations.length - 1] as number;
    const potelets = p.secondary.gablePosts.enabled ? gablePostStations(p) : [];
    const mailles: [number, number][] =
      potelets.length > 0
        ? [
            [0, potelets[0] as number],
            [potelets[potelets.length - 1] as number, g.span],
          ]
        : [[0, g.span]];
    // Tête de maille : sous la traverse, au droit de chaque montant de la maille.
    const sousToiture = (y: number): number =>
      y <= 0 ? zTete : y >= g.span ? zTeteDroite : roofZ(g, y) - hTete / 2;
    for (const [k, x] of [
      [0, 0],
      [1, L],
    ] as const) {
      for (const [m, [ya, yb]] of mailles.entries()) {
        croix(
          ctx,
          b.gable,
          `CVG-${k}-${m}`,
          v3(x, ya, 0),
          v3(x, yb, sousToiture(yb)),
          v3(x, yb, 0),
          v3(x, ya, sousToiture(ya)),
          `contreventement de pignon ${k === 0 ? 'ouest' : 'est'}, maille ${m === 0 ? 'gauche' : 'droite'}`,
          // Dans le plan du pignon : sur l'âme des potelets, sur la semelle
          // intérieure du poteau d'angle — sous sa platine de genou.
          { normale: EX, recul: getProfile(p.frame.columnProfile).b / 2, decalage: 0 },
        );
      }
    }
  }

  return { members: out, attaches };
}

/** Ce que la pose d'une diagonale doit connaître du reste du modèle. */
interface Contexte {
  readonly p: ProjectParams;
  /** Pièces sur lesquelles une diagonale peut s'attacher. */
  readonly porteurs: readonly Member[];
  readonly out: Member[];
  readonly attaches: AttacheCV[];
}

/** Comment la maille se pose dans l'espace, en plus de ses quatre sommets. */
interface PoseCroix {
  /** Normale au plan de la maille : c'est selon elle que les brins s'écartent. */
  readonly normale: Vec3;
  /** Ébout : de combien chaque brin s'arrête AVANT le point de travail (mm). */
  readonly recul: number;
  /** Décalage du plan entier, pour dégager ce qui s'y trouve déjà (mm). */
  readonly decalage?: number;
  /** Décalages imposés aux deux brins, quand la pièce porteuse fixe leurs niveaux (mm). */
  readonly niveaux?: { readonly d1: number; readonly d2: number } | undefined;
}

/**
 * Pose la maille de contreventement selon la forme demandée.
 * `a0→a1` et `b0→b1` sont les deux diagonales de la croix ; les quatre sommets
 * sont des points de travail, sur les axes des pièces porteuses.
 */
function croix(
  ctx: Contexte,
  set: BracingSet,
  id: string,
  a0: Vec3,
  a1: Vec3,
  b0: Vec3,
  b1: Vec3,
  position: string,
  pose: PoseCroix,
): void {
  if (!set.enabled) return;

  /*
   * ⚠ Une diagonale s'arrête à la FACE de la pièce qu'elle rejoint, pas sur son
   * axe. Les quatre sommets d'une maille sont des points de travail — l'axe du
   * poteau, l'axe de la traverse — et y mener le métal fait entrer la diagonale
   * DANS la pièce sur une demi-hauteur de section. C'est l'éboutage, et il vaut
   * pour tout le contreventement.
   */
  const n = normale(pose.normale);
  const d = pose.decalage ?? 0;

  if (set.shape === 'k') {
    /*
     * Palée en K : les deux brins partent du pied et de la tête d'un montant —
     * a0 et b1 — et se rejoignent à mi-hauteur du montant opposé, entre a1 et b0.
     * Le milieu de la maille, contre le premier montant, reste libre.
     *
     * ⚠ Ils se rejoignaient au milieu de la DIAGONALE b0→b1, c'est-à-dire au
     * centre de la maille, en l'air : aucun gousset ne pouvait y être soudé, et
     * deux barres articulées sur un nœud libre ne contreventent rien.
     */
    const milieu = v3((a1.x + b0.x) / 2, (a1.y + b0.y) / 2, (a1.z + b0.z) / 2);
    const dk = pose.niveaux?.d1 ?? d;
    poser(ctx, set, `${id}-k1`, a0, milieu, `${position} (K, brin bas)`, pose.recul, n, dk);
    poser(ctx, set, `${id}-k2`, b1, milieu, `${position} (K, brin haut)`, pose.recul, n, dk);
    return;
  }

  /*
   * ⚠ Les deux brins d'une croix de Saint-André ne sont PAS coplanaires. Ils se
   * boulonnent de part et d'autre du gousset de croisement, décalés d'une
   * épaisseur de barre. Les poser dans le même plan les fait se traverser en leur
   * milieu — ce qui est impossible à monter, et se voit immédiatement en 3D.
   */
  const ecart = set.shape === 'croix' ? getProfile(set.profile).h / 2 + 5 : 0;
  const d1 = pose.niveaux?.d1 ?? d + ecart;
  const d2 = pose.niveaux?.d2 ?? d - ecart;
  poser(ctx, set, `${id}-d1`, a0, a1, `${position} (diagonale montante)`, pose.recul, n, d1);
  if (set.shape === 'croix') {
    poser(ctx, set, `${id}-d2`, b0, b1, `${position} (diagonale descendante)`, pose.recul, n, d2);
  }
}

/**
 * Pose une diagonale entre deux points de travail, décalée de `decalage` selon
 * la normale de la maille, et éboutée par ses attaches.
 */
function poser(
  ctx: Contexte,
  set: BracingSet,
  id: string,
  a: Vec3,
  b: Vec3,
  position: string,
  recul: number,
  n: Vec3,
  decalage: number,
): void {
  const axe = normalize(sub(b, a));
  const longueur = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const diametre = getProfile(set.profile).h;
  const about = (w: Vec3, dir: Vec3, bout: 'start' | 'end'): Vec3 => {
    const d = attacher(ctx, w, dir, n, decalage, diametre);
    if (d) {
      ctx.attaches.push({ tube: id, bout, disposition: d });
      return aboutDuTube(d);
    }
    // Un ébout ne peut pas dévorer la barre : sur une maille très courte, on se
    // contente de ce que la géométrie permet.
    const r = Math.min(recul, longueur / 3);
    return add(add(w, scale(n, decalage)), scale(dir, r));
  };
  const debut = about(a, axe, 'start');
  const fin = about(b, scale(axe, -1), 'end');
  ctx.out.push(diagonale(ctx.p, set, id, debut, fin, position, n));
}

/** Pièces qui reçoivent un gousset de contreventement. */
const APPUIS: readonly Member['role'][] = ['poteau', 'traverse', 'potelet', 'membrure-sup'];

/**
 * L'attache d'un about sur la pièce dont l'axe passe par son point de travail —
 * la première qui peut la recevoir. Au faîtage, les deux traverses y passent ;
 * seule celle dont le métal est du côté du tube convient.
 */
function attacher(
  ctx: Contexte,
  w: Vec3,
  dir: Vec3,
  n: Vec3,
  decalage: number,
  diametre: number,
): Disposition | null {
  for (const m of ctx.porteurs) {
    if (!APPUIS.includes(m.role)) continue;
    const f = memberFrame(m);
    const r = sub(w, m.start);
    const horsAxe = sub(r, scale(f.ax, dot(r, f.ax)));
    const ecart = Math.hypot(horsAxe.x, horsAxe.y, horsAxe.z);
    let travail = w;
    if (m.role === 'membrure-sup') {
      /*
       * Cornière d'une paire : son axe est hors du plan de la ferme, décalé du
       * gousset de nœud. On retient celle du côté du tube, et l'attache se cote
       * depuis son axe.
       */
      const pr = getProfile(m.profileId);
      if (pr.shape !== 'L') continue;
      const decale = pr.cy + ctx.p.connections.gusset.thickness / 2;
      if (Math.abs(ecart - decale) > 1 || dot(horsAxe, dir) > 0) continue;
      travail = sub(w, horsAxe);
    } else if (ecart > 1) continue;
    const d = dispositionDAttache(ctx.p, m, travail, dir, n, decalage, diametre, plafondDe(ctx.p, m));
    if (d) return d;
  }
  return null;
}

/**
 * Altitude que les tôles d'attache ne doivent pas dépasser sur une pièce :
 *  - sur la SEMELLE d'un poteau de portique, le bas de sa platine de genou,
 *    plaquée sur cette même face ;
 *  - sur un potelet, la réserve de son attache de tête — boulons et écrous.
 */
function plafondDe(p: ProjectParams, m: Member): ((type: TypeDAppui) => number | undefined) | undefined {
  if (m.role === 'potelet') {
    const f = memberFrame(m);
    const haut = m.start.z + f.ax.z * fibreAbscissa(f, m.start, m.cutEnd, { y: 0, z: 0 });
    const plafond = p.frame.enabled && !p.truss.enabled ? haut - reserveDeTete(p) : undefined;
    return () => plafond;
  }
  if (m.role !== 'poteau') return undefined;
  const i = frameStations(p.grid).findIndex((x) => Math.abs(x - m.start.x) < 1);
  if (i < 0) return undefined;
  const genou = basDePlatineDeGenou(p, i, m.start.y < p.grid.span / 2 ? 'gauche' : 'droite') ?? undefined;
  return (type) => (type === 'semelle' ? genou : undefined);
}

/**
 * Distance dont il faut écarter le plan d'une maille pour qu'elle dégage la
 * pièce qu'elle longe.
 *
 * ⚠ Ce n'est pas la demi-hauteur de cette pièce. Il faut y ajouter le
 * demi-écartement des deux brins de la croix : le brin le plus proche est décalé
 * vers la pièce, et un dégagement calculé sans lui remettait la diagonale
 * descendante dans le poteau qu'on venait juste de libérer.
 */
function degagement(hauteurPiece: number, profilBarre: string): number {
  return hauteurPiece / 2 + getProfile(profilBarre).h / 2 + 15;
}

/** Hauteur de la pièce qui porte la toiture : traverse ou arbalétrier. */
function hPorteur(p: ProjectParams): number {
  return p.frame.enabled
    ? getProfile(p.frame.rafterProfile).h
    : getProfile(p.truss.topChordProfile).h;
}

/** Vecteur unitaire, ou l'axe Z si la direction fournie est dégénérée. */
function normale(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return l < 1e-9 ? v3(0, 0, 1) : v3(v.x / l, v.y / l, v.z / l);
}

function diagonale(
  p: ProjectParams,
  set: BracingSet,
  id: string,
  a: Vec3,
  b: Vec3,
  position: string,
  normaleMaille: Vec3,
): Member {
  const axe = normalize(sub(b, a));
  /*
   * Orientée DANS le plan de la maille, perpendiculairement au tube : c'est le
   * plan de ses plats d'about. Le tube, de révolution, n'en est pas changé —
   * mais sa vue de face montre alors ses plats de face, perçages compris, au
   * lieu d'un biais quelconque.
   */
  const dansLaMaille = cross(normaleMaille, axe);
  return {
    id,
    role: 'contreventement',
    profileId: set.profile,
    grade: p.bracing.grade,
    start: a,
    end: b,
    up: Math.hypot(dansLaMaille.x, dansLaMaille.y, dansLaMaille.z) > 1e-6 ? normalize(dansLaMaille) : defaultUp(axe),
    mirrored: false,
    holes: [],
    notches: [],
    porteur: null,
    cutStart: squareCut(a, axe, -1),
    cutEnd: squareCut(b, axe, 1),
    mark: '',
    assemblage: '',
    position,
  };
}
