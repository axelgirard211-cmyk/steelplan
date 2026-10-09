import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { memberFrame, sectionPointAt, type Member } from '../../geometry/member';
import { sectionOutline } from '../../geometry/section';
import { add, dot, scale, sub, type Vec3 } from '../../math/vec3';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import { designationDeTrou } from '../../geometry/holes';
import { holeDiameter } from '../../model/connections';
import { epaisseurParoi, listerBoulons } from '../bolts';
import { reserveDeTete } from '../connections/potelets';
import { courseDeTete, jeuSousTraverse } from '../secondaire/facades';
import { buildProject } from '../buildProject';
import type { Plate, StructuralModel } from '../types';
import { elementsAFabriquer } from '../../drawing/sheets/element';
import { colisage, masseALivrer } from '../../bom/colisage';

/**
 * INVARIANTS D'ATELIER — ce qui doit être vrai pour que les plans de
 * fabrication décrivent des pièces qu'on peut assembler.
 *
 * ⚠ Ils ont été écrits APRÈS avoir trouvé, en relisant les plans comme un chef
 * d'atelier, quatre défauts qu'aucun test ne voyait : une platine soudée sur la
 * mauvaise pièce, des échantignolles qui ne touchaient ni la panne ni la
 * traverse, des jarrets sans un cordon et des pourtours comptés deux fois. Les
 * longueurs, les masses et les perçages étaient tous justes — c'est
 * l'ASSEMBLAGE qui était faux, et rien ne le vérifiait.
 */

const CONFIGURATIONS: [string, ProjectParams][] = [
  ['portique par défaut', DEFAULT_PROJECT],
  [
    'ferme treillis',
    {
      ...DEFAULT_PROJECT,
      frame: { ...DEFAULT_PROJECT.frame, enabled: false },
      truss: { ...DEFAULT_PROJECT.truss, enabled: true },
    },
  ],
  [
    'traverse éclissée',
    {
      ...DEFAULT_PROJECT,
      connections: {
        ...DEFAULT_PROJECT.connections,
        splice: { ...DEFAULT_PROJECT.connections.splice, enabled: true },
      },
    },
  ],
  [
    'monopente',
    { ...DEFAULT_PROJECT, grid: { ...DEFAULT_PROJECT.grid, roofType: 'monopente' } },
  ],
  [
    'pannes Z',
    {
      ...DEFAULT_PROJECT,
      secondary: {
        ...DEFAULT_PROJECT.secondary,
        purlins: { ...DEFAULT_PROJECT.secondary.purlins, profile: 'Z 200x2.0' },
      },
    },
  ],
];
const modeles: [string, StructuralModel][] = CONFIGURATIONS.map(([n, p]) => [n, buildProject(p)]);

/** Centre 3D d'un trou de barre, dans le plan de section où il est coté. */
function centreTrouBarre(m: Member, i: number): Vec3 {
  const h = m.holes[i]!;
  return sectionPointAt(memberFrame(m), m.start, h.s, h.at);
}

/** Axe de perçage d'un trou de barre. */
function axeTrouBarre(m: Member, i: number): Vec3 {
  const f = memberFrame(m);
  return m.holes[i]!.through === 'y' ? f.ay : f.az;
}

function centreTrouTole(pl: Plate, i: number): Vec3 {
  const h = pl.holes[i]!;
  return add(pl.origin, add(scale(pl.u, h.at.y), scale(pl.v, h.at.z)));
}

/** Écart latéral de `q` à la droite (p, axe), et distance le long de l'axe. */
function ecarts(p: Vec3, axe: Vec3, q: Vec3): { lateral: number; axial: number } {
  const d = sub(q, p);
  const axial = dot(d, axe);
  const lat = sub(d, scale(axe, axial));
  return { lateral: Math.hypot(lat.x, lat.y, lat.z), axial: Math.abs(axial) };
}

