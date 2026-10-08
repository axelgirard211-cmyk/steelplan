import { getProfile } from '../../catalog/index';
import { boltGrid, hole, pitchFor, type Hole } from '../../geometry/holes';
import { fibreAbscissa, memberFrame, type Member } from '../../geometry/member';
import { add, dot, normalize, scale, sub, v3, type Vec3 } from '../../math/vec3';
import { sectionOutline, type Pt2 } from '../../geometry/section';
import { holeDiameter, minEdgeDistance, type BoltSpec } from '../../model/connections';
import type { ProjectParams } from '../../model/project';
import { frameStations } from '../../model/grid';
import type { Plate, PlateHole } from '../types';
import { colineaires, contourAutourDesTrous, couperDemiPlan, longueurAxe, proche, rectangle } from './geom';

/**
 * ÉCLISSES DE CONTINUITÉ ET GOUSSETS DE TREILLIS.
 *
 * Les deux transmettent un effort par CONTACT BOULONNÉ sur des tôles
 * rapportées, et non par une platine soudée d'about : c'est ce qui les sépare
 * des platines, et ce qui justifie qu'ils vivent ensemble. Dans les deux cas les
 * barres assemblées sont PERCÉES — elles partent donc percées de l'atelier, ce
 * que leur plan de débit doit dire.
 */

/**
 * Éclissage d'une traverse débitée en deux tronçons.
 *
 * Deux éclisses d'âme, une de chaque côté, boulonnées à travers les âmes des
 * deux tronçons. Les DEUX tronçons reçoivent la même grille de perçage,
 * symétrique par rapport au joint : c'est ce qui permet de les assembler dans un
 * sens ou dans l'autre, et c'est la même grille que celle des éclisses.
 */
export function eclisses(
  p: ProjectParams,
  members: readonly Member[],
  plates: Plate[],
  ajouter: (memberId: string, h: Hole[]) => void,
): void {
  const sp = p.connections.splice;
  const bolt = sp.bolt;
  const dTrou = holeDiameter(bolt);
  const pince = Math.max(2 * dTrou, minEdgeDistance(bolt));
  const pas = 3 * dTrou;

  // On repère les joints : deux tronçons de traverse qui se touchent bout à bout.
  const traverses = members.filter((m) => m.role === 'traverse');
  const vus = new Set<string>();

  for (const a of traverses) {
    for (const b of traverses) {
      if (a === b) continue;
      if (!proche(a.end, b.start, 1)) continue;
      // ⚠ Deux tronçons se touchent aussi au FAÎTAGE, mais en changeant de
      // direction : ce n'est pas un joint d'éclissage, c'est un nœud. Un joint
      // d'éclisse suppose deux tronçons colinéaires.
      if (!colineaires(a, b)) continue;
      const cle = [a.id, b.id].sort().join('|');
      if (vus.has(cle)) continue;
      vus.add(cle);

      const profil = getProfile(a.profileId);
      if (profil.shape !== 'I') continue;
      const f = memberFrame(a);
      const joint = a.end;
      const la = Math.hypot(joint.x - a.start.x, joint.y - a.start.y, joint.z - a.start.z);

      // Rangées réparties sur la hauteur d'âme utile, et DEUX files de boulons
      // de chaque côté du joint : une seule file ne transmettrait pas le moment.
      const hAme = profil.h - 2 * profil.tf;
      const pitch = pitchFor(hAme, sp.rows, pince);
      const rangees = boltGrid(sp.rows, 1, pitch, 0).map((g) => g.z);
      const distances = [pince, pince + pas]; // depuis le joint

      // Perçages des deux tronçons, symétriques par rapport au joint : les deux
      // tronçons se percent donc à l'identique depuis leur about de joint.
      const trous = (depuisLAbout: (d: number) => number): Hole[] =>
        rangees.flatMap((z) =>
          distances.map((d) =>
            hole(depuisLAbout(d), { y: 0, z }, bolt, 'y', 'ame', `${a.id}-ECa`),
          ),
        );
      ajouter(a.id, trous((d) => la - d));
      ajouter(b.id, trous((d) => d));

      // Deux éclisses, une par face d'âme, à cheval sur le joint.
      const largeur = 2 * (pince + pas) + 2 * pince;
      const hauteur = hAme - 4;
      const trousTole = rangees.flatMap((z) =>
        distances.flatMap((d) => [
          { at: { y: -d, z }, d: dTrou },
          { at: { y: d, z }, d: dTrou },
        ]),
      );
      for (const cote of [1, -1] as const) {
        plates.push({
          id: `${a.id}-EC${cote > 0 ? 'a' : 'b'}`,
          kind: 'eclisse',
          grade: a.grade,
          thickness: sp.thickness,
          outline: rectangle(largeur, hauteur),
          holes: trousTole,
          pairedWith: null,
          // Boulonnée des deux côtés du joint, soudée à rien : elle part en vrac.
          porteur: null,
          origin: add(joint, scale(f.ay, (cote * (profil.tw + sp.thickness)) / 2)),
          u: f.ax,
          v: f.az,
          mark: '',
          position: `éclisse d’âme — ${a.position}`,
        });
      }
    }
  }
}

