import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { boltGrid, holeSignature, pitchFor } from '../../geometry/holes';
import type { Member } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { holeDiameter, minEdgeDistance, minPitch } from '../../model/connections';
import type { ProjectParams } from '../../model/project';
import { buildProject, plateMassKg } from '../buildProject';
import type { Plate } from '../types';

/** Portique seul : les assemblages du portique sans le bruit du reste. */
const P: ProjectParams = {
  ...DEFAULT_PROJECT,
  secondary: {
    purlins: { ...DEFAULT_PROJECT.secondary.purlins, enabled: false },
    rails: { ...DEFAULT_PROJECT.secondary.rails, enabled: false },
    gablePosts: { ...DEFAULT_PROJECT.secondary.gablePosts, enabled: false },
  },
  bracing: {
    ...DEFAULT_PROJECT.bracing,
    roof: { ...DEFAULT_PROJECT.bracing.roof, enabled: false },
    wall: { ...DEFAULT_PROJECT.bracing.wall, enabled: false },
    gable: { ...DEFAULT_PROJECT.bracing.gable, enabled: false },
  },
};
const M = buildProject(P);
const tolesDe = (k: Plate['kind'], m = M): Plate[] => m.plates.filter((pl) => pl.kind === k);

describe('grille de boulons', () => {
  it('centre la grille et respecte entraxes et files', () => {
    const g = boltGrid(4, 2, 100, 120);
    expect(g).toHaveLength(8);
    // Symétrique en y comme en z : la somme des coordonnées est nulle.
    expect(g.reduce((s, q) => s + q.y, 0)).toBeCloseTo(0, 9);
    expect(g.reduce((s, q) => s + q.z, 0)).toBeCloseTo(0, 9);
    const zs = [...new Set(g.map((q) => q.z))].sort((a, b) => a - b);
    expect(zs).toEqual([-150, -50, 50, 150]); // 4 rangées à 100 mm
    expect([...new Set(g.map((q) => q.y))].sort((a, b) => a - b)).toEqual([-60, 60]);
  });

  it('répartit les rangées entre les deux pinces', () => {
    // 700 mm de hauteur utile, 6 rangées, pince 45 ⇒ entraxe (700 − 90)/5 = 122
    expect(pitchFor(700, 6, 45)).toBeCloseTo(122, 6);
    expect(pitchFor(700, 1, 45)).toBe(0);
  });
});