describe('invariant — un boulon serre des pièces EN CONTACT', () => {
  it('aligne les deux trous d’un assemblage barre à barre, sans vide entre les pièces', () => {
    /*
     * ⚠ Le défaut qui a fait écrire ce test : la panne était percée dans sa
     * semelle, l'échantignolle dans son aile couchée — mais 58 mm plus bas. Le
     * boulon traversait le vide, la cornière pénétrait la panne de 23 mm et
     * flottait 17 mm au-dessus de la traverse. Chaque trou, pris seul, était
     * « dans le métal » ; c'est la PAIRE qui était fausse.
     */
    const fautes: string[] = [];
    for (const [nom, M] of modeles) {
      const parId = new Map(M.members.map((m) => [m.id, m]));
      for (const a of M.members) {
        a.holes.forEach((h, i) => {
          const b = parId.get(h.from);
          if (!b || a.id > b.id) return;
          const pa = centreTrouBarre(a, i);
          const axe = axeTrouBarre(a, i);
          // Le trou apparié le plus proche sur l'autre pièce.
          const candidats = b.holes
            .map((hb, j) => ({ hb, j }))
            .filter(({ hb }) => hb.from === a.id)
            .map(({ j }) => ecarts(pa, axe, centreTrouBarre(b, j)));
          const meilleur = candidats.sort((x, y) => x.lateral - y.lateral)[0];
          const serrage =
            epaisseurParoi(getProfile(a.profileId), h) +
            epaisseurParoi(getProfile(b.profileId), h);
          if (!meilleur || meilleur.lateral > 1 || meilleur.axial > serrage + 1) {
            fautes.push(
              `${nom} / ${a.mark}↔${b.mark} : ` +
                (meilleur
                  ? `écart latéral ${meilleur.lateral.toFixed(1)} mm, axial ${meilleur.axial.toFixed(1)} mm pour ${serrage.toFixed(1)} mm de serrage`
                  : 'aucun trou en vis-à-vis'),
            );
          }
        });
      }
    }
    expect([...new Set(fautes)], [...new Set(fautes)].slice(0, 8).join('\n')).toHaveLength(0);
  });

  it('aligne chaque trou de barre sur le trou de la tôle qu’il reçoit', () => {
    const fautes: string[] = [];
    for (const [nom, M] of modeles) {
      const toles = new Map(M.plates.map((pl) => [pl.id, pl]));
      for (const a of M.members) {
        a.holes.forEach((h, i) => {
          const pl = toles.get(h.from);
          if (!pl) return;
          const pa = centreTrouBarre(a, i);
          const axe = axeTrouBarre(a, i);
          const meilleur = pl.holes
            .map((_, j) => ecarts(pa, axe, centreTrouTole(pl, j)))
            .sort((x, y) => x.lateral - y.lateral)[0];
          const serrage = epaisseurParoi(getProfile(a.profileId), h) + pl.thickness;
          if (!meilleur || meilleur.lateral > 1 || meilleur.axial > serrage + 1) {
            fautes.push(`${nom} / ${a.mark}↔${pl.mark}`);
          }
        });
      }
    }
    expect([...new Set(fautes)], [...new Set(fautes)].slice(0, 8).join('\n')).toHaveLength(0);
  });
});

