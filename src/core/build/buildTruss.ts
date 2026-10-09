import { getProfile } from '../catalog/index';
import { memberFrame, miterCut, squareCut, type CutPlane, type Member, type MemberRole } from '../geometry/member';
import { add, cross, dot, normalize, scale, sub, v3, EX, type Vec3 } from '../math/vec3';
import { sectionOutline } from '../geometry/section';
import { frameStations, ridgeHeight, ridgeY, roofZ, type GridParams } from '../model/grid';
import type { ProjectParams } from '../model/project';
import { debordStructurel, pointDeRive } from './genou';
import { degagerLesNoeuds } from './degagementTreillis';
import { reserveSousArbaletrier } from './connections/contreventementFerme';
import type { TrussParams } from '../model/truss';

/** Abouts imposés à une membrure : ébout le long de l'axe, ou plan de coupe. */
interface Abouts {
  readonly ebout?: { debut: number; fin: number };
  readonly coupes?: { debut?: CutPlane; fin?: CutPlane };
}

/** Jeu entre l'about d'une barre de treillis et la membrure qu'elle aborde (mm). */
const JEU_DE_TREILLIS = 10;

/**
 * Fermes treillis paramétriques.
 *
 * Conventions retenues, cohérentes avec le portique à âme pleine :
 *  - la MEMBRURE SUPÉRIEURE suit la ligne de toiture : c'est elle qui porte la
 *    couverture, donc c'est elle qui doit respecter la pente saisie. La hauteur
 *    à l'égout reste l'altitude de l'égout, c'est-à-dire de l'arbalétrier à
 *    l'appui ;
 *  - `heightAtSupport` est la hauteur de ferme entre AXES de membrures à
 *    l'appui. Le poteau est donc plus court que la hauteur à l'égout de cette
 *    valeur : c'est l'entrait qui repose sur sa tête ;
 *  - `heightAtRidge` ne sert QUE si l'entrait est retroussé. Avec un entrait
 *    droit, la hauteur au faîtage est imposée par la pente et vaut
 *    `heightAtSupport` + la montée du versant ; la saisie est alors ignorée.
 *
 * Les membrures sont émises en UNE SEULE pièce par versant (un arbalétrier
 * n'est pas débité panneau par panneau) ; les nœuds de treillis sont des points
 * situés sur leur axe.
 */

/** Altitude de l'entrait à l'appui : le poteau s'arrête là. */
export function tieLevel(g: GridParams, t: TrussParams): number {
  return g.eaveHeight - t.heightAtSupport;
}

/** Nombre de panneaux par versant. Le faîtage est toujours un nœud. */
export function panelsPerSlope(g: GridParams, t: TrussParams): number {
  return g.roofType === 'monopente' ? Math.max(1, t.nPanels) : Math.max(1, Math.ceil(t.nPanels / 2));
}

/** Abscisses transversales des nœuds, du premier appui au dernier. */
export function nodeStations(g: GridParams, t: TrussParams): number[] {
  const m = panelsPerSlope(g, t);
  if (g.roofType === 'monopente') {
    return Array.from({ length: m + 1 }, (_, j) => (j * g.span) / m);
  }
  const yr = ridgeY(g);
  const gauche = Array.from({ length: m + 1 }, (_, j) => (j * yr) / m);
  const droite = Array.from({ length: m }, (_, j) => yr + ((j + 1) * (g.span - yr)) / m);
  return [...gauche, ...droite];
}

/** Altitude de l'entrait à l'abscisse `y`. */
export function tieZ(g: GridParams, t: TrussParams, y: number): number {
  const z0 = tieLevel(g, t);
  if (t.straightTie) return z0;
  // Entrait retroussé : il monte linéairement pour que la hauteur de ferme au
  // faîtage soit exactement `heightAtRidge`.
  const zFaitage = ridgeHeight(g) - t.heightAtRidge;
  if (g.roofType === 'monopente') return z0 + ((zFaitage - z0) * y) / g.span;
  const yr = ridgeY(g);
  return y <= yr
    ? z0 + ((zFaitage - z0) * y) / yr
    : zFaitage + ((z0 - zFaitage) * (y - yr)) / (g.span - yr);
}

