import type { Frame2dResult, Node2 } from '../../analysis/frame2d';
import type { FrameAnalysisModel } from '../../analysis/frameModel';
import type { Combination } from '../../analysis/loadCases';
import type { StructuralModel } from '../../build/types';
import { getProfile } from '../../catalog/index';
import { longueurDeposee } from '../../geometry/weld';
import { courseDeTete } from '../../build/secondaire/facades';
import type { ProjectParams } from '../../model/project';
import { designationBoulon, fbRd, fvRd } from '../boulons';
import { resistanceParMm } from '../soudures';
import type { AppuiPotelet } from '../types';
import { assembler, verif, type AssemblageCheck } from './types';

/**
 * ATTACHE DE TÊTE DE POTELET — gousset sous la traverse, deux boulons sur l'âme
 * du potelet au travers d'oblongs verticaux (EN 1993-1-8).
 *
 * L'effort est la réaction de tête du potelet, égale à celle de son pied : la
 * moitié du vent de pignon qu'il reçoit, relevée sur toutes les combinaisons ELU.
 *
 * ⚠ Un oblong PERPENDICULAIRE à l'effort ne porte en pression diamétrale que
 * 0,6 fois ce que porterait un trou rond (EN 1993-1-8, tableau 3.4, note 3). Le
 * vent pousse à l'horizontale, l'oblong est vertical : c'est ce cas.
 */

const NON_COUVERT = [
  'flexion de l’âme du potelet sous l’effort des boulons',
  'flexion du gousset, en console sous la semelle',
  'hypothèse : les oblongs ne transmettent aucun effort vertical tant que la course n’est pas épuisée',
];

/** Plus grand déplacement vertical de la traverse au droit d'un potelet, sous ELS (mm). */
export interface CoursePotelet {
  readonly mm: number;
  readonly combinaison: string;
}

/**
 * Déplacement vertical d'une traverse du portique analysé au droit de
 * l'abscisse transversale `y` (mm), positif vers le haut.
 *
 * Interpolé dans l'élément par les fonctions d'HERMITE — déplacements et
 * rotations des deux nœuds —, et non en ligne droite : la déformée d'une poutre
 * est cubique entre deux nœuds, et un potelet tombe rarement sur l'un d'eux.
 */
export function deplacementVerticalAuDroit(fm: FrameAnalysisModel, res: Frame2dResult, y: number): number | null {
  for (const seg of fm.segments) {
    if (seg.role !== 'traverse') continue;
    const A = fm.nodes[seg.a] as Node2;
    const B = fm.nodes[seg.b] as Node2;
    if (Math.abs(B.y - A.y) < 1e-9 || y < Math.min(A.y, B.y) - 1e-6 || y > Math.max(A.y, B.y) + 1e-6) continue;
    const t = (y - A.y) / (B.y - A.y);
    const local = (n: number): { u: number; v: number; r: number } => {
      const dy = res.d[3 * n] ?? 0;
      const dz = res.d[3 * n + 1] ?? 0;
      return { u: seg.c * dy + seg.s * dz, v: -seg.s * dy + seg.c * dz, r: res.d[3 * n + 2] ?? 0 };
    };
    const a = local(seg.a);
    const b = local(seg.b);
    const u = (1 - t) * a.u + t * b.u;
    const v =
      (1 - 3 * t * t + 2 * t ** 3) * a.v +
      (t - 2 * t * t + t ** 3) * seg.L * a.r +
      (3 * t * t - 2 * t ** 3) * b.v +
      (-t * t + t ** 3) * seg.L * b.r;
    return seg.s * u + seg.c * v;
  }
  return null;
}

/**
 * Relève, pour une combinaison ELS du portique de RIVE, la flèche de la traverse
 * au droit de chaque potelet : c'est ce que ses oblongs doivent absorber.
 */
export function releverCourses(
  model: StructuralModel,
  fm: FrameAnalysisModel,
  res: Frame2dResult,
  comb: Combination,
  acc: Map<string, CoursePotelet>,
): void {
  for (const po of model.members.filter((m) => m.role === 'potelet' && Math.abs(m.start.x - fm.x) < 1)) {
    const dz = deplacementVerticalAuDroit(fm, res, po.start.y);
    if (dz === null) continue;
    const actuel = acc.get(po.mark);
    if (!actuel || Math.abs(dz) > actuel.mm) acc.set(po.mark, { mm: Math.abs(dz), combinaison: `${comb.id} — ${comb.label}` });
  }
}

