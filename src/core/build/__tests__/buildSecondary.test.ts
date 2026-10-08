import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { cutAngleDeg, cutLengths, memberFrame, type Member } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { leftSlopeRad, rafterLength, ridgeY, roofZ } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import { buildProject } from '../buildProject';
import { gablePostStations, purlinSpacing, purlinStations, railLevels, saillieDeLierne } from '../buildSecondary';
import { groupByMark } from '../marks';

/** Projet par défaut, contreventements coupés : on teste l'ossature secondaire. */
const P: ProjectParams = {
  ...DEFAULT_PROJECT,
  bracing: {
    ...DEFAULT_PROJECT.bracing,
    roof: { ...DEFAULT_PROJECT.bracing.roof, enabled: false },
    wall: { ...DEFAULT_PROJECT.bracing.wall, enabled: false },
    gable: { ...DEFAULT_PROJECT.bracing.gable, enabled: false },
  },
};
const G = P.grid;
const M = buildProject(P);

const parRole = (r: Member['role'], ms: readonly Member[] = M.members): Member[] =>
  ms.filter((m) => m.role === r);

describe('pannes', () => {
  it('répartit sur la longueur développée du rampant, pas sur sa projection', () => {
    const dev = rafterLength(G, 'gauche'); // 10 049,88 mm
    // Entraxe demandé 1 800 mm ⇒ 6 intervalles ⇒ entraxe réel 1 674,98 mm
    expect(purlinSpacing(P)).toBeCloseTo(dev / 6, 6);
    expect(purlinSpacing(P)).toBeCloseTo(1674.98, 1);
    expect(M.spacings.purlins).toBeCloseTo(purlinSpacing(P), 9);
    // L'entraxe réel est inférieur au demandé : on resserre, on n'écarte jamais.
    expect(purlinSpacing(P)).toBeLessThan(P.secondary.purlins.spacing);
  });

  it('pose une panne à l’égout, une au faîtage et une en rive de débord', () => {
    const ys = purlinStations(P, 'gauche');
    // 6 intervalles + 1, plus la panne de rive au débord de 300 mm.
    expect(ys).toHaveLength(8);
    expect(ys[0]).toBeCloseTo(-P.secondary.purlins.eaveOverhang, 6);
    expect(ys[1]).toBeCloseTo(0, 6);
    expect(ys[ys.length - 1]).toBeCloseTo(ridgeY(G), 6);
  });

  it('supprime la panne de rive quand il n’y a pas de débord', () => {
    const sansDebord: ProjectParams = {
      ...P,
      secondary: { ...P.secondary, purlins: { ...P.secondary.purlins, eaveOverhang: 0 } },
    };
    const ys = purlinStations(sansDebord, 'gauche');
    expect(ys).toHaveLength(7);
    expect(ys[0]).toBeCloseTo(0, 6);
  });

  it('supprime les pannes d’égout et de faîtage quand on ne les demande pas', () => {
    const sans: ProjectParams = {
      ...P,
      secondary: {
        ...P.secondary,
        purlins: { ...P.secondary.purlins, eavePurlin: false, ridgePurlin: false },
      },
    };
    // Sans panne d'égout il n'y a plus de débord à porter non plus.
    expect(purlinStations(sans, 'gauche')).toHaveLength(5);
  });

  it('ne double pas la panne faîtière', () => {
    const pannes = parRole('panne');
    const auFaitage = pannes.filter((b) => Math.abs(b.start.y - ridgeY(G)) < 300);
    // 5 travées × 1 panne faîtière, et non 2 × 5.
    expect(auFaitage).toHaveLength(5);
  });

  it('débite une panne par travée, à la longueur de la travée', () => {
    const pannes = parRole('panne');
    // 15 pannes en section (8 à gauche + 8 à droite − 1 faîtière partagée) × 5 travées
    expect(pannes).toHaveLength(15 * 5);
    for (const b of pannes) {
      expect(cutLengths(b).axis).toBeCloseTo(G.baySpacing, 6);
      expect(cutAngleDeg(b, 'start')).toBe(0);
      expect(cutAngleDeg(b, 'end')).toBe(0);
    }
  });

  it('pose les pannes SUR la traverse et non dans son axe', () => {
    const panne = parRole('panne').find((b) => Math.abs(b.start.y) < 100);
    if (!panne) throw new Error('panne d’égout absente');
    /*
     * ⚠ Trois épaisseurs s'empilent entre l'axe de la traverse et l'axe de la
     * panne, pas deux : la demi-traverse, L'ÉCHANTIGNOLLE, puis la demi-panne.
     * L'oublier posait la panne à même la semelle supérieure de la traverse, et
     * la cornière d'attache — calée sous la panne — se retrouvait entièrement
     * noyée dans la traverse.
     */
    const recul =
      getProfile(P.frame.rafterProfile).h / 2 +
      getProfile(P.connections.purlinCleat.profile).h +
      getProfile(P.secondary.purlins.profile).h / 2;
    // 180 (demi-IPE 360) + 100 (cornière L 100) + 80 (demi-IPE 160)
    expect(recul).toBeCloseTo(360, 6);

    const a = leftSlopeRad(G);
    // L'axe de la panne est décalé du plan de toiture le long de sa normale.
    expect(panne.start.z).toBeCloseTo(roofZ(G, 0) + Math.cos(a) * recul, 6);
    expect(panne.start.y).toBeCloseTo(-Math.sin(a) * recul, 6);
  });

  it('couche les pannes perpendiculairement au versant', () => {
    const panne = parRole('panne').find((b) => Math.abs(b.start.y) < 100) as Member;
    const f = memberFrame(panne);
    const a = leftSlopeRad(G);
    // Hauteur de section normale au rampant, largeur suivant l'axe du bâtiment.
    expect(f.az.z).toBeCloseTo(Math.cos(a), 6);
    expect(f.az.y).toBeCloseTo(-Math.sin(a), 6);
    expect(Math.abs(f.ax.x)).toBeCloseTo(1, 6);
  });

  it('regroupe toutes les pannes courantes sous un seul repère', () => {
    const groupes = groupByMark(parRole('panne'));
    // Même profil, même longueur, mêmes coupes : une seule pièce à fabriquer.
    expect(groupes.size).toBe(1);
    expect([...groupes.values()][0]).toHaveLength(75);
  });
});

