import { getProfile } from '../catalog/index';
import { miterCut, squareCut, type CutPlane, type Member } from '../geometry/member';
import { frameStations, rafterLength, ridgeHeight, ridgeY } from '../model/grid';
import type { ProjectParams } from '../model/project';
import { add, cross, dot, normalize, scale, sub, v3, EX, EY, type Vec3 } from '../math/vec3';
import { consoleDeDebord, debordStructurel, genou, pointDeRive } from './genou';
import { tieLevel } from './buildTruss';
import { sousLEntrait } from './connections/platines';
import type { Haunch } from './types';

/**
 * Ossature principale : poteaux, traverses à âme pleine, jarrets.
 *
 * Conventions géométriques, valables pour tout le générateur :
 *  - la PORTÉE est mesurée d'axe de poteau à axe de poteau ;
 *  - la HAUTEUR À L'ÉGOUT est l'altitude du point de travail, c'est-à-dire
 *    l'intersection de l'axe du poteau et de l'axe de la traverse.
 * Ces deux conventions rendent la trame indépendante des profils choisis :
 * changer d'IPE ne déplace pas le bâtiment.
 *
 * ⚠ Les POTEAUX sont construits dans tous les cas, que la toiture soit portée
 * par des traverses à âme pleine ou par des fermes treillis : `frame.enabled`
 * ne commande que les traverses. Une ferme treillis repose forcément sur des
 * poteaux, et ce sont ceux décrits par `frame.columnProfile`.
 */

/** Vrai si le poteau est coiffé d'une ferme (appui simple) et non d'une traverse. */
function appuiTreillis(p: ProjectParams): boolean {
  return p.truss.enabled;
}

/** Profils de la file `i` : les pignons peuvent être allégés. */
function profilsFile(p: ProjectParams, i: number): { poteau: string; traverse: string } {
  const pignon = i === 0 || i === p.grid.nBays;
  const f = p.frame;
  const distinct = f.distinctGableFrame && pignon;
  return {
    poteau: distinct ? f.gableColumnProfile : f.columnProfile,
    traverse: distinct ? f.gableRafterProfile : f.rafterProfile,
  };
}

/**
 * Altitude de tête des poteaux.
 *
 * Sous une traverse à âme pleine, c'est le point de travail, donc la hauteur à
 * l'égout. Sous une ferme treillis, c'est l'ENTRAIT qui repose sur la tête du
 * poteau : celui-ci est plus court de la hauteur de ferme à l'appui.
 */
function teteGauche(p: ProjectParams): number {
  const g = p.grid;
  return appuiTreillis(p) ? tieLevel(g, p.truss) : g.eaveHeight;
}

function teteDroite(p: ProjectParams): number {
  const g = p.grid;
  const base = g.roofType === 'monopente' ? ridgeHeight(g) : g.eaveHeight;
  return appuiTreillis(p) ? base - p.truss.heightAtSupport : base;
}

/* ------------------------------------------------------------------ */
/* Poteaux                                                             */
/* ------------------------------------------------------------------ */

export function buildColumns(p: ProjectParams): Member[] {
  const g = p.grid;
  const out: Member[] = [];
  const surTreillis = appuiTreillis(p);

  for (const [i, x] of frameStations(g).entries()) {
    const profils = profilsFile(p, i);
    const file = `file ${i + 1}`;

    const piedG = v3(x, 0, 0);
    const teteG = v3(x, 0, teteGauche(p));
    const piedD = v3(x, g.span, 0);
    const teteD = v3(x, g.span, teteDroite(p));
    const dirs = directionsDeTraverse(p, x);
    const coupe = (tete: Vec3, versTravee: Vec3): CutPlane | null =>
      p.frame.enabled && !surTreillis
        ? genou(p, tete, versTravee, profils.poteau, profils.traverse, p.frame.haunch.enabled).coupePoteau
        : null;

    out.push(
      poteau(`${i}-PG`, profils.poteau, p, piedG, teteG, surTreillis, `${file} — long pan gauche`, coupe(teteG, dirs.gauche)),
      poteau(`${i}-PD`, profils.poteau, p, piedD, teteD, surTreillis, `${file} — long pan droit`, coupe(teteD, dirs.droite)),
    );
  }
  return out;
}

