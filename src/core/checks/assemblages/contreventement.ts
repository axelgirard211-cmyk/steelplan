import type { Plate, StructuralModel } from '../../build/types';
import { getGrade, getProfile } from '../../catalog/index';
import type { Pt2 } from '../../geometry/section';
import { longueurDeposee } from '../../geometry/weld';
import { add, cross, dot, scale, sub, type Vec3 } from '../../math/vec3';
import type { ProjectParams } from '../../model/project';
import { designationBoulon, fbRd, fvRd } from '../boulons';
import { GAMMA_M2 } from '../coefficients';
import { resistanceParMm } from '../soudures';
import { assembler, verif, type AssemblageCheck, type VerifAssemblage } from './types';

/**
 * ATTACHE DE DIAGONALE — plat soudé dans le tube fendu, deux boulons sur un
 * gousset soudé sur la pièce porteuse (EN 1993-1-8).
 *
 * ⚠ Les diagonales étaient vérifiées en barre — traction, élancement — sans que
 * rien ne dise si leurs abouts tenaient : deux M16 et un plat de 10 transmettent
 * l'effort du vent de pignon, et ce sont eux qui cèdent les premiers.
 *
 * Toute la géométrie est RELUE dans le modèle — pinces, épaisseurs, cordons —,
 * là où le générateur d'assemblages l'a posée et d'où partent les plans.
 */

/** Traction maximale d'une diagonale, sur toutes les combinaisons ELU (kN). */
export interface TractionDiagonale {
  readonly mark: string;
  readonly n: number;
  readonly combinaison: string;
}

const NON_COUVERT = [
  'cisaillement de bloc du plat et du gousset',
  'flambement du gousset comprimé (largeur de Whitmore)',
  'traînage de cisaillement de la section du tube à la fente',
  'excentrement du recouvrement simple plat / gousset',
];