describe('liernes', () => {
  it('en pose une entre chaque paire de pannes voisines, par travée', () => {
    const liernes = parRole('lierne');
    // 7 intervalles entre pannes (8 pannes) × 2 versants × 5 travées × 1 file
    expect(liernes).toHaveLength(7 * 2 * 5);
  });

  it('leur donne la longueur de l’entraxe réel suivant le rampant', () => {
    // On écarte la lierne de rive (débord) et celles du faîtage, dont l'écart
    // n'est pas l'entraxe courant.
    const courantes = parRole('lierne').filter(
      (l) => !l.position.includes('pannes 7 et 8') && !l.position.includes('pannes 1 et 2'),
    );
    expect(courantes.length).toBeGreaterThan(0);
    // L'entraxe, plus la saillie filetée au-delà de chaque âme — de quoi loger
    // écrou et rondelle : 2,5 diamètres de chaque côté.
    const saillie = saillieDeLierne(P.secondary.purlins.sagBars.diameter);
    for (const l of courantes) {
      expect(cutLengths(l).axis, l.position).toBeCloseTo(purlinSpacing(P) + 2 * saillie, 6);
    }
  });

  it('donne la même longueur aux deux liernes de faîtage : la toiture est symétrique', () => {
    // La panne faîtière est décalée suivant la bissectrice des deux versants,
    // donc à l'aplomb du faîtage : les dernières liernes des deux rampants sont
    // forcément égales. Une seule normale de versant casserait cette symétrie.
    const faitage = parRole('lierne').filter((l) => l.position.includes('pannes 7 et 8'));
    expect(faitage.length).toBe(2 * 5); // 2 versants × 5 travées
    const longueurs = [...new Set(faitage.map((l) => Math.round(cutLengths(l).axis * 1000)))];
    expect(longueurs).toHaveLength(1);
  });

  it('les place à mi-travée', () => {
    const l = parRole('lierne')[0] as Member;
    expect(l.start.x).toBeCloseTo(G.baySpacing / 2, 6);
    expect(l.end.x).toBeCloseTo(l.start.x, 6); // la lierne est dans le plan du versant
  });

  it('utilise un rond du diamètre demandé', () => {
    const l = parRole('lierne')[0] as Member;
    const profil = getProfile(l.profileId);
    expect(profil.family).toBe('ROND');
    expect(profil.h).toBe(P.secondary.purlins.sagBars.diameter);
  });

  it('en pose deux files quand on les demande aux tiers', () => {
    const deux: ProjectParams = {
      ...P,
      secondary: {
        ...P.secondary,
        purlins: { ...P.secondary.purlins, sagBars: { enabled: true, rows: 2, diameter: 16 } },
      },
    };
    const liernes = parRole('lierne', buildProject(deux).members);
    expect(liernes).toHaveLength(7 * 2 * 5 * 2);
    const xs = [...new Set(liernes.map((l) => Math.round(l.start.x)))].sort((a, b) => a - b);
    expect(xs.slice(0, 2)).toEqual([2000, 4000]); // aux tiers de la travée de 6 m
  });
});