export function verifierTetesDePotelets(
  p: ProjectParams,
  model: StructuralModel,
  appuis: readonly AppuiPotelet[],
  courses: ReadonlyMap<string, CoursePotelet> = new Map(),
): AssemblageCheck[] {
  const bolt = p.connections.gusset.bolt;
  const out: AssemblageCheck[] = [];
  for (const a of appuis) {
    const po = model.members.find((m) => m.role === 'potelet' && m.mark === a.mark);
    const g = po ? model.plates.find((pl) => pl.kind === 'gousset-tete' && pl.id.startsWith(po.id)) : undefined;
    if (!po || !g) continue;
    const pr = getProfile(po.profileId);
    if (pr.shape !== 'I') continue;
    const V = a.v * 1000;
    const course = courses.get(a.mark);
    const nB = g.holes.length;
    const ys = g.holes.map((h) => h.at.y).sort((x, y) => x - y);
    const entraxe = nB > 1 ? (ys[nB - 1] as number) - (ys[0] as number) : 0;
    const demiLargeur = Math.max(...g.outline.map((q) => q.y));

    // Âme du potelet : rien ne borde le trou dans le sens du vent avant les
    // semelles ; vers le haut, la pince est la distance à la tête.
    const trous = po.holes.filter((h) => h.from === g.id);
    const haut = Math.max(po.start.z, po.end.z);
    const zTrou = Math.min(...trous.map((h) => po.start.z + h.s));
    const pincesAme = {
      e1: pr.h / 2 - pr.tf - pr.r - Math.max(...trous.map((h) => Math.abs(h.at.z))),
      p1: entraxe,
      e2: haut - zTrou,
    };
    // Gousset : pince à sa rive dans le sens du vent ; en travers — selon
    // l'oblong —, la distance au bord haut ou bas diminuée de la course : le
    // boulon peut se trouver au bout de l'oblong.
    const zs = g.outline.map((q) => q.z);
    const pincesGousset = {
      e1: demiLargeur - Math.max(...g.holes.map((h) => Math.abs(h.at.y))),
      p1: entraxe,
      e2: Math.min(...g.holes.map((h) => Math.min(h.at.z - Math.min(...zs), Math.max(...zs) - h.at.z))) - courseDeTete(p),
    };
    const cordon = model.welds
      .filter((w) => w.between[1] === g.id)
      .reduce((s, w) => s + longueurDeposee(w) * resistanceParMm(w.throat, g.grade), 0);

    const c = assembler({
      id: `tete-${a.mark}`,
      libelle: `Tête de potelet ${a.mark} — gousset ${g.position.includes('faîtage') ? 'sous la platine de faîtage' : 'sous la traverse'}`,
      boulon: `${nB} × ${designationBoulon(bolt)} en oblongs ±${courseDeTete(p)} mm`,
      sollicitations:
        `V = ${a.v.toFixed(1).replace('.', ',')} kN (réaction de tête, vent de pignon)` +
        (course ? ` ; flèche de la traverse au droit du potelet ${course.mm.toFixed(1).replace('.', ',')} mm (${course.combinaison})` : ''),
      combinaison: a.combinaison,
      verifs: [
        verif('cisaillement des boulons', V / nB / 1000, fvRd(bolt) / 1000, 'kN'),
        verif('pression diamétrale sur l’âme du potelet', V / nB / 1000, fbRd(bolt, pr.tw, po.grade, pincesAme) / 1000, 'kN'),
        verif('pression diamétrale sur le gousset (oblong × 0,6)', V / nB / 1000, (0.6 * fbRd(bolt, g.thickness, g.grade, pincesGousset)) / 1000, 'kN'),
        verif('cordon du gousset', V / 1000, cordon / 1000, 'kN'),
        // La traverse ne doit pas venir buter au bout des oblongs : le potelet la
        // porterait, ce que le calcul ne lui demande pas.
        ...(course ? [verif('course des oblongs (flèche ELS de la traverse)', course.mm, courseDeTete(p), 'mm')] : []),
      ],
      nonCouvert: NON_COUVERT,
    });
    out.push(c);
  }
  return out;
}