describe('pieds de poteaux', () => {
  const platines = tolesDe('platine-pied');

  it('en pose une sous chaque poteau', () => {
    expect(platines).toHaveLength(12);
  });

  it('la place sous l’about, à demi-épaisseur', () => {
    const poteau = M.members.find((m) => m.role === 'poteau') as Member;
    const pl = platines.find((x) => x.position.includes(poteau.position)) as Plate;
    expect(pl.origin.z).toBeCloseTo(poteau.start.z - P.connections.columnBase.thickness / 2, 6);
    expect(pl.origin.x).toBeCloseTo(poteau.start.x, 6);
    expect(pl.origin.y).toBeCloseTo(poteau.start.y, 6);
  });

  it('lui donne les dimensions demandées', () => {
    const pl = platines[0] as Plate;
    const ys = pl.outline.map((q) => q.y);
    const zs = pl.outline.map((q) => q.z);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(P.connections.columnBase.width, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(P.connections.columnBase.length, 6);
    expect(pl.thickness).toBe(P.connections.columnBase.thickness);
  });

  it('perce autant de trous que de tiges d’ancrage, dans l’emprise de la tôle', () => {
    const pl = platines[0] as Plate;
    expect(pl.holes).toHaveLength(P.connections.columnBase.anchorCount);
    const demiB = P.connections.columnBase.width / 2;
    const demiL = P.connections.columnBase.length / 2;
    for (const h of pl.holes) {
      expect(Math.abs(h.at.y) + h.d / 2, 'trou hors de la tôle').toBeLessThan(demiB);
      expect(Math.abs(h.at.z) + h.d / 2, 'trou hors de la tôle').toBeLessThan(demiL);
    }
  });

  it('donne un jeu généreux aux trous d’ancrage', () => {
    const pl = platines[0] as Plate;
    const nominal = holeDiameter({ d: 24, cls: '8.8' });
    // Les tiges d'ancrage se rattrapent au montage : le trou est plus large que
    // le jeu normal d'un boulon de charpente.
    for (const h of pl.holes) expect(h.d).toBeGreaterThan(nominal);
  });

  it('ne perce pas le poteau : la platine est soudée', () => {
    const poteaux = M.members.filter((m) => m.role === 'poteau');
    for (const po of poteaux) {
      const enPied = po.holes.filter((h) => h.s < 100);
      expect(enPied, po.position).toHaveLength(0);
    }
  });
});

describe('genou traverse-poteau', () => {
  const platines = tolesDe('platine-about').filter((pl) => pl.position.includes('traverse-poteau'));
  const ep = P.connections.rafterToColumn;

  it('pose une platine d’about par genou', () => {
    expect(platines).toHaveLength(12);
  });

  it('perce le poteau, pas la traverse', () => {
    const poteau = M.members.find((m) => m.role === 'poteau') as Member;
    const traverse = M.members.find((m) => m.role === 'traverse') as Member;
    expect(poteau.holes.length).toBe(ep.rows * ep.cols);
    expect(traverse.holes).toHaveLength(0);
  });

  it('perce la semelle intérieure du poteau', () => {
    const gauche = M.members.find((m) => m.role === 'poteau' && m.start.y === 0) as Member;
    const droit = M.members.find((m) => m.role === 'poteau' && m.start.y > 0) as Member;
    const h = getProfile(gauche.profileId).h;
    // Poteau de gauche : semelle tournée vers l'intérieur, donc côté +z local.
    for (const t of gauche.holes) expect(t.at.z).toBeCloseTo(h / 2, 6);
    // Poteau de droite : l'intérieur est de l'autre côté.
    for (const t of droit.holes) expect(t.at.z).toBeCloseTo(-h / 2, 6);
    for (const t of [...gauche.holes, ...droit.holes]) expect(t.through).toBe('z');
  });

  it('répartit les rangées sur la hauteur du jarret, sous la tête du poteau', () => {
    const poteau = M.members.find((m) => m.role === 'poteau') as Member;
    const ss = [...new Set(poteau.holes.map((t) => Math.round(t.s)))].sort((a, b) => a - b);
    expect(ss).toHaveLength(ep.rows);
    /*
     * La bande boulonnée va du DESSUS de la traverse, au nu de la platine, au
     * DESSOUS du jarret — mesurés d'aplomb. Recalcul à la main, pente de 10 % :
     *   racine du jarret : 6000 + 220 × 0,1           = 6022,0
     *   dessus           : 6022 + 180 / 0,99504       = 6202,9
     *   dessous          : 6022 − 180,9 − (700 − 360) = 5501,1
     *   centre de la grille : 5852,0, sur 701,8 mm de bande utile.
     * ⚠ Ce n'est plus « sous la tête du poteau » : la grille était calée sous
     * une tête coupée sous la traverse, et la moitié des rangées tombait sous
     * le jarret, face à rien.
     */
    const centre = (Math.min(...ss) + Math.max(...ss)) / 2;
    expect(centre).toBeCloseTo(5852.0, 0);
    const bande = 6202.9 - 5501.1;
    // Étendue = (rows − 1) × entraxe, avec l'entraxe déduit de la bande utile.
    const attendu = (ep.rows - 1) * pitchFor(bande, ep.rows, ep.edgeDistance);
    expect(Math.max(...ss) - Math.min(...ss)).toBeCloseTo(attendu, 0);
  });

  it('respecte les entraxes minimaux de l’EN 1993-1-8', () => {
    const pitch = pitchFor(P.frame.haunch.depth, ep.rows, ep.edgeDistance);
    expect(pitch).toBeGreaterThan(minPitch(ep.bolt));
    expect(ep.edgeDistance).toBeGreaterThan(minEdgeDistance(ep.bolt));
    expect(ep.gauge).toBeGreaterThan(0);
  });

  it('donne à la platine et au poteau des trous rigoureusement concordants', () => {
    // C'est LA propriété qui ne doit jamais tomber : la tôle et la pièce qu'elle
    // vient boulonner sortent du même calcul.
    const poteau = M.members.find((m) => m.role === 'poteau') as Member;
    const pl = platines[0] as Plate;
    expect(pl.holes).toHaveLength(poteau.holes.length);

    const diametres = new Set(pl.holes.map((h) => h.d));
    expect(diametres).toEqual(new Set(poteau.holes.map((h) => h.d)));
    expect([...diametres][0]).toBe(holeDiameter(ep.bolt));

    // Même grille : les positions transversales et les entraxes coïncident.
    const yTole = [...new Set(pl.holes.map((h) => Math.round(h.at.y)))].sort((a, b) => a - b);
    const yBarre = [...new Set(poteau.holes.map((h) => Math.round(h.at.y)))].sort((a, b) => a - b);
    expect(yTole).toEqual(yBarre);

    const zTole = [...new Set(pl.holes.map((h) => Math.round(h.at.z)))].sort((a, b) => a - b);
    const sBarre = [...new Set(poteau.holes.map((h) => Math.round(h.s)))].sort((a, b) => a - b);
    const ecarts = (l: number[]) => l.slice(1).map((v, i) => v - (l[i] as number));
    expect(ecarts(zTole)).toEqual(ecarts(sBarre));
  });

  it('déborde la platine au-delà de la semelle du poteau', () => {
    const pl = platines[0] as Plate;
    const largeur = Math.max(...pl.outline.map((q) => q.y)) * 2;
    expect(largeur).toBeCloseTo(getProfile(P.frame.columnProfile).b + 2 * ep.overhang, 6);
  });
});

describe('faîtage', () => {
  const platines = tolesDe('platine-about').filter((pl) => pl.position.includes('faîtage'));

  it('pose une platine par traverse arrivant au faîtage', () => {
    expect(platines).toHaveLength(12); // 2 traverses × 6 files
  });

  it('les place au sommet, dos à dos', () => {
    const paire = platines.filter((pl) => Math.abs(pl.origin.x) < 1);
    expect(paire).toHaveLength(2);
    const [a, b] = paire as [Plate, Plate];
    // La coupe de faîtage est verticale : les deux platines le sont aussi, et se
    // touchent exactement, séparées de leurs deux demi-épaisseurs selon Y.
    expect(Math.abs(a.origin.y - b.origin.y)).toBeCloseTo(P.connections.ridge.thickness, 6);
    expect(a.origin.z).toBeCloseTo(b.origin.z, 6);
    for (const pl of [a, b]) {
      expect(Math.abs(pl.u.x)).toBeCloseTo(1, 6); // largeur suivant l'axe du bâtiment
      expect(Math.abs(pl.v.z)).toBeCloseTo(1, 6); // hauteur verticale
    }
  });

  it('ne perce aucune traverse', () => {
    for (const tr of M.members.filter((m) => m.role === 'traverse')) {
      expect(tr.holes, tr.position).toHaveLength(0);
    }
  });
});

describe('goussets de treillis', () => {
  const treillis: ProjectParams = {
    ...P,
    frame: { ...P.frame, enabled: false },
    truss: { ...P.truss, enabled: true, doubleAngles: false },
  };
  const T = buildProject(treillis);

  it('pose un gousset à chaque nœud où aboutit une barre de treillis', () => {
    /*
     * ⚠ Le nombre attendu se DÉDUIT du modèle et n'est pas figé : il dépend de la
     * topologie et du nombre de panneaux, tous deux réglables. Une constante en
     * dur ici ne testait plus la règle, seulement le réglage par défaut du jour —
     * et cassait dès qu'on y touchait.
     */
    const goussets = tolesDe('gousset', T);
    expect(goussets.length).toBeGreaterThan(0);

    const cle = (v: { y: number; z: number }): string =>
      `${Math.round(v.y)}|${Math.round(v.z)}`;
    const noeudsDeTreillis = new Set(
      T.members
        .filter((m) => m.role === 'diagonale' || m.role === 'montant')
        // Près du plan de la ferme : les cornières sont plaquées de part et d'autre du gousset.
        .filter((m) => Math.abs(m.start.x) < 200)
        .flatMap((m) => [cle(m.start), cle(m.end)]),
    );

    const parFerme = goussets.filter((pl) => Math.abs(pl.origin.x) < 1);
    expect(parFerme.length).toBe(noeudsDeTreillis.size);
    // Un jeu identique sur chacune des 6 files du bâtiment par défaut.
    expect(goussets).toHaveLength(parFerme.length * 6);
  });

  it('les place dans le plan de la ferme', () => {
    for (const pl of tolesDe('gousset', T)) {
      expect(pl.u.x).toBeCloseTo(0, 9);
      expect(pl.v.x).toBeCloseTo(0, 9);
    }
  });

  it('perce chaque barre de treillis à ses deux abouts', () => {
    const diagonales = T.members.filter((m) => m.role === 'diagonale');
    expect(diagonales.length).toBeGreaterThan(0);
    for (const d of diagonales) {
      expect(d.holes, d.position).toHaveLength(4); // 2 boulons par about
      const l = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y, d.end.z - d.start.z);
      for (const h of d.holes) {
        expect(h.s).toBeGreaterThan(0);
        expect(h.s).toBeLessThan(l);
        expect(h.through).toBe('y'); // traverse l'aile plaquée sur le gousset
      }
    }
  });

  it('respecte la pince minimale sur les barres de treillis', () => {
    const gu = P.connections.gusset;
    const pinceMini = Math.max(gu.edgeMargin, minEdgeDistance(gu.bolt));
    for (const d of T.members.filter((m) => m.role === 'diagonale')) {
      const l = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y, d.end.z - d.start.z);
      for (const h of d.holes) {
        expect(Math.min(h.s, l - h.s), d.position).toBeGreaterThanOrEqual(pinceMini - 1e-6);
      }
    }
  });
});