/**
 * Goussets : une tôle par nœud de treillis, dans le plan de la ferme, et les
 * perçages correspondants dans les barres de treillis qui y aboutissent.
 *
 * Chaque barre reçoit ses trous à une pince de son about, alignés sur son axe et
 * traversant l'aile plaquée contre le gousset.
 */
/**
 * Position, dans la section, du boulon qui plaque une barre de treillis sur son
 * gousset.
 *
 * ⚠ PAS SUR L'AXE. Sur une cornière, l'axe passe par le centre de gravité — qui
 * se trouve DANS L'ANGLE VIDE, en dehors du métal : un boulon coté là est un
 * boulon qu'aucune perceuse ne peut faire. Le défaut a survécu longtemps parce
 * que l'invariant de perçage comparait le trou au rectangle englobant de la
 * section, et que le centre de gravité y est évidemment contenu.
 *
 * Le décalage se fait selon y, HORS DU PLAN du treillis : il amène le trou à
 * mi-épaisseur de l'aile plaquée contre le gousset, sans rien changer aux
 * coordonnées dans le plan. Les perçages du gousset, eux, restent où ils sont —
 * ils doivent coïncider en projection, ce qu'ils font toujours.
 */
function fibreDeBoulonnage(profil: ReturnType<typeof getProfile>, bolt: BoltSpec): { y: number; z: number } {
  // La grande aile d'une cornière est dressée selon z ; son épaisseur court
  // selon y, depuis le dos situé en y = −cy. Le trou est sur la ligne de
  // trusquinage, comptée depuis le talon (z = −cz).
  if (profil.shape === 'L') return { y: -profil.cy + profil.t / 2, z: -profil.cz + trusquinage(profil, bolt) };
  // Sections dont l'âme contient l'axe : le boulon la traverse en son milieu.
  return { y: 0, z: 0 };
}

/**
 * LIGNE DE TRUSQUINAGE d'une cornière : distance du talon à l'axe des trous.
 *
 * ⚠ Les trous étaient cotés sur la ligne du centre de gravité, à 19,7 mm du
 * talon d'une L 70 : la tête et l'écrou d'un M16 y mordaient l'aile couchée.
 * On perce sur la ligne usuelle (≈ 0,55 a : 40 mm pour une L 70, 55 pour une
 * L 100), bornée par ce que la clé exige près du congé et par la pince du bord.
 */
export function trusquinage(profil: { a: number; t: number; r: number }, bolt: BoltSpec): number {
  const cle = (0.75 * bolt.d) / Math.cos(Math.PI / 6);
  const mini = profil.t + profil.r + cle;
  const maxi = profil.a - minEdgeDistance(bolt);
  const usuel = Math.round((0.55 * profil.a + 1) / 5) * 5;
  return Math.max(mini, Math.min(maxi, usuel));
}

/** Une barre qui quitte un nœud : sa direction, son ébout, sa ligne de trous. */
interface Sortie {
  readonly u: Vec3;
  readonly recul: number;
  /** Décalage de la ligne de trusquinage par rapport à l'axe, dans le plan. */
  readonly ligne: Vec3;
}