describe('lisses de bardage', () => {
  it('les répartit du soubassement à l’égout', () => {
    const niveaux = railLevels(P);
    // 5 000 mm utiles (1 000 → 6 000), entraxe 1 500 ⇒ 4 intervalles de 1 250
    expect(niveaux).toEqual([1000, 2250, 3500, 4750]);
    expect(M.spacings.rails).toBeCloseTo(1250, 6);
  });

  it('les débite d’appui à appui : sur les portiques, puis sur les potelets', () => {
    // ⚠ Une lisse porte d'un appui au suivant, jamais au-delà. Sur un long pan
    // les appuis sont les portiques ; sur un pignon ce sont les potelets. Une
    // lisse d'un seul tenant sur toute la portée du pignon ne se monterait pas,
    // et surtout serait calculée avec une portée quatre fois trop grande.
    const lisses = parRole('lisse');
    const longPan = lisses.filter((b) => Math.abs(b.start.x - b.end.x) > 1);
    const pignon = lisses.filter((b) => Math.abs(b.start.x - b.end.x) < 1);
    expect(longPan).toHaveLength(2 * 4 * 5); // 2 façades × 4 niveaux × 5 travées
    // 3 potelets par pignon ⇒ 4 travées de lisse.
    expect(pignon).toHaveLength(2 * 4 * 4);
    for (const b of longPan) expect(cutLengths(b).axis).toBeCloseTo(G.baySpacing, 6);

    const entraxePotelets = G.span / (P.secondary.gablePosts.count + 1);
    for (const b of pignon) expect(cutLengths(b).axis).toBeCloseTo(entraxePotelets, 6);
    // Bout à bout, elles couvrent exactement la portée.
    const parNiveau = pignon.filter((b) => Math.abs(b.start.z - (pignon[0]?.start.z ?? 0)) < 1);
    const total = parNiveau.reduce((s, b) => s + cutLengths(b).axis, 0);
    expect(total).toBeCloseTo(2 * G.span, 6); // les deux pignons de ce niveau
  });

  it('les plaque sur la face extérieure des poteaux', () => {
    const debord = getProfile(P.frame.columnProfile).h / 2 + getProfile(P.secondary.rails.profile).h / 2;
    expect(debord).toBeCloseTo(280, 6); // 200 (demi-IPE 400) + 80 (demi-UPE 160)
    const ys = [...new Set(parRole('lisse').map((b) => Math.round(b.start.y)))];
    expect(ys).toContain(-280);
    expect(ys).toContain(G.span + 280);
  });

  it('oriente l’inertie forte contre le vent', () => {
    const lisse = parRole('lisse').find((b) => Math.abs(b.start.y + 280) < 1) as Member;
    const f = memberFrame(lisse);
    // Vent selon Y ⇒ hauteur de section selon Y.
    expect(Math.abs(f.az.y)).toBeCloseTo(1, 6);
  });

  it('supprime les lisses de pignon si on ne les veut pas', () => {
    const sans: ProjectParams = {
      ...P,
      secondary: { ...P.secondary, rails: { ...P.secondary.rails, onGables: false } },
    };
    const lisses = parRole('lisse', buildProject(sans).members);
    expect(lisses.filter((b) => Math.abs(b.start.x - b.end.x) < 1)).toHaveLength(0);
  });
});

describe('potelets de pignon', () => {
  it('en pose autant qu’on en demande, répartis entre les poteaux', () => {
    // count = 3 ⇒ 3 potelets, donc 4 travées de bardage
    expect(gablePostStations(P)).toEqual([5000, 10000, 15000]);
    expect(parRole('potelet')).toHaveLength(3 * 2); // 3 par pignon × 2 pignons
  });

  it('les arrête sous la traverse avec un jeu, et sous les platines au faîtage', () => {
    /*
     * ⚠ Arrêté AU CONTACT de la traverse, le potelet la portait dès qu'elle
     * fléchissait ; et celui du faîtage traversait de 40 mm les platines de
     * faîtage, qui débordent la traverse vers le bas. Jeu sous l'une comme sous
     * les autres : la course des oblongs de tête, 50 mm, plus 5.
     */
    const potelets = parRole('potelet');
    const a = leftSlopeRad(G);
    for (const po of potelets.filter((x) => Math.abs(x.start.y - 10000) > 1)) {
      const attendu = roofZ(G, po.start.y) - getProfile(P.frame.rafterProfile).h / 2 / Math.cos(a) - 55;
      expect(po.end.z, po.position).toBeCloseTo(attendu, 6);
      expect(po.start.z).toBe(0);
    }
    /*
     * Au faîtage, sous les platines : elles affleurent le dessus des traverses,
     * coupées à 20 mm du faîtage, et débordent de 40 mm sous leur semelle basse.
     *   7000 − (20 × tan α + 360 / 2 / cos α + 40) − 55 = 6722,1
     * plus haut que les rives.
     */
    const sousPlatines = 7000 - (20 * Math.tan(a) + 360 / 2 / Math.cos(a) + 40) - 55;
    expect(sousPlatines).toBeCloseTo(6722.1, 1);
    const auFaitage = potelets.filter((x) => Math.abs(x.start.y - 10000) < 1);
    expect(auFaitage.length).toBeGreaterThan(0);
    for (const po of auFaitage) expect(po.end.z).toBeCloseTo(sousPlatines, 6);
    expect(Math.max(...potelets.map((po) => po.end.z))).toBeCloseTo(sousPlatines, 6);
  });

  it('donne le même repère aux potelets symétriques', () => {
    const groupes = groupByMark(parRole('potelet'));
    // 3 positions distinctes, mais les deux rives sont à la même hauteur.
    expect(groupes.size).toBe(2);
  });

  it('passe en entraxe imposé quand on le demande', () => {
    const parEntraxe: ProjectParams = {
      ...P,
      secondary: {
        ...P.secondary,
        gablePosts: { ...P.secondary.gablePosts, mode: 'entraxe', spacing: 4000 },
      },
    };
    // 20 m / 4 m = 5 intervalles ⇒ 4 potelets
    expect(gablePostStations(parEntraxe)).toHaveLength(4);
  });
});