describe('invariant — chaque tôle soudée l’est sur la bonne pièce', () => {
  it('soude la platine d’about de genou sur la TRAVERSE, jamais sur le poteau', () => {
    for (const [nom, M] of modeles) {
      const parId = new Map(M.members.map((m) => [m.id, m]));
      for (const pl of M.plates.filter((x) => x.position.includes('traverse-poteau'))) {
        expect(parId.get(pl.porteur ?? '')?.role, `${nom} / ${pl.position}`).toBe('traverse');
      }
    }
  });

  it('soude toute platine d’about ou de pied, et laisse libres éclisses et goussets', () => {
    for (const [nom, M] of modeles) {
      for (const pl of M.plates) {
        // Le gousset de poutre au vent posé sous l'aile d'un arbalétrier y est boulonné.
        const boulonne = pl.kind === 'gousset-cv' && pl.position.includes('boulonné');
        const libre = pl.kind === 'eclisse' || pl.kind === 'gousset' || boulonne;
        expect(pl.porteur === null, `${nom} / ${pl.position}`).toBe(libre);
      }
    }
  });

  it('pose un cordon et un seul entre chaque tôle et son porteur', () => {
    for (const [nom, M] of modeles) {
      for (const pl of M.plates) {
        const cordons = M.welds.filter((w) => w.between.includes(pl.id));
        if (pl.porteur === null) {
          expect(cordons, `${nom} / ${pl.position} soudée à tort`).toHaveLength(0);
        } else {
          // Le plat d'about d'un tube est soudé sur les deux lèvres de sa fente :
          // deux cordons, chacun entre le tube et le plat.
          const attendus = pl.kind === 'plat-tube' ? 2 : 1;
          // Le cordon est déposé sur le porteur, ou sur une tôle déjà soudée sur
          // lui : le gousset de tête du potelet de faîtage, sous la platine.
          const surLePorteur = (id: string): boolean =>
            id === pl.porteur || M.plates.some((x) => x.id === id && x.porteur === pl.porteur);
          expect(
            cordons.filter((w) => w.between[1] === pl.id && surLePorteur(w.between[0])),
            `${nom} / ${pl.position}`,
          ).toHaveLength(attendus);
        }
      }
    }
  });

  it('compte un pourtour UNE fois : le cordon d’une platine de pied fait le périmètre du profil', () => {
    /*
     * ⚠ Le pourtour d'un profil en I compte déjà les deux faces de l'âme et
     * des semelles. Le déclarer « angle double » sur cette longueur annonçait
     * 2 × 1467 mm sur un IPE 400, soit deux fois le fil, le temps et le coût.
     */
    const M = buildProject(DEFAULT_PROJECT);
    const pl = M.plates.find((x) => x.kind === 'platine-pied')!;
    const w = M.welds.find((x) => x.between.includes(pl.id))!;
    const po = M.members.find((m) => m.id === pl.porteur)!;
    expect(w.type).toBe('angle');
    expect(w.pourtour).toBe(true);
    expect(w.length).toBeCloseTo(getProfile(po.profileId).perimeter, 6);
  });
});