/**
 * Altitude du bas de la platine de genou d'un poteau, ou `null` sans genou.
 *
 * C'est la limite haute de tout ce qui se soude sur la face intérieure du
 * poteau : la platine de la traverse y est plaquée sur toute sa largeur.
 */
export function basDePlatineDeGenou(p: ProjectParams, i: number, cote: 'gauche' | 'droite'): number | null {
  if (!p.frame.enabled || appuiTreillis(p)) return null;
  const x = frameStations(p.grid)[i];
  if (x === undefined) return null;
  const profils = profilsFile(p, i);
  const dirs = directionsDeTraverse(p, x);
  const tete = cote === 'gauche' ? v3(x, 0, teteGauche(p)) : v3(x, p.grid.span, teteDroite(p));
  const k = genou(p, tete, dirs[cote], profils.poteau, profils.traverse, p.frame.haunch.enabled);
  return k.platine.centre.z - k.platine.hauteur / 2;
}

/**
 * Direction de la traverse depuis chaque genou, vers l'intérieur de la travée.
 * Bipente : vers le faîtage ; monopente : vers le genou opposé.
 */
function directionsDeTraverse(p: ProjectParams, x: number): { gauche: Vec3; droite: Vec3 } {
  const g = p.grid;
  const genouG = v3(x, 0, g.eaveHeight);
  if (g.roofType === 'monopente') {
    const genouD = v3(x, g.span, ridgeHeight(g));
    return { gauche: normalize(sub(genouD, genouG)), droite: normalize(sub(genouG, genouD)) };
  }
  const genouD = v3(x, g.span, g.eaveHeight);
  const faitage = v3(x, ridgeY(g), ridgeHeight(g));
  return { gauche: normalize(sub(faitage, genouG)), droite: normalize(sub(faitage, genouD)) };
}

/**
 * Poteau : coupe droite en pied ; en tête, coupe horizontale au ras du haut de
 * la platine de genou — le poteau MONTE jusqu'en tête et la traverse vient s'y
 * boulonner —, ou coupe droite si une ferme vient s'appuyer dessus.
 */
function poteau(
  id: string,
  profileId: string,
  p: ProjectParams,
  pied: Vec3,
  tete: Vec3,
  surTreillis: boolean,
  position: string,
  coupeTete: CutPlane | null,
): Member {
  const axe = normalize(sub(tete, pied));
  return {
    id,
    role: 'poteau',
    profileId,
    grade: p.frame.grade,
    start: pied,
    end: tete,
    // Section dressée dans le plan du portique : la hauteur du profil est
    // orientée selon Y, l'inertie forte travaille donc dans le portique.
    up: EY,
    mirrored: false,
    holes: [],
    notches: [],
    porteur: null,
    cutStart: squareCut(pied, axe, -1),
    // Le plan de coupe passe au-dessus du point de travail ; l'about `end`, lui,
    // reste au point de travail — c'est lui que lit le modèle de calcul. Sous
    // une ferme, il s'arrête sous l'entrait et sa platine de tête.
    cutEnd: surTreillis
      ? squareCut(sub(tete, scale(axe, sousLEntrait(p))), axe, 1)
      : (coupeTete ?? squareCut(tete, axe, 1)),
    mark: '',
    assemblage: '',
    position,
  };
}

/* ------------------------------------------------------------------ */
/* Traverses à âme pleine et jarrets                                   */
/* ------------------------------------------------------------------ */

