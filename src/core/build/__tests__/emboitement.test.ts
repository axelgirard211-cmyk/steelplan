import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { cutLengths, fibreAbscissa, memberFrame, type Member } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import { sectionOutline, type Pt2 } from '../../geometry/section';
import { add, dot, scale, sub, type Vec3 } from '../../math/vec3';

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
import { buildProject } from '../buildProject';

/**
 * EMBOÎTEMENT DES PIÈCES.
 *
 * ⚠ Ce fichier existe parce que le modèle construisait les barres sur leurs
 * LIGNES D'ÉPURE et les poussait jusqu'aux points de travail théoriques, sans les
 * ébouter à la face de la pièce qu'elles rejoignent. Six familles d'aciers
 * occupaient ainsi le même volume : la cornière d'attache entièrement noyée dans
 * la traverse, le poteau montant jusqu'au milieu de celle-ci, les deux brins
 * d'une croix se traversant en leur centre.
 *
 * Rien ne le signalait. Les longueurs de débit, les perçages, les masses et les
 * vérifications restaient justes — seule la vue 3D montrait deux pièces au même
 * endroit, et encore fallait-il regarder le bon nœud.
 */

const ECHANTILLONS = 8;

interface Enveloppe {
  readonly m: Member;
  readonly centre: Vec3;
  readonly rayon: number;
  /**
   * Abscisses de DÉBUT et de FIN du métal, le long de l'axe.
   *
   * ⚠ Ce ne sont pas 0 et la longueur. Une barre éboutée s'arrête avant son
   * about : ses points de travail restent en place — le modèle de calcul y
   * construit ses nœuds — mais le métal, lui, recule. Échantillonner depuis
   * l'about ferait donc croire à une interpénétration là où il n'y a rien.
   */
  readonly s0: number;
  readonly s1: number;
}

function enveloppe(m: Member): Enveloppe {
  const profil = getProfile(m.profileId);
  const f = memberFrame(m);
  const centreDeSection = { y: 0, z: 0 };
  const s0 = fibreAbscissa(f, m.start, m.cutStart, centreDeSection);
  const s1 = fibreAbscissa(f, m.start, m.cutEnd, centreDeSection);
  return {
    m,
    centre: {
      x: (m.start.x + m.end.x) / 2,
      y: (m.start.y + m.end.y) / 2,
      z: (m.start.z + m.end.z) / 2,
    },
    rayon: cutLengths(m).axis / 2 + Math.hypot(profil.b, profil.h),
    s0,
    s1,
  };
}

/**
 * Le point est-il DANS le solide de la barre, marge de tolérance déduite ?
 *
 * ⚠ Contre le CONTOUR RÉEL de la section, pas son rectangle englobant. Un I
 * n'est pas un rectangle : entre ses semelles, de part et d'autre de l'âme, il y
 * a du vide — et c'est là que se logent, à juste titre, une équerre de lisse
 * ou une platine. Le rectangle les déclarait « enfoncées dans le poteau ».
 */
function dansLeMetal(e: Enveloppe, p: Vec3, marge = 2): boolean {
  const f = memberFrame(e.m);
  const d = { x: p.x - e.m.start.x, y: p.y - e.m.start.y, z: p.z - e.m.start.z };
  const s = d.x * f.ax.x + d.y * f.ax.y + d.z * f.ax.z;
  if (s <= e.s0 + marge || s >= e.s1 - marge) return false;
  const q = { y: d.x * f.ay.x + d.y * f.ay.y + d.z * f.ay.z, z: d.x * f.az.x + d.y * f.az.y + d.z * f.az.z };
  const c = sectionOutline(getProfile(e.m.profileId), 8);
  if (!dansPolygone(q, c.outer) || c.holes.some((t) => dansPolygone(q, t))) return false;
  // La marge : assez loin de toute arête pour que ce ne soit pas un simple contact.
  const contours = [c.outer, ...c.holes];
  return contours.every((poly) => poly.every((a, i) => distanceSegment(q, a, poly[(i + 1) % poly.length] as Pt2) >= marge));
}

function dansPolygone(q: Pt2, poly: readonly Pt2[]): boolean {
  let dedans = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt2;
    const b = poly[j] as Pt2;
    if (a.z > q.z !== b.z > q.z && q.y < ((b.y - a.y) * (q.z - a.z)) / (b.z - a.z) + a.y) dedans = !dedans;
  }
  return dedans;
}

function distanceSegment(q: Pt2, a: Pt2, b: Pt2): number {
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const l2 = dy * dy + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q.y - a.y) * dy + (q.z - a.z) * dz) / l2));
  return Math.hypot(q.y - (a.y + t * dy), q.z - (a.z + t * dz));
}

/**
 * Couples de rôles dont l'axe de l'un traverse le métal de l'autre.
 *
 * On échantillonne l'AXE des barres : c'est le contrôle le plus sévère qui reste
 * rapide, et il suffit — une pièce dont l'axe est dans une autre y est forcément
 * enfoncée de la moitié de sa section. Les paires trop éloignées pour se toucher
 * sont écartées sur leurs sphères englobantes, sans quoi le contrôle serait
 * quadratique sur sept cents barres et prendrait une minute.
 */