describe('invariant — jarrets et échantignolles font partie de leur traverse', () => {
  it('rattache chaque jarret à une traverse, et l’y soude', () => {
    for (const [nom, M] of modeles) {
      const parId = new Map(M.members.map((m) => [m.id, m]));
      for (const h of M.haunches) {
        expect(parId.get(h.porteur ?? '')?.role, `${nom} / ${h.position}`).toBe('traverse');
        expect(
          M.welds.some((w) => w.between[0] === h.porteur && w.between[1] === h.id),
          `${nom} / ${h.position} sans cordon`,
        ).toBe(true);
      }
    }
  });

  it('soude chaque échantignolle sur la pièce qui la porte, à son contact', () => {
    for (const [nom, M] of modeles) {
      const parId = new Map(M.members.map((m) => [m.id, m]));
      for (const at of M.members.filter((m) => m.role === 'attache')) {
        const porteur = parId.get(at.porteur ?? '');
        expect(porteur?.role, `${nom} / ${at.position}`).toMatch(/traverse|console|membrure-sup|poteau/);
        expect(
          M.welds.some((w) => w.between[0] === at.porteur && w.between[1] === at.id),
          `${nom} / ${at.position} sans cordon`,
        ).toBe(true);
        // Contact : la face basse de la cornière est sur la face qui la porte —
        // le dessus du porteur, ou la coupe de tête pour un poteau.
        const fAt = memberFrame(at);
        const fPo = memberFrame(porteur!);
        const contour = sectionOutline(getProfile(at.profileId)).outer;
        const milieu = scale(add(at.start, at.end), 0.5);
        const face =
          porteur!.role === 'poteau'
            ? porteur!.cutEnd
            : {
                point: add(
                  add(porteur!.start, scale(fPo.ax, dot(sub(milieu, porteur!.start), fPo.ax))),
                  // Le dessus RÉEL de la section : une cornière n'est pas centrée sur son axe.
                  scale(fPo.az, Math.max(...sectionOutline(getProfile(porteur!.profileId)).outer.map((q) => q.z))),
                ),
                normal: fPo.az,
              };
        const hauteurs = contour.map((q) =>
          dot(sub(add(milieu, add(scale(fAt.ay, q.y), scale(fAt.az, q.z))), face.point), face.normal),
        );
        const bas = Math.min(...hauteurs);
        const dessus = 0;
        /*
         * La panne FAÎTIÈRE est d'aplomb, sur la bissectrice des deux versants ;
         * son échantignolle a donc un dessous horizontal posé sur une semelle
         * inclinée de la pente. Le coin qui en résulte — au plus la largeur de
         * la cornière fois le sinus de la pente — est celui qu'on cale au
         * chantier. Partout ailleurs, le contact est exact.
         */
        const devers = 1 - Math.abs(dot(fAt.az, face.normal));
        const tolerance = 1 + getProfile(at.profileId).b * Math.sqrt(Math.max(0, 2 * devers));
        expect(Math.abs(bas - dessus), `${nom} / ${at.position} : jeu de ${(bas - dessus).toFixed(1)} mm`).toBeLessThan(tolerance);
      }
    }
  });

  it('livre l’échantignolle soudée sur sa traverse, et non en pièce isolée', () => {
    const M = buildProject(DEFAULT_PROJECT);
    const elements = elementsAFabriquer(M);
    expect(elements.some((e) => e.membre.role === 'attache')).toBe(false);
    const traverses = elements.filter((e) => e.membre.role === 'traverse');
    expect(traverses.every((e) => e.pieces.length > 0)).toBe(true);
    // Et chaque traverse emporte sa platine de genou.
    expect(traverses.some((e) => e.toles.some((t) => t.position.includes('traverse-poteau')))).toBe(true);
    // Un poteau ne porte que sa platine de pied et les goussets de ses palées.
    const poteaux = elements.filter((e) => e.membre.role === 'poteau');
    expect(poteaux.every((e) => e.toles.every((t) => t.kind === 'platine-pied' || t.kind === 'gousset-cv'))).toBe(true);
  });
});

describe('invariant — repère d’assemblage', () => {
  it('donne le même repère d’assemblage aux seules pièces équipées à l’identique', () => {
    for (const [nom, M] of modeles) {
      const equipement = (m: Member): string =>
        [
          ...M.plates.filter((pl) => pl.porteur === m.id).map((pl) => pl.mark),
          ...M.haunches.filter((h) => h.porteur === m.id).map((h) => h.mark),
          ...M.members.filter((x) => x.porteur === m.id).map((x) => x.mark),
        ]
          .sort()
          .join(',');
      const parAssemblage = new Map<string, Set<string>>();
      for (const m of M.members.filter((x) => x.porteur === null)) {
        const s = parAssemblage.get(m.assemblage) ?? new Set<string>();
        s.add(`${m.mark}|${equipement(m)}`);
        parAssemblage.set(m.assemblage, s);
      }
      for (const [a, variantes] of parAssemblage) {
        expect(variantes.size, `${nom} / ${a} : ${[...variantes].join(' ≠ ')}`).toBe(1);
      }
    }
  });

  it('livre la totalité de l’acier : colisage = masse du modèle, tôles libres comprises', () => {
    for (const [nom, M] of modeles) {
      expect(masseALivrer(colisage(M)), nom).toBeCloseTo(M.stats.massKg, 0);
    }
  });
});