describe('attaches de pannes', () => {
  const avecPannes: ProjectParams = {
    ...P,
    secondary: { ...P.secondary, purlins: { ...P.secondary.purlins, enabled: true } },
  };
  const A = buildProject(avecPannes);

  it('perce chaque panne à ses deux abouts, dans la semelle inférieure', () => {
    const pannes = A.members.filter((m) => m.role === 'panne');
    expect(pannes.length).toBe(75);
    const h = getProfile(P.secondary.purlins.profile).h;
    // Les trous d'échantignole ; les passages de liernes, dans l'âme, à part.
    const attaches = new Set(A.members.filter((m) => m.role === 'attache').map((m) => m.id));
    for (const pa of pannes) {
      const trous = pa.holes.filter((t) => attaches.has(t.from));
      expect(trous, pa.position).toHaveLength(4);
      for (const t of trous) {
        expect(t.at.z).toBeCloseTo(-h / 2, 6);
        expect(t.through).toBe('z');
        expect(t.part).toBe('semelle-inf');
      }
    }
  });

  it('recule les trous d’une pince : on ne perce jamais à l’about même', () => {
    const panne = A.members.find((m) => m.role === 'panne') as Member;
    const l = P.grid.baySpacing;
    const bolt = P.connections.secondaryBolt;
    // Pince = 2 × diamètre de perçage, jamais moins que le minimum normatif.
    const pince = Math.max(2 * holeDiameter(bolt), minEdgeDistance(bolt));
    const ss = [...new Set(panne.holes.filter((t) => t.part === 'semelle-inf').map((t) => Math.round(t.s)))].sort((a, b) => a - b);
    expect(ss).toEqual([Math.round(pince), Math.round(l - pince)]);
    expect(pince).toBe(26);
  });

  it('apparie chaque trou de panne à la cornière d’attache qui le reprend', () => {
    const panne = A.members.find((m) => m.role === 'panne') as Member;
    const attaches = A.members.filter((m) => m.role === 'attache');
    for (const h of panne.holes.filter((t) => t.part === 'semelle-inf')) {
      const cleat = attaches.find((c) => c.id === h.from);
      expect(cleat, `provenance ${h.from} introuvable`).toBeDefined();
      // La cornière porte le trou correspondant, au même diamètre.
      expect((cleat as Member).holes.some((x) => x.d === h.d)).toBe(true);
    }
  });
});