export function verifierAttachesDeContreventement(
  p: ProjectParams,
  model: StructuralModel,
  tractions: readonly TractionDiagonale[],
): AssemblageCheck[] {
  const parId = new Map(model.members.map((m) => [m.id, m]));
  const bolt = p.connections.gusset.bolt;
  const out: AssemblageCheck[] = [];

  for (const t of tractions) {
    const tube = model.members.find((m) => m.role === 'contreventement' && m.mark === t.mark);
    if (!tube) continue;
    const prTube = getProfile(tube.profileId);
    const N = Math.abs(t.n) * 1000;
    let pire: AssemblageCheck | null = null;

    for (const plat of model.plates.filter((pl) => pl.kind === 'plat-tube' && pl.porteur === tube.id)) {
      const trous = plat.holes.map((h) => point(plat, h.at));
      // Le gousset du plat : celui dont un trou est COAXIAL à un trou du plat —
      // les deux tôles sont accolées, leurs plans moyens à une épaisseur l'un de l'autre.
      const n = cross(plat.u, plat.v);
      const coaxial = (a: Vec3, b: Vec3): boolean => {
        const d = sub(a, b);
        return Math.hypot(...[d.x, d.y, d.z].map((c, i) => c - dot(d, n) * [n.x, n.y, n.z][i]!)) < 1;
      };
      const gousset = model.plates.find(
        (pl) => pl.kind === 'gousset-cv' && pl.holes.some((h) => trous.some((q) => coaxial(point(pl, h.at), q))),
      );
      // Gousset soudé : sa pièce porteuse ; boulonné sous l'aile d'un arbalétrier : la pièce percée pour lui.
      const appui = gousset
        ? (parId.get(gousset.porteur ?? '') ?? model.members.find((m) => m.holes.some((h) => h.from === gousset.id)))
        : undefined;
      if (!gousset || !appui) continue;
      const nB = plat.holes.length;
      const verifs: VerifAssemblage[] = [];

      verifs.push(verif('cisaillement des boulons', N / nB / 1000, fvRd(bolt) / 1000, 'kN'));

      // Plat tiré vers le tube : il se déchire vers son bout libre.
      const ys = plat.holes.map((h) => h.at.y).sort((a, b) => a - b);
      const bout = Math.min(...plat.outline.map((q) => q.y));
      const largeur = Math.max(...plat.outline.map((q) => q.z)) - Math.min(...plat.outline.map((q) => q.z));
      const pincesPlat = { e1: (ys[0] as number) - bout, p1: nB > 1 ? (ys[1] as number) - (ys[0] as number) : 0, e2: largeur / 2 };
      verifs.push(verif('pression diamétrale sur le plat', N / nB / 1000, fbRd(bolt, plat.thickness, plat.grade, pincesPlat) / 1000, 'kN'));

      // Gousset tiré vers le tube : pince mesurée sur son contour, au-delà du dernier boulon.
      const dir = { y: dot(plat.u, gousset.u), z: dot(plat.u, gousset.v) };
      const pincesGousset = {
        e1: Math.min(...gousset.holes.map((h) => rayon(gousset.outline, h.at, dir))),
        p1: pincesPlat.p1,
        e2: Math.min(...gousset.holes.map((h) => bord(gousset.outline, h.at))),
      };
      verifs.push(
        verif('pression diamétrale sur le gousset', N / nB / 1000, fbRd(bolt, gousset.thickness, gousset.grade, pincesGousset) / 1000, 'kN'),
      );

      // Cordons : ceux que porte le modèle, avec leur gorge et leur longueur.
      const cordons = (id: string, nuance: Plate['grade']): number =>
        model.welds
          .filter((w) => w.between[1] === id)
          .reduce((s, w) => s + longueurDeposee(w) * resistanceParMm(w.throat, nuance), 0);
      verifs.push(verif('cordons du plat dans la fente', N / 1000, cordons(plat.id, plat.grade) / 1000, 'kN'));
      if (gousset.porteur) {
        verifs.push(verif('cordons du gousset sur la pièce porteuse', N / 1000, cordons(gousset.id, gousset.grade) / 1000, 'kN'));
      } else {
        // Tôle boulonnée sur la pièce : ses boulons d'appui reprennent tout l'effort.
        const trousA = appui.holes.filter((h) => h.from === gousset.id);
        const nA = Math.max(1, trousA.length);
        verifs.push(verif('cisaillement des boulons sur la pièce porteuse', N / nA / 1000, fvRd(bolt) / 1000, 'kN'));
        const pr = getProfile(appui.profileId);
        if (pr.shape === 'L' && trousA.length >= 2) {
          // Aile couchée continue : pince longitudinale non limitante ; transversale jusqu'au bord de l'aile.
          const ss = trousA.map((h) => h.s).sort((a, b) => a - b);
          const p1 = (ss[ss.length - 1] as number) - (ss[0] as number);
          const e2 = pr.a2 - pr.cy - (trousA[0] as (typeof trousA)[number]).at.y;
          verifs.push(
            verif('pression diamétrale sur l’aile de la pièce porteuse', N / nA / 1000, fbRd(bolt, pr.t, appui.grade, { e1: 3 * p1, p1, e2 }) / 1000, 'kN'),
          );
        }
      }

      // Section nette du tube, amputée des deux lèvres de la fente (EN 1993-1-1, 6.2.3).
      if (prTube.shape === 'CHS' || prTube.shape === 'BOX' || prTube.shape === 'RECT') {
        const net = prTube.A - 2 * (plat.thickness + 2) * prTube.t;
        const nuRd = (0.9 * net * getGrade(tube.grade).fu) / GAMMA_M2;
        verifs.push(verif('section nette du tube à la fente', N / 1000, nuRd / 1000, 'kN'));
      }

      const c = assembler({
        id: `cv-${t.mark}`,
        libelle: `Attache de diagonale ${t.mark} — ${tube.position.split(/ — |,/)[0]}, sur ${getProfile(appui.profileId).id}`,
        boulon: `${nB} × ${designationBoulon(bolt)}`,
        sollicitations: `N = ${(N / 1000).toFixed(1).replace('.', ',')} kN (traction de la diagonale)`,
        combinaison: t.combinaison,
        verifs,
        nonCouvert: NON_COUVERT,
      });
      if (!pire || c.ratio > pire.ratio) pire = c;
    }
    if (pire) out.push(pire);
  }
  return out;
}

/* ------------------------------------------------------------------ */

export function point(pl: Plate, q: Pt2): Vec3 {
  return add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z)));
}

/** Distance d'un point au contour, le long d'une direction (rayon lancé dans la tôle). */
function rayon(contour: readonly Pt2[], o: Pt2, d: Pt2): number {
  let mini = Infinity;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i] as Pt2;
    const b = contour[(i + 1) % contour.length] as Pt2;
    const ex = b.y - a.y;
    const ez = b.z - a.z;
    const det = d.y * -ez - d.z * -ex;
    if (Math.abs(det) < 1e-12) continue;
    const wy = a.y - o.y;
    const wz = a.z - o.z;
    const t = (wy * -ez - wz * -ex) / det;
    const u = (d.y * wz - d.z * wy) / det;
    if (t > 0 && u >= 0 && u <= 1) mini = Math.min(mini, t);
  }
  return mini;
}

/** Plus courte distance d'un point au contour : la pince transversale la plus faible. */
export function bord(contour: readonly Pt2[], o: Pt2): number {
  let mini = Infinity;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i] as Pt2;
    const b = contour[(i + 1) % contour.length] as Pt2;
    const ey = b.y - a.y;
    const ez = b.z - a.z;
    const l2 = ey * ey + ez * ez;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((o.y - a.y) * ey + (o.z - a.z) * ez) / l2)) : 0;
    mini = Math.min(mini, Math.hypot(o.y - (a.y + t * ey), o.z - (a.z + t * ez)));
  }
  return mini;
}