describe('invariant — tête de potelet', () => {
  /*
   * ⚠ La tête des potelets ne tenait à rien. Elle reçoit un gousset soudé sous ce
   * qui la coiffe, boulonné sur l'âme au travers d'oblongs verticaux : le vent
   * passe, la flèche de la traverse aussi.
   */
  const M = buildProject(DEFAULT_PROJECT);
  const potelets = M.members.filter((m) => m.role === 'potelet');
  const tetes = M.plates.filter((pl) => pl.kind === 'gousset-tete');
  const bolt = DEFAULT_PROJECT.connections.gusset.bolt;
  const d0 = holeDiameter(bolt);
  const point = (pl: Plate, q: { y: number; z: number }): Vec3 => add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z)));

  it('donne à chaque potelet un gousset de tête à deux oblongs de ±50 mm', () => {
    expect(potelets).toHaveLength(6);
    expect(tetes).toHaveLength(6);
    for (const g of tetes) {
      expect(g.holes, g.position).toHaveLength(2);
      for (const h of g.holes) {
        expect(h.oblong, g.position).toEqual({ longueur: d0 + 2 * courseDeTete(DEFAULT_PROJECT), sens: 'z' });
        // Oblong vertical : le gousset monte et descend avec la traverse.
        expect(Math.abs(g.v.z), g.position).toBeCloseTo(1, 9);
      }
    }
    expect(designationDeTrou(tetes[0]?.holes[0] as Plate['holes'][number])).toBe('oblong 18 × 118');
  });

  it('le boulonne sur l’âme du potelet, boulon au milieu de sa course', () => {
    const boulons = listerBoulons(M.members, M.plates).filter((b) => b.usage === 'têtes de potelets');
    expect(boulons).toHaveLength(12);
    for (const b of boulons) {
      const pieces = b.pieces.map((id) => M.members.find((m) => m.id === id)?.role ?? M.plates.find((pl) => pl.id === id)?.kind).sort();
      expect(pieces).toEqual(['gousset-tete', 'potelet']);
    }
    for (const g of tetes) {
      const po = potelets.find((m) => m.id === g.porteur || g.id.startsWith(m.id)) as Member;
      for (const h of g.holes) {
        // Le trou rond du potelet tombe au centre de l'oblong du gousset.
        const centre = point(g, h.at);
        const trou = po.holes.find((x) => Math.abs(x.s - (centre.z - po.start.z)) < 0.5);
        expect(trou, g.position).toBeDefined();
      }
    }
  });

  it('arrête le potelet sous sa coiffe, du jeu de la course', () => {
    for (const g of tetes) {
      const po = potelets.find((m) => g.id.startsWith(m.id)) as Member;
      // Mesuré au plan du gousset, à 8 mm de l'axe sous un rampant à 10 % : au
      // millimètre près.
      expect(Math.abs(g.origin.z - po.end.z - jeuSousTraverse(DEFAULT_PROJECT)), g.position).toBeLessThan(1);
      expect(jeuSousTraverse(DEFAULT_PROJECT)).toBeGreaterThan(courseDeTete(DEFAULT_PROJECT));
    }
  });

  it('soude celui du faîtage sous la platine de faîtage, les autres sous la traverse', () => {
    const faitage = tetes.filter((g) => g.position.includes('platine de faîtage'));
    // Un potelet de faîtage par pignon.
    expect(faitage).toHaveLength(2);
    for (const g of faitage) {
      const cordon = M.welds.find((w) => w.between[1] === g.id);
      expect(M.plates.find((pl) => pl.id === cordon?.between[0])?.kind).toBe('platine-about');
    }
    for (const g of tetes.filter((x) => !faitage.includes(x))) {
      const cordon = M.welds.find((w) => w.between[1] === g.id);
      expect(M.members.find((m) => m.id === cordon?.between[0])?.role).toBe('traverse');
    }
  });

  it('se pose à l’opposé du gousset de contreventement, qui reste sous la réserve de tête', () => {
    for (const po of potelets) {
      const f = memberFrame(po);
      const tete = tetes.find((g) => g.id.startsWith(po.id)) as Plate;
      const cote = Math.sign(dot(sub(tete.origin, po.end), f.ay));
      const plafond = po.end.z - reserveDeTete(DEFAULT_PROJECT);
      for (const g of M.plates.filter((pl) => pl.kind === 'gousset-cv' && pl.porteur === po.id && pl.origin.z > po.end.z / 2)) {
        expect(Math.sign(dot(g.v, f.ay)), po.position).toBe(-cote);
        expect(Math.max(...g.outline.map((q) => point(g, q).z)), po.position).toBeLessThan(plafond);
      }
    }
  });
});