/** Hauteur de ferme réellement obtenue au faîtage (mm), pour affichage. */
export function trussDepthAtRidge(g: GridParams, t: TrussParams): number {
  const yr = g.roofType === 'monopente' ? g.span : ridgeY(g);
  return roofZ(g, yr) - tieZ(g, t, yr);
}

/* ------------------------------------------------------------------ */

export function buildTruss(p: ProjectParams): Member[] {
  if (!p.truss.enabled) return [];
  const out: Member[] = [];
  for (const [i, x] of frameStations(p.grid).entries()) {
    const depuis = out.length;
    ferme(out, p, x, i, `ferme ${i + 1}`);
    degagerLesNoeuds(out, depuis, JEU_DE_TREILLIS);
  }
  return out;
}

function ferme(out: Member[], p: ProjectParams, x: number, i: number, file: string): void {
  const g = p.grid;
  const t = p.truss;
  const ys = nodeStations(g, t);
  const N = ys.length - 1; // nombre de panneaux
  const iFaitage = g.roofType === 'monopente' ? N : panelsPerSlope(g, t);

  const T = ys.map((y) => v3(x, y, roofZ(g, y)));
  const B = ys.map((y) => v3(x, y, tieZ(g, t, y)));
  const noeud = (l: readonly Vec3[], k: number): Vec3 => l[Math.min(Math.max(k, 0), N)] as Vec3;

  /*
   * ⚠ ÉBOUT des barres de treillis. Montants et diagonales vont d'un nœud à
   * l'autre, c'est-à-dire d'un AXE de membrure à l'autre : menés jusque-là, ils
   * entrent dans les membrures d'une demi-hauteur de section à chaque about.
   * En atelier ils s'arrêtent à la face de la membrure et se boulonnent sur le
   * gousset. Les membrures, elles, ne s'éboutent pas : elles sont continues.
   */
  /**
   * Recul à un about, mesuré LE LONG de la barre de treillis.
   *
   * ⚠ Ce n'est pas la demi-hauteur de la membrure. Une diagonale l'aborde en
   * biais : pour dégager une face située à `d` de l'axe, il faut reculer de
   * `d / sin θ` le long de la barre, θ étant l'angle entre les deux. Reculer de
   * `d` tout court laisse la diagonale plantée dans la membrure — d'autant plus
   * qu'elle est couchée.
   *
   * ⚠⚠ Et ce n'est pas l'AXE de la barre qui doit s'arrêter à la face, c'est
   * toute sa section. Une cornière n'est pas centrée sur son axe : son aile
   * s'étend à 72 mm d'un côté pour 28 de l'autre, et la membrure de même. Arrêtée
   * sur l'axe à mi-hauteur de membrure, la diagonale couchait son aile sur la
   * cornière de membrure, et ses boulons la traversaient. On dégage donc le
   * point de la section le plus avancé vers la membrure, de la face réelle de
   * celle-ci, plus un jeu d'atelier.
   */
  /*
   * Sous l'arbalétrier, le jeu réserve aussi la place de la tôle d'attache de
   * la poutre au vent, boulonnée sous son aile couchée, et de ses écrous.
   */
  const jeuHaut = JEU_DE_TREILLIS + reserveSousArbaletrier(p);
  const jeuA = (surLeHaut: boolean): number => (surLeHaut ? jeuHaut : JEU_DE_TREILLIS);
  const reculA = (p0: Vec3, versLInterieur: Vec3, axe: Vec3, profilBarre: string): number => {
    const surLeHaut = Math.abs(p0.z - roofZ(g, p0.y)) < Math.abs(p0.z - tieZ(g, t, p0.y));
    const chaine = surLeHaut ? T : B;
    const profilMembrure = surLeHaut ? t.topChordProfile : t.bottomChordProfile;

    /*
     * Direction locale de la membrure : celle des segments qui aboutissent au
     * nœud. ⚠ Au faîtage il y en a DEUX, de pentes opposées : ne dégager que le
     * plus proche laissait la diagonale centrale entrer dans l'autre versant.
     */
    const directions: Vec3[] = [];
    let meilleur = { d: Infinity, dir: v3(0, 1, 0) };
    for (let k = 0; k < chaine.length - 1; k++) {
      const q0 = chaine[k] as Vec3;
      const q1 = chaine[k + 1] as Vec3;
      const dist = Math.min(
        Math.hypot(p0.y - q0.y, p0.z - q0.z),
        Math.hypot(p0.y - q1.y, p0.z - q1.z),
      );
      if (dist < 1) directions.push(normalize(sub(q1, q0)));
      if (dist < meilleur.d) meilleur = { d: dist, dir: normalize(sub(q1, q0)) };
    }
    if (directions.length === 0) directions.push(meilleur.dir);

    const hauteurs = (id: string): number[] => sectionOutline(getProfile(id), 1).outer.map((q) => q.z);
    return Math.max(
      ...directions.map((dir) => {
        // Normale à la membrure, dans le plan de la ferme, tournée vers la barre.
        const hautMembrure = upDansLePlan(dir);
        const signe = dot(versLInterieur, hautMembrure) >= 0 ? 1 : -1;
        const n = scale(hautMembrure, signe);
        const sin = Math.max(Math.sqrt(0.15), dot(versLInterieur, n)); // borne : pas de recul infini
        const face = Math.max(...hauteurs(profilMembrure).map((z) => z * signe));
        const penche = dot(upDansLePlan(axe), n);
        const avance = Math.min(...hauteurs(profilBarre).map((z) => z * penche));
        return (face + jeuA(surLeHaut) - avance) / sin;
      }),
    );
  };

  const emettre = (
    id: string,
    role: MemberRole,
    profileId: string,
    a: Vec3,
    b: Vec3,
    position: string,
    abouts: Abouts = {},
  ): void => {
    if (role !== 'montant' && role !== 'diagonale') {
      emit(out, p, id, role, profileId, a, b, position, abouts.ebout, abouts.coupes);
      return;
    }
    const u = normalize(sub(b, a));
    /*
     * ⚠ L'ébout passe par les PLANS DE COUPE, jamais par les points d'about.
     * Ceux-ci sont les points de travail : le modèle de calcul y construit ses
     * nœuds par coïncidence géométrique, et les déplacer désolidarise la
     * triangulation — la ferme devient un mécanisme, et le solveur refuse de la
     * résoudre. La barre raccourcit, son épure ne bouge pas.
     */
    emit(out, p, id, role, profileId, a, b, position, {
      debut: reculA(a, u, u, profileId),
      fin: reculA(b, scale(u, -1), u, profileId),
    });
  };

  /*
   * --- Membrures, en une pièce par versant ---
   *
   * ⚠ L'arbalétrier est PROLONGÉ en porte-à-faux jusqu'à la rive quand la
   * toiture déborde : sans quoi la panne de rive ne reposait sur rien — sa
   * ferme s'arrêtait à l'appui, et rien d'autre ne venait sous elle. Le nœud
   * d'appui devient un point intérieur de la membrure, ce que le modèle de
   * calcul sait traiter.
   */
  const debord = debordStructurel(p);
  const rive = (appui: Vec3, versLeHaut: Vec3): Vec3 => pointDeRive(appui, normalize(versLeHaut), debord);
  const T0 = T[0] as Vec3;
  const TN = noeud(T, N);
  /*
   * ⚠ Au faîtage, les deux tronçons se rejoignent en ONGLET, dans le plan
   * bissecteur : coupés d'équerre sur le même nœud, ils se chevauchaient sous
   * l'axe et laissaient un vide au-dessus.
   */
  const onglet = (q: Vec3, versSoi: Vec3, versVoisin: Vec3): CutPlane =>
    miterCut(q, normalize(versSoi), normalize(versVoisin));
  if (g.roofType === 'monopente') {
    emettre(`${i}-MS`, 'membrure-sup', t.topChordProfile, rive(T0, sub(TN, T0)), TN, `${file} — arbalétrier`);
  } else {
    const F = noeud(T, iFaitage);
    const G0 = rive(T0, sub(F, T0));
    const D0 = rive(TN, sub(F, TN));
    emettre(`${i}-MSG`, 'membrure-sup', t.topChordProfile, G0, F, `${file} — arbalétrier gauche`, {
      coupes: { fin: onglet(F, sub(G0, F), sub(D0, F)) },
    });
    emettre(`${i}-MSD`, 'membrure-sup', t.topChordProfile, F, D0, `${file} — arbalétrier droit`, {
      coupes: { debut: onglet(F, sub(D0, F), sub(G0, F)) },
    });
  }

  /*
   * ⚠ L'entrait repose sur la tête du poteau : il est PROLONGÉ au-delà du nœud
   * d'appui jusqu'au nu extérieur du poteau. Arrêté sur l'axe, il ne couvrait
   * que la moitié de la tête, et rien ne s'y boulonnait.
   */
  const pignon = i === 0 || i === g.nBays;
  const profilPoteau = pignon && p.frame.distinctGableFrame ? p.frame.gableColumnProfile : p.frame.columnProfile;
  const appui = getProfile(profilPoteau).h / 2;
  if (t.straightTie || g.roofType === 'monopente') {
    emettre(`${i}-MI`, 'membrure-inf', t.bottomChordProfile, B[0] as Vec3, noeud(B, N), `${file} — entrait`, {
      ebout: { debut: -appui, fin: -appui },
    });
  } else {
    const F = noeud(B, iFaitage);
    const B0 = B[0] as Vec3;
    const BN = noeud(B, N);
    emettre(`${i}-MIG`, 'membrure-inf', t.bottomChordProfile, B0, F, `${file} — entrait gauche`, {
      ebout: { debut: -appui, fin: 0 },
      coupes: { fin: onglet(F, sub(B0, F), sub(BN, F)) },
    });
    emettre(`${i}-MID`, 'membrure-inf', t.bottomChordProfile, F, BN, `${file} — entrait droit`, {
      ebout: { debut: 0, fin: -appui },
      coupes: { debut: onglet(F, sub(BN, F), sub(B0, F)) },
    });
  }

  /* --- Treillis --- */
  if (t.type === 'polonceau') {
    polonceau(emettre, g, t, T, B, N, iFaitage, i, file);
    return;
  }

  const montants = t.type === 'pratt' || t.type === 'howe' || t.warrenWithPosts;
  if (montants) {
    /*
     * ⚠ Les montants d'ABOUT, en k = 0 et k = N, ne sont pas facultatifs.
     *
     * Sur une ferme Pratt, la diagonale de rive part du HAUT de l'appui : sans
     * montant d'about, le nœud d'appui de l'entrait ne reçoit aucune barre de
     * treillis et le panneau de rive devient un Vierendeel. L'entrait y reprend
     * alors l'effort tranchant en FLEXION — 50 kN·m sur une cornière, pour 52 kN
     * d'effort normal — et la ferme fléchit sept fois plus qu'elle ne devrait.
     *
     * Le montant d'about relie de surcroît l'about du chevron à l'appui, qui
     * resterait sinon en porte-à-faux.
     */
    for (let k = 0; k <= N; k++) {
      const bas = noeud(B, k);
      const haut = noeud(T, k);
      // Un montant de longueur nulle n'aurait aucun sens : au faîtage d'une ferme
      // dont l'entrait rejoint l'arbalétrier, les deux nœuds se confondent.
      if (Math.hypot(haut.y - bas.y, haut.z - bas.z) < 1) continue;
      emettre(`${i}-MO${k}`, 'montant', t.postProfile, bas, haut, `${file} — montant ${k === 0 || k === N ? 'd’about' : k}`);
    }
  }

  for (let k = 0; k < N; k++) {
    const versLeCentre = k < N / 2;
    let a: Vec3;
    let b: Vec3;
    if (t.type === 'warren') {
      // Diagonales alternées : le zigzag caractéristique du Warren.
      [a, b] = k % 2 === 0 ? [noeud(B, k), noeud(T, k + 1)] : [noeud(T, k), noeud(B, k + 1)];
    } else if (t.type === 'pratt') {
      // Pratt : diagonales descendant vers le centre, donc tendues.
      [a, b] = versLeCentre ? [noeud(T, k), noeud(B, k + 1)] : [noeud(B, k), noeud(T, k + 1)];
    } else {
      // Howe : l'inverse du Pratt, diagonales comprimées vers le centre.
      [a, b] = versLeCentre ? [noeud(B, k), noeud(T, k + 1)] : [noeud(T, k), noeud(B, k + 1)];
    }
    emettre(`${i}-DI${k}`, 'diagonale', t.diagonalProfile, a, b, `${file} — diagonale ${k + 1}`);
  }
}