export function buildSolidRafters(p: ProjectParams): { members: Member[]; haunches: Haunch[] } {
  const members: Member[] = [];
  const haunches: Haunch[] = [];
  if (!p.frame.enabled) return { members, haunches };

  const g = p.grid;
  for (const [i, x] of frameStations(g).entries()) {
    const profils = profilsFile(p, i);
    const file = `file ${i + 1}`;
    if (g.roofType === 'monopente') {
      monopente(members, haunches, p, x, i, file, profils.traverse);
    } else {
      bipente(members, haunches, p, x, i, file, profils.traverse);
    }
  }
  return { members, haunches };
}

function bipente(
  members: Member[],
  haunches: Haunch[],
  p: ProjectParams,
  x: number,
  i: number,
  file: string,
  profilTraverse: string,
): void {
  const g = p.grid;
  const f = p.frame;
  const genouG = v3(x, 0, g.eaveHeight);
  const genouD = v3(x, g.span, g.eaveHeight);
  const faitage = v3(x, ridgeY(g), ridgeHeight(g));

  const rampantG = normalize(sub(faitage, genouG));
  const rampantD = normalize(sub(faitage, genouD));
  const faitageVersG = normalize(sub(genouG, faitage));
  const faitageVersD = normalize(sub(genouD, faitage));
  const profilPoteau = profilsFile(p, i).poteau;
  const kneeG = genou(p, genouG, rampantG, profilPoteau, profilTraverse, f.haunch.enabled);
  const kneeD = genou(p, genouD, rampantD, profilPoteau, profilTraverse, f.haunch.enabled);

  // ÉCLISSAGE : au-delà d'une certaine portée, une traverse ne se transporte
  // pas d'un seul tenant. On la débite en deux tronçons raccordés par éclisses,
  // coupés d'équerre face à face — c'est le boulonnage qui reprend la continuité.
  /*
   * ⚠ Au faîtage, chaque traverse s'arrête à UNE ÉPAISSEUR DE PLATINE du point
   * de travail, comme au genou : les deux platines se plaquent l'une sur l'autre
   * dans le plan du faîtage. Coupées au point de travail, chacune portait sa
   * platine dans le métal de la traverse d'en face.
   */
  const coupeFaitageG = recul(miterCut(faitage, faitageVersG, faitageVersD), p.connections.ridge.thickness);
  const coupeFaitageD = recul(miterCut(faitage, faitageVersD, faitageVersG), p.connections.ridge.thickness);
  pousserTraverse(members, p, `${i}-TG`, profilTraverse, genouG, faitage, upRampant(rampantG), kneeG.coupeTraverse, coupeFaitageG, `${file} — versant gauche`);
  pousserTraverse(members, p, `${i}-TD`, profilTraverse, faitage, genouD, upRampant(normalize(sub(genouD, faitage))), coupeFaitageD, kneeD.coupeTraverse, `${file} — versant droit`);

  /*
   * DÉBORD DE TOITURE À L'ÉGOUT : une CONSOLE, pièce distincte boulonnée sur la
   * semelle extérieure du poteau. La couverture seule ne se porte pas en
   * porte-à-faux ; mais prolonger la traverse au-delà du poteau, comme on le
   * faisait, l'empêchait de s'arrêter sur sa platine de genou.
   */
  poserConsole(members, p, i, file, 'G', genouG, rampantG, profilPoteau, profilTraverse);
  poserConsole(members, p, i, file, 'D', genouD, rampantD, profilPoteau, profilTraverse);

  const hTraverse = getProfile(profilTraverse).h;
  if (f.haunch.enabled) {
    haunches.push(
      jarret(`${i}-JG`, f.haunch.length, f.haunch.depth, hTraverse, profilTraverse, p, kneeG.racineJarret, rampantG, `${file} — jarret gauche`),
      jarret(`${i}-JD`, f.haunch.length, f.haunch.depth, hTraverse, profilTraverse, p, kneeD.racineJarret, rampantD, `${file} — jarret droit`),
    );
  }
  if (f.ridgeHaunch.enabled) {
    haunches.push(
      jarret(`${i}-JFG`, f.ridgeHaunch.length, f.ridgeHaunch.depth, hTraverse, profilTraverse, p, surLaCoupe(faitage, faitageVersG, coupeFaitageG), faitageVersG, `${file} — renfort faîtage gauche`),
      jarret(`${i}-JFD`, f.ridgeHaunch.length, f.ridgeHaunch.depth, hTraverse, profilTraverse, p, surLaCoupe(faitage, faitageVersD, coupeFaitageD), faitageVersD, `${file} — renfort faîtage droit`),
    );
  }
}