describe('repérage et masses des assemblages', () => {
  it('regroupe les tôles identiques et sépare les perçages différents', () => {
    const marques = new Set(M.plates.map((pl) => pl.mark));
    // Trois tôles distinctes seulement : pied, genou, faîtage.
    expect(marques).toEqual(new Set(['PP1', 'PL1', 'PL2']));
  });

  it('donne le même repère aux poteaux gauche et droit', () => {
    // Ils sont percés sur des semelles opposées, mais un demi-tour autour de
    // l'axe les rend identiques : c'est bien une seule pièce à fabriquer.
    const gauche = M.members.find((m) => m.role === 'poteau' && m.start.y === 0) as Member;
    const droit = M.members.find((m) => m.role === 'poteau' && m.start.y > 0) as Member;
    expect(droit.mark).toBe(gauche.mark);
  });

  it('sépare deux pièces dont le perçage diffère vraiment', () => {
    const a = holeSignature(
      [{ s: 100, at: { y: 0, z: 200 }, d: 22, through: 'z', part: 'ame', from: 't' }],
      { demiTourAutourDeLAxe: true },
    );
    const b = holeSignature(
      [{ s: 150, at: { y: 0, z: 200 }, d: 22, through: 'z', part: 'ame', from: 't' }],
      { demiTourAutourDeLAxe: true },
    );
    expect(a).not.toBe(b);
  });

  it('calcule la masse d’une tôle en déduisant ses trous', () => {
    const pl = tolesDe('platine-pied')[0] as Plate;
    const cb = P.connections.columnBase;
    const plein = (cb.width * cb.length * cb.thickness * 7850) / 1e9;
    expect(plateMassKg(pl)).toBeLessThan(plein);
    expect(plateMassKg(pl)).toBeGreaterThan(plein * 0.9);
    // 350 × 550 × 25 mm d'acier ≈ 37,8 kg avant perçage
    expect(plein).toBeCloseTo(37.8, 1);
  });

  it('compte la boulonnerie du projet sans doubler le faîtage', () => {
    expect(M.stats.plateCount).toBe(36); // 12 pieds + 12 genoux + 12 faîtages
    // 12 × 4 tiges + 12 × 12 boulons de genou + 6 × 8 boulons de faîtage.
    // ⚠ Six jeux de faîtage et non douze : les DEUX platines d'un faîtage
    // portent chacune la totalité des trous, pour un seul jeu de boulons.
    expect(M.stats.boltCount).toBe(12 * 4 + 12 * 12 + 6 * 8);
    expect(M.stats.boltCount).toBe(240);
  });

  it('apparie explicitement les deux platines d’un même faîtage', () => {
    const faitages = M.plates.filter((pl) => pl.position.includes('faîtage'));
    expect(faitages).toHaveLength(12);
    for (const pl of faitages) {
      expect(pl.pairedWith, pl.position).not.toBeNull();
      const jumelle = M.plates.find((x) => x.id === pl.pairedWith);
      expect(jumelle, `jumelle de ${pl.id} introuvable`).toBeDefined();
      // L'appariement est réciproque, et les deux tôles se font face.
      expect(jumelle?.pairedWith).toBe(pl.id);
      expect(Math.abs((jumelle?.origin.y ?? 0) - pl.origin.y)).toBeCloseTo(
        P.connections.ridge.thickness,
        6,
      );
    }
    // Les platines de pied et de genou, elles, n'ont pas de jumelle.
    for (const pl of M.plates.filter((x) => !x.position.includes('faîtage'))) {
      expect(pl.pairedWith, pl.position).toBeNull();
    }
  });

  it('inclut la masse des tôles dans le total', () => {
    const sansTole = M.members.reduce(
      (s, m) => s + (getProfile(m.profileId).G * Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z)) / 1000,
      0,
    );
    expect(M.stats.massKg).toBeGreaterThan(sansTole);
  });
});