/**
 * Ferme Polonceau : contrefiches PERPENDICULAIRES à l'arbalétrier, et tirants
 * reliant le pied de chaque contrefiche au nœud d'arbalétrier précédent. Chaque
 * groupe arbalétrier / contrefiche / tirant forme le triangle caractéristique.
 * Un poinçon reprend le faîtage.
 */
function polonceau(
  emettre: (id: string, role: MemberRole, profileId: string, a: Vec3, b: Vec3, position: string) => void,
  g: GridParams,
  t: TrussParams,
  T: readonly Vec3[],
  B: readonly Vec3[],
  N: number,
  iFaitage: number,
  i: number,
  file: string,
): void {
  emettre(
    `${i}-POINCON`,
    'montant',
    t.postProfile,
    B[iFaitage] as Vec3,
    T[iFaitage] as Vec3,
    `${file} — poinçon`,
  );

  /*
   * ⚠ Montants d'about, comme sur les autres fermes. Les contrefiches d'une
   * Polonceau retombent sur l'entrait à des abscisses quelconques, jamais à
   * l'appui : sans ces deux montants, le panneau compris entre l'appui et le pied
   * de la première contrefiche n'est pas triangulé, et l'entrait y travaille en
   * flexion. La ferme fléchissait alors de 126 mm au lieu de 8.
   */
  for (const k of [0, N]) {
    const bas = B[k] as Vec3;
    const haut = T[k] as Vec3;
    if (Math.hypot(haut.y - bas.y, haut.z - bas.z) < 1) continue;
    emettre(`${i}-MO${k}`, 'montant', t.postProfile, bas, haut, `${file} — montant d’about`);
  }

  for (let k = 1; k <= N - 1; k++) {
    if (k === iFaitage) continue; // le faîtage a son poinçon
    const sommet = T[k] as Vec3;
    // Direction de l'arbalétrier au nœud k, puis sa perpendiculaire vers le bas.
    const voisin = k < iFaitage ? (T[k + 1] as Vec3) : (T[k - 1] as Vec3);
    const rampant = normalize(sub(voisin, sommet));
    // La perpendiculaire au rampant doit descendre, quel que soit le sens dans
    // lequel on a pris le rampant (il change de signe d'un versant à l'autre).
    const perp = normalize(cross(EX, rampant));
    const versLeBas = perp.z <= 0 ? perp : scale(perp, -1);
    const pied = intersectionEntrait(sommet, versLeBas, g, t, B, N);
    if (!pied) continue;

    emettre(`${i}-CF${k}`, 'montant', t.postProfile, pied, sommet, `${file} — contrefiche ${k}`);
    const ancrage = k < iFaitage ? (T[k - 1] as Vec3) : (T[k + 1] as Vec3);
    emettre(`${i}-TI${k}`, 'diagonale', t.diagonalProfile, pied, ancrage, `${file} — tirant ${k}`);
  }
}