function monopente(
  members: Member[],
  haunches: Haunch[],
  p: ProjectParams,
  x: number,
  i: number,
  file: string,
  profilTraverse: string,
): void {
  const g = p.grid;
  const f = p.frame;
  const genouG = v3(x, 0, g.eaveHeight);
  const genouD = v3(x, g.span, ridgeHeight(g));
  const rampant = normalize(sub(genouD, genouG));
  const rampantInverse = normalize(sub(genouG, genouD));
  // Deux genoux, bas et haut : la traverse s'arrête sur une platine à chacun.
  const profilPoteau = profilsFile(p, i).poteau;
  const kneeG = genou(p, genouG, rampant, profilPoteau, profilTraverse, f.haunch.enabled);
  const kneeD = genou(p, genouD, rampantInverse, profilPoteau, profilTraverse, f.haunch.enabled);
  // Le débord n'existe qu'à l'égout, côté bas : c'est là que la panne de rive est posée.
  poserConsole(members, p, i, file, 'G', genouG, rampant, profilPoteau, profilTraverse);

  members.push({
    id: `${i}-TR`,
    role: 'traverse',
    profileId: profilTraverse,
    grade: f.grade,
    start: genouG,
    end: genouD,
    up: upRampant(rampant),
    mirrored: false,
    holes: [],
    notches: [],
    porteur: null,
    cutStart: kneeG.coupeTraverse,
    cutEnd: kneeD.coupeTraverse,
    mark: '',
    assemblage: '',
    position: `${file} — versant`,
  });

  if (f.haunch.enabled) {
    const h = getProfile(profilTraverse).h;
    haunches.push(
      jarret(`${i}-JG`, f.haunch.length, f.haunch.depth, h, profilTraverse, p, kneeG.racineJarret, rampant, `${file} — jarret bas`),
      jarret(`${i}-JD`, f.haunch.length, f.haunch.depth, h, profilTraverse, p, kneeD.racineJarret, rampantInverse, `${file} — jarret haut`),
    );
  }
}

/**
 * CONSOLE DE DÉBORD : une pièce distincte, boulonnée sur la semelle extérieure
 * du poteau. La couverture seule ne se porte pas en porte-à-faux ; mais
 * prolonger la traverse au-delà du poteau, comme on le faisait, l'empêchait de
 * s'arrêter sur sa platine de genou.
 */
function poserConsole(
  members: Member[],
  p: ProjectParams,
  i: number,
  file: string,
  cote: 'G' | 'D',
  travail: Vec3,
  versLeFaitage: Vec3,
  profilPoteau: string,
  profilTraverse: string,
): void {
  const debord = debordStructurel(p);
  if (debord <= 0) return;
  const rive = pointDeRive(travail, versLeFaitage, debord);
  const versRive = normalize(sub(rive, travail));
  const c = consoleDeDebord(p, travail, versRive, profilPoteau, profilTraverse);
  members.push({
    id: `${i}-C${cote}`,
    role: 'console',
    profileId: profilTraverse,
    grade: p.frame.grade,
    start: travail,
    end: rive,
    // Même « haut » que la traverse qu'elle prolonge : la console part vers
    // l'extérieur, son axe est inversé, pas sa section.
    up: upRampant(versLeFaitage.y >= 0 ? versLeFaitage : scale(versLeFaitage, -1)),
    mirrored: false,
    holes: [],
    notches: [],
    porteur: null,
    cutStart: c.coupe,
    cutEnd: squareCut(rive, versRive, 1),
    mark: '',
    assemblage: '',
    position: `${file} — console de débord ${cote === 'G' ? 'gauche' : 'droite'}`,
  });
}