function interpenetrations(membres: readonly Member[]): Map<string, number> {
  const env = membres.map(enveloppe);
  const out = new Map<string, number>();

  for (const a of env) {
    const f = memberFrame(a.m);
    const voisins = env.filter(
      (b) =>
        b.m.id !== a.m.id &&
        Math.hypot(b.centre.x - a.centre.x, b.centre.y - a.centre.y, b.centre.z - a.centre.z) <
          a.rayon + b.rayon,
    );
    if (voisins.length === 0) continue;

    for (let i = 0; i <= ECHANTILLONS; i++) {
      const s = a.s0 + ((a.s1 - a.s0) * i) / ECHANTILLONS;
      const p = {
        x: a.m.start.x + f.ax.x * s,
        y: a.m.start.y + f.ax.y * s,
        z: a.m.start.z + f.ax.z * s,
      };
      for (const b of voisins) {
        if (!dansLeMetal(b, p)) continue;
        const cle = [a.m.role, b.m.role].sort().join(' ∩ ');
        out.set(cle, (out.get(cle) ?? 0) + 1);
      }
    }
  }
  return out;
}

/**
 * La lierne TRAVERSE la panne, et c'est correct : un tirant de lierne passe par
 * un trou percé dans l'âme de la panne, puis se boulonne de l'autre côté. C'est
 * la seule traversée légitime du modèle, et elle est nommée ici pour que toutes
 * les autres restent des défauts.
 */
const TRAVERSEES_LEGITIMES = new Set(['lierne ∩ panne']);

const defauts = (membres: readonly Member[]): [string, number][] =>
  [...interpenetrations(membres).entries()].filter(([cle]) => !TRAVERSEES_LEGITIMES.has(cle));

describe('projet par défaut', () => {
  const membres = buildProject(DEFAULT_PROJECT).members;

  it('ne laisse AUCUNE pièce enfoncée dans une autre', () => {
    expect(
      defauts(membres).map(([cle, n]) => `${cle} : ${n} points`),
      'des aciers occupent le même volume',
    ).toEqual([]);
  });

  it('arase la tête de poteau dans le plan du dessus de traverse', () => {
    /*
     * La traverse s'arrête contre le poteau ; le poteau, lui, monte jusqu'au
     * plan de la couverture — ni au-dessous, où la traverse le dominerait sans
     * appui, ni au-dessus, où il heurterait l'échantignolle de la sablière.
     */
    for (const poteau of membres.filter((m) => m.role === 'poteau')) {
      const traverse = membres.find(
        (m) => m.role === 'traverse' && (dist(m.start, poteau.end) < 1 || dist(m.end, poteau.end) < 1),
      ) as Member;
      const f = memberFrame(traverse);
      const dessus = add(poteau.end, scale(f.az, getProfile(traverse.profileId).h / 2));
      const plan = poteau.cutEnd;
      expect(Math.abs(dot(plan.normal, f.az)), poteau.position).toBeCloseTo(1, 6);
      expect(dot(sub(dessus, plan.point), plan.normal), poteau.position).toBeCloseTo(0, 6);
    }
  });

  it('laisse la place de l’échantignolle entre la traverse et la panne', () => {
    const traverse = membres.find((m) => m.role === 'traverse') as Member;
    const attache = membres.find((m) => m.role === 'attache') as Member;
    const hCorniere = getProfile(attache.profileId).h;
    const f = memberFrame(traverse);
    const d = {
      x: attache.start.x - traverse.start.x,
      y: attache.start.y - traverse.start.y,
      z: attache.start.z - traverse.start.z,
    };
    const v = d.x * f.az.x + d.y * f.az.y + d.z * f.az.z;
    const dessusTraverse = getProfile(traverse.profileId).h / 2;
    expect(v).toBeGreaterThan(dessusTraverse);
    expect(v).toBeLessThan(dessusTraverse + hCorniere);
  });

  it('écarte les deux brins d’une croix, qui ne peuvent pas être coplanaires', () => {
    // Deux barres qui se croisent dans le même plan sont impossibles à monter.
    const palee = membres.filter((m) =>
      m.position.includes('palée de stabilité — travée 1, long pan gauche'),
    );
    expect(palee).toHaveLength(2);
    const [d1, d2] = palee as [Member, Member];
    expect(Math.abs(d1.start.y - d2.start.y)).toBeGreaterThan(0);
  });
});

describe('autres configurations', () => {
  /*
   * ⚠ Seuil, et non zéro. Il reste des recouvrements marginaux là où deux
   * ouvrages se croisent sans que l'un « aboutisse » sur l'autre : la poutre au
   * vent traverse le plan d'une ferme, et une diagonale change d'angle au
   * faîtage. Les traiter demanderait de découper les barres les unes sur les
   * autres, ce que le modèle ne fait pas. Le seuil est là pour que ces cas
   * connus n'empêchent pas de détecter un retour des vrais défauts, qui se
   * comptaient eux par centaines de points.
   */
  const SEUIL = 20;

  it('reste sous le seuil sur chaque gabarit', () => {
    for (const t of TEMPLATES) {
      for (const [cle, n] of defauts(buildProject(t.build()).members)) {
        expect(n, `${t.id} — ${cle}`).toBeLessThanOrEqual(SEUIL);
      }
    }
  });

  it('reste sous le seuil en monopente et sur versants dissymétriques', () => {
    const cas = [
      {
        nom: 'monopente',
        p: { ...DEFAULT_PROJECT, grid: { ...DEFAULT_PROJECT.grid, roofType: 'monopente' as const } },
      },
      {
        nom: 'dissymétrique',
        p: {
          ...DEFAULT_PROJECT,
          grid: { ...DEFAULT_PROJECT.grid, asymmetric: true, slope: 5, slopeRight: 25 },
        },
      },
    ];
    for (const { nom, p } of cas) {
      for (const [cle, n] of defauts(buildProject(p).members)) {
        expect(n, `${nom} — ${cle}`).toBeLessThanOrEqual(SEUIL);
      }
    }
  });
});