/**
 * Intersection d'une droite avec la ligne d'entrait, résolue segment par
 * segment : l'entrait peut être brisé (retroussé), il n'y a donc pas de
 * formule unique.
 */
function intersectionEntrait(
  origine: Vec3,
  direction: Vec3,
  _g: GridParams,
  _t: TrussParams,
  B: readonly Vec3[],
  N: number,
): Vec3 | null {
  for (let s = 0; s < N; s++) {
    const p0 = B[s] as Vec3;
    const p1 = B[s + 1] as Vec3;
    // Résolution dans le plan (y, z) : origine + u·direction = p0 + v·(p1−p0)
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    const det = direction.y * -dz - direction.z * -dy;
    if (Math.abs(det) < 1e-12) continue;
    const ry = p0.y - origine.y;
    const rz = p0.z - origine.z;
    const u = (ry * -dz - rz * -dy) / det;
    const v = (direction.y * rz - direction.z * ry) / det;
    if (u > 0 && v >= -1e-9 && v <= 1 + 1e-9) {
      return v3(origine.x, p0.y + v * dy, p0.z + v * dz);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */

/**
 * Émet une barre de treillis — ou DEUX barres si l'option « double cornière »
 * est active et que le profil est une cornière.
 *
 * Les deux cornières d'une paire sont dos à dos de part et d'autre du gousset :
 * chacune est décalée de (épaisseur de gousset / 2 + position de son centre de
 * gravité) et l'une est le MIROIR de l'autre. Leurs plans de coupe sont
 * identiques — un plan perpendiculaire à l'axe est inchangé par un décalage
 * perpendiculaire à l'axe — donc les deux pièces ont exactement la même
 * longueur de débit, ce qui est bien le cas en atelier.
 */
function emit(
  out: Member[],
  p: ProjectParams,
  id: string,
  role: MemberRole,
  profileId: string,
  a: Vec3,
  b: Vec3,
  position: string,
  ebout: { debut: number; fin: number } = { debut: 0, fin: 0 },
  coupes: Abouts['coupes'] = {},
): void {
  const axe = normalize(sub(b, a));
  // Ébout : les plans de coupe reculent le long de l'axe, les abouts ne bougent
  // pas. Un ébout ne peut pas dévorer la barre — sur une maille très courte, on
  // se contente de ce que la géométrie permet.
  const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const k = Math.min(1, (l * 0.7) / Math.max(1e-6, ebout.debut + ebout.fin));
  const pDebut = v3(
    a.x + axe.x * ebout.debut * k,
    a.y + axe.y * ebout.debut * k,
    a.z + axe.z * ebout.debut * k,
  );
  const pFin = v3(
    b.x - axe.x * ebout.fin * k,
    b.y - axe.y * ebout.fin * k,
    b.z - axe.z * ebout.fin * k,
  );
  const base: Member = {
    id,
    role,
    profileId,
    grade: p.truss.grade,
    start: a,
    end: b,
    up: upDansLePlan(axe),
    mirrored: false,
    holes: [],
    notches: [],
    porteur: null,
    cutStart: coupes.debut ?? squareCut(pDebut, axe, -1),
    cutEnd: coupes.fin ?? squareCut(pFin, axe, 1),
    mark: '',
    assemblage: '',
    position,
  };

  const profil = getProfile(profileId);
  if (profil.shape !== 'L') {
    out.push(base);
    return;
  }

  const f = memberFrame(base);
  const d = profil.cy + p.connections.gusset.thickness / 2;
  const decale = (signe: 1 | -1, miroir: boolean, suffixe: string): Member => ({
    ...base,
    id: `${id}${suffixe}`,
    start: add(base.start, scale(f.ay, signe * d)),
    end: add(base.end, scale(f.ay, signe * d)),
    mirrored: miroir,
    position: suffixe ? `${position} (cornière ${suffixe.toUpperCase()})` : position,
  });
  /*
   * ⚠ Une cornière SIMPLE se plaque, elle aussi, contre une face du gousset :
   * posée sur le plan de la ferme, elle occupait l'épaisseur du gousset et
   * ses boulons n'avaient rien à serrer.
   */
  if (!p.truss.doubleAngles) {
    out.push(decale(1, false, ''));
    return;
  }
  out.push(decale(1, false, 'a'), decale(-1, true, 'b'));
}

/**
 * Direction « haut de section » d'une barre de ferme : dans le plan de la
 * ferme, donc perpendiculaire à l'axe du bâtiment.
 */
function upDansLePlan(axe: Vec3): Vec3 {
  const n = cross(EX, axe);
  if (Math.hypot(n.x, n.y, n.z) < 1e-9) return v3(0, 0, 1);
  const u = normalize(n);
  return u.z >= 0 ? u : scale(u, -1);
}