export function goussets(
  p: ProjectParams,
  members: readonly Member[],
  plates: Plate[],
  ajouter: (memberId: string, h: Hole[]) => void,
): void {
  const gu = p.connections.gusset;
  const bolt = gu.bolt;
  const dTrou = holeDiameter(bolt);
  const pince = Math.max(gu.edgeMargin, minEdgeDistance(bolt));
  const entraxe = 3 * dTrou;

  const treillis = members.filter(
    (m) => m.role === 'montant' || m.role === 'diagonale',
  );

  /*
   * ⚠ Le nœud est rabattu dans le PLAN DE LA FERME. Les deux cornières d'une
   * barre double sont décalées de part et d'autre de ce plan, et leurs abouts
   * ne coïncident pas : chacune engendrait son propre gousset, noyé dans
   * l'autre cornière. Ce hangar portait 408 goussets au lieu de 204 — près de
   * 2,5 t de tôle commandée pour rien, et pas un gousset entre les deux ailes.
   */
  const files = frameStations(p.grid);
  const dansLePlan = (q: Vec3): Vec3 => {
    const x = files.reduce((a, b) => (Math.abs(b - q.x) < Math.abs(a - q.x) ? b : a), files[0] ?? q.x);
    return v3(x, q.y, q.z);
  };
  /** Clé d'un nœud, et identifiant du gousset qui s'y trouve. */
  const cleBrute = (q0: Vec3): string => {
    const q = dansLePlan(q0);
    return `${Math.round(q.x)}|${Math.round(q.y)}|${Math.round(q.z)}`;
  };
  const cleDuNoeud = (q: Vec3): string => `GOU-${cleBrute(q)}`;

  // Distances des boulons à l'about, communes à la barre et au gousset. C'est
  // cette liste, et rien d'autre, qui définit l'assemblage.
  const distances = [pince, pince + entraxe];

  /**
   * Regroupement des abouts par nœud. On mémorise la DIRECTION SORTANTE de
   * chaque barre depuis le nœud : c'est elle qui donne la position des trous du
   * gousset, exactement comme elle donne celle des trous de la barre.
   */
  const noeuds = new Map<
    string,
    { point: Vec3; sorties: Sortie[]; barres: Set<string> }
  >();
  const noter = (q: Vec3, sortie: Sortie, id: string): void => {
    const cle = cleBrute(q);
    const n = noeuds.get(cle);
    if (n) {
      n.sorties.push(sortie);
      n.barres.add(id);
    } else {
      noeuds.set(cle, { point: dansLePlan(q), sorties: [sortie], barres: new Set([id]) });
    }
  };

  for (const b of treillis) {
    const l = longueurAxe(b);
    const versB = normalize(sub(b.end, b.start));
    /*
     * ⚠ Les pinces se mesurent depuis la COUPE, pas depuis le point de travail.
     * Une barre de treillis est éboutée : son métal commence en retrait de son
     * about, et coter les boulons depuis l'épure les plaçait dans le vide, à
     * l'extérieur de la pièce. Le gousset reçoit le même retrait, sans quoi les
     * deux perçages ne coïncideraient plus.
     */
    const f = memberFrame(b);
    const axe = { y: 0, z: 0 };
    const sDebut = fibreAbscissa(f, b.start, b.cutStart, axe);
    const sFin = fibreAbscissa(f, b.start, b.cutEnd, axe);

    // Deux boulons par about, à la même distance de la coupe que les trous du
    // gousset correspondant — et sur la même ligne de trusquinage.
    const fibre = fibreDeBoulonnage(getProfile(b.profileId), bolt);
    const ligne = scale(f.az, fibre.z);
    noter(b.start, { u: versB, recul: sDebut, ligne }, b.id);
    noter(b.end, { u: scale(versB, -1), recul: l - sFin, ligne }, b.id);

    ajouter(
      b.id,
      distances.flatMap((d) => [
        hole(sDebut + d, fibre, bolt, 'y', 'aile', cleDuNoeud(b.start)),
        hole(sFin - d, fibre, bolt, 'y', 'aile', cleDuNoeud(b.end)),
      ]),
    );
  }

  const membrures = members.filter((m) => m.role === 'membrure-sup' || m.role === 'membrure-inf');

  for (const [cle, n] of noeuds) {
    const id = `GOU-${cle}`.replace('GOU-GOU-', 'GOU-');
    // ⚠ Le gousset porte les trous de TOUTES les barres qui aboutissent au nœud,
    // calculés depuis les mêmes directions et les mêmes distances que les trous
    // des barres. Un gousset non percé partirait en atelier inutilisable, et une
    // grille recalculée à part pourrait ne pas coïncider.
    const brut: PlateHole[] = n.sorties.flatMap(({ u, recul, ligne }) =>
      distances.map((d) => ({
        // Le gousset est dans le plan YZ : ses coordonnées locales sont (y, z).
        // La distance part du nœud et inclut l'ébout de la barre.
        at: { y: u.y * (recul + d) + ligne.y, z: u.z * (recul + d) + ligne.z },
        d: dTrou,
      })),
    );

    /*
     * ⚠ LA MEMBRURE SE BOULONNE SUR SON GOUSSET. Elle passait entre les deux
     * faces du gousset sans rien qui la tienne : les barres de treillis étaient
     * boulonnées sur une tôle libre, et la ferme ne formait pas un ensemble.
     * Deux boulons par tronçon, sur la ligne de trusquinage de la membrure.
     */
    const rognures: { n: Pt2; c: number }[] = [];
    const vers = n.sorties.map((x) => x.u);
    for (const c of membrures) {
      // La membrure de CETTE ferme : toutes les fermes ont la même épure.
      if (Math.abs(c.start.x - n.point.x) > 200) continue;
      const f = memberFrame(c);
      const q = sub(v3(c.start.x, n.point.y, n.point.z), c.start);
      const sNoeud = dot(q, f.ax);
      const ecart = sub(q, scale(f.ax, sNoeud));
      if (Math.hypot(ecart.x, ecart.y, ecart.z) > 1) continue;
      const fibre = fibreDeBoulonnage(getProfile(c.profileId), bolt);
      const a = fibreAbscissa(f, c.start, c.cutStart, fibre);
      const b = fibreAbscissa(f, c.start, c.cutEnd, fibre);
      const [sMin, sMax] = [Math.min(a, b), Math.max(a, b)];
      if (sNoeud < sMin - 1 || sNoeud > sMax + 1) continue;
      let abscisses = [sNoeud - entraxe / 2, sNoeud + entraxe / 2];
      if ((abscisses[0] as number) < sMin + pince) abscisses = [sMin + pince, sMin + pince + entraxe];
      if ((abscisses[1] as number) > sMax - pince) abscisses = [sMax - pince - entraxe, sMax - pince];
      ajouter(c.id, abscisses.map((sb) => hole(sb, fibre, bolt, 'y', 'aile', id)));
      for (const sb of abscisses) {
        const r = add(scale(f.ax, sb - sNoeud), scale(f.az, fibre.z));
        brut.push({ at: { y: r.y, z: r.z }, d: dTrou });
      }
      // Le gousset ne dépasse pas la membrure du côté opposé au treillis : ni
      // au-dessus de l'arbalétrier — où sont les pannes —, ni sous l'entrait.
      const haut = { y: f.az.y, z: f.az.z };
      const cote = Math.sign(vers.reduce((t, u) => t + u.y * haut.y + u.z * haut.z, 0)) || -1;
      const hauteurs = sectionOutline(getProfile(c.profileId), 1).outer.map((x) => x.z);
      rognures.push(
        cote < 0
          ? { n: haut, c: Math.max(...hauteurs) - 5 }
          : { n: { y: -haut.y, z: -haut.z }, c: -Math.min(...hauteurs) },
      );
    }

    // Les deux cornières d'une barre double percent le MÊME trou du gousset :
    // un trou, un boulon qui serre les trois pièces.
    const trous = [
      ...new Map(brut.map((t) => [`${t.at.y.toFixed(1)}|${t.at.z.toFixed(1)}`, t])).values(),
    ];

    // La tôle se découpe autour de ses trous, pince comprise.
    let contour = contourAutourDesTrous(trous.map((t) => t.at), pince);
    for (const r of rognures) contour = couperDemiPlan(contour, r.n, r.c);

    plates.push({
      id,
      kind: 'gousset',
      grade: p.truss.grade,
      thickness: gu.thickness,
      outline: contour.map((q) => ({ y: Math.round(q.y * 10) / 10, z: Math.round(q.z * 10) / 10 })),
      holes: trous,
      pairedWith: null,
      // Les barres de treillis s'y boulonnent toutes : aucune ne la porte.
      porteur: null,
      origin: n.point,
      // Le gousset est dans le plan de la ferme : plan YZ.
      u: v3(0, 1, 0),
      v: v3(0, 0, 1),
      mark: '',
      position: `gousset de treillis — ${n.barres.size} barres`,
    });
  }
}