/**
 * Pose une traverse — en une pièce, ou en deux tronçons éclissés à mi-rampant si
 * l'éclissage est demandé. Le point d'éclissage est un point de travail comme un
 * autre : les deux tronçons y sont sciés d'équerre.
 */
function pousserTraverse(
  members: Member[],
  p: ProjectParams,
  id: string,
  profileId: string,
  a: Vec3,
  b: Vec3,
  up: Vec3,
  cutA: ReturnType<typeof squareCut>,
  cutB: ReturnType<typeof squareCut>,
  position: string,
): void {
  const commun = {
    role: 'traverse' as const,
    profileId,
    grade: p.frame.grade,
    up,
    mirrored: false,
    holes: [],
    notches: [],
    porteur: null,
    mark: '',
    assemblage: '',
  };

  if (!p.connections.splice.enabled) {
    members.push({ ...commun, id, start: a, end: b, cutStart: cutA, cutEnd: cutB, position });
    return;
  }

  const axe = normalize(sub(b, a));
  const milieu = v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  members.push({
    ...commun,
    id: `${id}a`,
    start: a,
    end: milieu,
    cutStart: cutA,
    cutEnd: squareCut(milieu, axe, 1),
    position: `${position} (tronçon bas)`,
  });
  members.push({
    ...commun,
    id: `${id}b`,
    start: milieu,
    end: b,
    cutStart: squareCut(milieu, axe, -1),
    cutEnd: cutB,
    position: `${position} (tronçon haut)`,
  });
}


/**
 * Direction « haut de section » d'une traverse : perpendiculaire au rampant,
 * dans le plan du portique, tournée vers le ciel.
 */
export function upRampant(rampant: Vec3): Vec3 {
  return normalize(cross(EX, normalize(rampant)));
}

/** Plan de coupe ramené de `t` vers l'intérieur de la barre (sa normale sort de la barre). */
function recul(c: CutPlane, t: number): CutPlane {
  return { point: sub(c.point, scale(c.normal, t)), normal: c.normal };
}

/** Point où l'axe parti de `origine` selon `direction` rencontre le plan de coupe. */
function surLaCoupe(origine: Vec3, direction: Vec3, c: CutPlane): Vec3 {
  const d = normalize(direction);
  const k = dot(d, c.normal);
  return Math.abs(k) < 1e-9 ? origine : add(origine, scale(d, dot(sub(c.point, origine), c.normal) / k));
}

function jarret(
  id: string,
  longueur: number,
  hauteurTotale: number,
  hTraverse: number,
  profileId: string,
  p: ProjectParams,
  origine: Vec3,
  direction: Vec3,
  position: string,
): Haunch {
  const d = normalize(direction);
  return {
    id,
    profileId,
    grade: p.frame.grade,
    root: origine,
    tip: v3(origine.x + d.x * longueur, origine.y + d.y * longueur, origine.z + d.z * longueur),
    /*
     * ⚠ Racine VERTICALE : le jarret s'applique d'aplomb contre la platine
     * d'about, elle-même verticale. Perpendiculaire à la traverse, sa racine
     * laissait un coin vide au bas de la platine, à l'endroit même du cordon.
     */
    down: v3(0, 0, -1),
    rootDepth: hauteurTotale - hTraverse,
    // Rattaché à sa traverse par la géométrie, une fois tout le modèle construit.
    porteur: null,
    mark: '',
    position,
  };
}

/** Longueur théorique d'un versant, exposée pour les contrôles. */
export { rafterLength };