describe('ossature secondaire — cohérence d’ensemble', () => {
  it('s’adapte à une ferme treillis en prenant appui sur l’arbalétrier', () => {
    const treillis: ProjectParams = {
      ...P,
      frame: { ...P.frame, enabled: false },
      truss: { ...P.truss, enabled: true },
    };
    const m = buildProject(treillis);
    const panne = parRole('panne', m.members).find((b) => Math.abs(b.start.y) < 100) as Member;
    const recul =
      getProfile(treillis.truss.topChordProfile).h / 2 +
      getProfile(P.connections.purlinCleat.profile).h +
      getProfile(P.secondary.purlins.profile).h / 2;
    const a = leftSlopeRad(G);
    expect(panne.start.z).toBeCloseTo(roofZ(G, 0) + Math.cos(a) * recul, 6);
  });

  it('se retire entièrement quand on la désactive', () => {
    const sans: ProjectParams = {
      ...P,
      secondary: {
        purlins: { ...P.secondary.purlins, enabled: false },
        rails: { ...P.secondary.rails, enabled: false },
        gablePosts: { ...P.secondary.gablePosts, enabled: false },
      },
    };
    const m = buildProject(sans);
    for (const r of ['panne', 'lierne', 'lisse', 'potelet'] as const) {
      expect(parRole(r, m.members), r).toHaveLength(0);
    }
  });
});

describe('cornières d’attache', () => {
  it('en pose une par croisement panne / file de portiques', () => {
    // 15 lignes de pannes × 6 files
    expect(parRole('attache')).toHaveLength(15 * 6);
  });

  it('les débite à la longueur demandée, coupées droit', () => {
    const cleat = P.connections.purlinCleat;
    for (const a of parRole('attache')) {
      expect(cutLengths(a).axis, a.position).toBeCloseTo(cleat.length, 6);
      expect(cutAngleDeg(a, 'start')).toBe(0);
      expect(a.profileId).toBe(cleat.profile);
    }
  });

  it('les centre sur les files et les glisse sous la panne', () => {
    const attaches = parRole('attache');
    const xs = [...new Set(attaches.map((a) => Math.round((a.start.x + a.end.x) / 2)))];
    expect(xs.sort((x, y) => x - y)).toEqual([0, 6000, 12000, 18000, 24000, 30000]);

    // La cornière est plus basse que l'axe de la panne qu'elle porte.
    const panne = parRole('panne').find((b) => Math.abs(b.start.y) < 100) as Member;
    const sousLaPanne = attaches.filter((a) => Math.abs(a.start.y - panne.start.y) < 200);
    expect(sousLaPanne.length).toBeGreaterThan(0);
    for (const a of sousLaPanne) expect(a.start.z).toBeLessThan(panne.start.z);
  });

  it('entrent dans la nomenclature et pèsent leur poids', () => {
    expect(M.stats.byRole.attache?.count).toBe(90);
    expect(M.stats.byRole.attache?.massKg).toBeGreaterThan(0);
  });

  it('disparaissent si on ne les demande pas', () => {
    const sans: ProjectParams = {
      ...P,
      connections: {
        ...P.connections,
        purlinCleat: { ...P.connections.purlinCleat, enabled: false },
      },
    };
    expect(parRole('attache', buildProject(sans).members)).toHaveLength(0);
  });
});
