import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { cutAngleDeg, cutLengths, memberFrame, type Member } from '../../geometry/member';
import { rad2deg } from '../../math/tolerance';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { buildingLength, leftSlopeRad, ridgeHeight } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import { buildProject } from '../buildProject';
import { groupByMark } from '../marks';

/**
 * 20 m × 5 travées de 6 m, égout 6 m, bipente 10 %, ossature secondaire et
 * contreventements COUPÉS : ce fichier teste l'ossature principale seule, pour
 * que ses comptages restent lisibles. L'ossature secondaire et les
 * contreventements ont leur propre fichier de tests.
 */
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

const parRole = (ms: readonly Member[], r: Member['role']): Member[] =>
  ms.filter((m) => m.role === r);

/*
 * GENOU — détail retenu : le poteau MONTE jusqu'au plan du dessus de
 * traverse ; la traverse s'arrête sur sa platine d'about, plaquée sur la
 * semelle intérieure du poteau. Recalcul à la main, IPE 400 / IPE 360, pente
 * de 10 % (cos α = 0,99504), platine de 20 mm :
 *   poteau   : 6000 + 180 / 0,99504          = 6180,9 mm à l'axe
 *   traverse : (10 000 − 200 − 20) / 0,99504 = 9828,8 mm à l'axe
 */
const COS = Math.cos(leftSlopeRad(P.grid));
const PLATINE = P.connections.rafterToColumn.thickness;
const HPOTEAU = P.grid.eaveHeight + getProfile(P.frame.rafterProfile).h / 2 / COS;
const LTRAVERSE = (10000 - getProfile(P.frame.columnProfile).h / 2 - PLATINE) / COS;

describe('génération du portique', () => {
  it('produit un portique complet par file', () => {
    const m = buildProject(P);
    // 6 files × (2 poteaux + 2 traverses)
    expect(m.members).toHaveLength(24);
    expect(parRole(m.members, 'poteau')).toHaveLength(12);
    expect(parRole(m.members, 'traverse')).toHaveLength(12);
    expect(m.haunches).toHaveLength(12); // 2 jarrets par file
  });

  it('place les poteaux sur la trame, d’axe à axe', () => {
    const poteaux = parRole(buildProject(P).members, 'poteau');
    const x = [...new Set(poteaux.map((p) => p.start.x))].sort((a, b) => a - b);
    expect(x).toEqual([0, 6000, 12000, 18000, 24000, 30000]);
    expect(Math.max(...x)).toBe(buildingLength(P.grid));

    const y = [...new Set(poteaux.map((p) => p.start.y))].sort((a, b) => a - b);
    expect(y).toEqual([0, 20000]);

    for (const p of poteaux) {
      expect(p.start.z).toBe(0);
      expect(p.end.z).toBe(P.grid.eaveHeight);
    }
  });

  it('fait se rejoindre les deux traverses au faîtage', () => {
    const traverses = parRole(buildProject(P).members, 'traverse');
    for (const t of traverses) {
      const sommet = t.start.z > t.end.z ? t.start : t.end;
      expect(sommet.z).toBeCloseTo(ridgeHeight(P.grid), 6);
      expect(sommet.y).toBeCloseTo(10000, 6);
    }
  });

  it('monte le poteau jusqu’au plan du dessus de traverse', () => {
    /*
     * ⚠ Le détail précédent arrêtait le poteau SOUS une traverse continue, tout
     * en boulonnant une platine sur sa semelle intérieure : le jarret
     * pénétrait le poteau, et la moitié des boulons tombaient face à rien.
     */
    const poteau = parRole(buildProject(P).members, 'poteau')[0] as Member;
    expect(cutLengths(poteau).axis).toBeCloseTo(HPOTEAU, 3);
    expect(cutLengths(poteau).axis).toBeCloseTo(6180.9, 1);
  });

  it('arrête la traverse au nu de sa platine de genou', () => {
    const traverse = parRole(buildProject(P).members, 'traverse')[0] as Member;
    expect(cutLengths(traverse).axis).toBeCloseTo(LTRAVERSE, 6);
    expect(cutLengths(traverse).axis).toBeCloseTo(9828.8, 1);
  });

  it('coupe la tête de poteau dans le plan de la couverture, et la traverse d’aplomb', () => {
    const m = buildProject(P);
    const pente = rad2deg(leftSlopeRad(P.grid));
    const poteau = parRole(m.members, 'poteau')[0] as Member;
    const traverse = parRole(m.members, 'traverse')[0] as Member;

    expect(cutAngleDeg(poteau, 'start')).toBe(0); // pied scié droit
    // Tête parallèle au rampant : l'angle de la pente avec l'axe vertical.
    expect(cutAngleDeg(poteau, 'end')).toBeCloseTo(pente, 1);
    // Les deux abouts de la traverse sont d'aplomb — contre la platine de genou
    // et au faîtage : chacun fait avec l'axe du rampant l'angle de la pente.
    expect(cutAngleDeg(traverse, 'start')).toBeCloseTo(pente, 1);
    expect(cutAngleDeg(traverse, 'end')).toBeCloseTo(pente, 1);
  });

  it('oriente l’inertie forte dans le plan du portique', () => {
    const m = buildProject(P);
    const poteau = parRole(m.members, 'poteau')[0] as Member;
    const traverse = parRole(m.members, 'traverse')[0] as Member;
    // La hauteur de section (az) doit être dans le plan YZ du portique,
    // donc sans composante selon X, et la largeur (ay) selon X.
    for (const b of [poteau, traverse]) {
      const f = memberFrame(b);
      expect(Math.abs(f.az.x), `${b.role} hauteur de section`).toBeCloseTo(0, 9);
      expect(Math.abs(f.ay.x), `${b.role} largeur de section`).toBeCloseTo(1, 9);
    }
    // Et la section de la traverse « regarde » le ciel.
    expect(memberFrame(traverse).az.z).toBeGreaterThan(0.9);
  });

  it('positionne les jarrets sous la traverse, en partant du genou', () => {
    const m = buildProject(P);
    const j = m.haunches[0];
    if (!j) throw new Error('jarret manquant');
    // Racine au nu de la platine : 220 mm du point de travail, 22 mm plus haut.
    expect(j.root.y).toBeCloseTo(220, 6);
    expect(j.root.z).toBeCloseTo(P.grid.eaveHeight + 22, 6);
    const longueur = Math.hypot(j.tip.x - j.root.x, j.tip.y - j.root.y, j.tip.z - j.root.z);
    expect(longueur).toBeCloseTo(P.frame.haunch.length, 6);
    expect(j.tip.z).toBeGreaterThan(j.root.z); // le jarret suit le rampant qui monte
    // Le renfort descend D'APLOMB, pour s'appliquer contre la platine verticale.
    expect(j.down).toEqual({ x: 0, y: 0, z: -1 });
    expect(j.rootDepth).toBeCloseTo(P.frame.haunch.depth - getProfile(P.frame.rafterProfile).h, 6);
  });
});

describe('repérage automatique', () => {
  it('regroupe les pièces réellement interchangeables', () => {
    const m = buildProject(P);
    const groupes = groupByMark(m.members);
    /*
     * 12 poteaux identiques, et 12 traverses de DÉBIT identiques : coupées
     * d'aplomb aux deux bouts, celle de gauche est celle de droite retournée.
     * Une seule barre à débiter — mais deux ASSEMBLAGES, la platine de genou
     * n'étant pas au même bout : TR1A et TR1B.
     */
    expect(groupes.get('PO1')).toHaveLength(12);
    expect(groupes.get('TR1')).toHaveLength(12);
    expect(groupes.size).toBe(2);
    const assemblages = new Set(m.members.filter((x) => x.role === 'traverse').map((x) => x.assemblage));
    expect(assemblages).toEqual(new Set(['TR1A', 'TR1B']));
    // Repères du modèle : 2 barres + le jarret JA1 + les 3 tôles d'assemblage
    // (platine de pied, platine de genou, platine de faîtage).
    expect(m.stats.markCount).toBe(6);
    expect(new Set(m.plates.map((pl) => pl.mark))).toEqual(new Set(['PP1', 'PL1', 'PL2']));
  });

  it('distingue les portiques de pignon quand ils changent de profil', () => {
    const p: ProjectParams = {
      ...P,
      frame: { ...P.frame, distinctGableFrame: true },
    };
    const groupes = groupByMark(buildProject(p).members);
    // Les repères suivent l'ordre d'apparition : la file 1 est un pignon,
    // c'est donc le poteau de pignon qui prend PO1.
    expect(groupes.get('PO1')).toHaveLength(4); // 2 pignons × 2
    expect(groupes.get('PO1')?.[0]?.profileId).toBe(p.frame.gableColumnProfile);
    expect(groupes.get('PO2')).toHaveLength(8); // 4 files courantes × 2
    expect(groupes.get('PO2')?.[0]?.profileId).toBe(p.frame.columnProfile);
  });

  it('ne renumérote pas les pièces existantes quand on ajoute une travée', () => {
    const avant = buildProject(P);
    const apres = buildProject({ ...P, grid: { ...P.grid, nBays: 8 } });
    const reperesApres = new Map(apres.members.map((m) => [m.id, m.mark]));
    // Chaque pièce déjà présente doit retrouver exactement son repère : c'est
    // la seule formulation qui tienne, indépendamment de l'ordre d'émission.
    for (const m of avant.members) {
      expect(reperesApres.get(m.id), `${m.id} (${m.position})`).toBe(m.mark);
    }
  });

  it('sépare deux longueurs différentes sous deux repères', () => {
    const p: ProjectParams = { ...P, grid: { ...P.grid, asymmetric: true, slopeRight: 25 } };
    const groupes = groupByMark(buildProject(p).members);
    // Versants dissymétriques : les deux traverses ne sont plus les mêmes pièces.
    expect(groupes.get('TR1')?.length).toBe(6);
    expect(groupes.get('TR2')?.length).toBe(6);
    const l1 = cutLengths(groupes.get('TR1')?.[0] as Member).axis;
    const l2 = cutLengths(groupes.get('TR2')?.[0] as Member).axis;
    expect(Math.abs(l1 - l2)).toBeGreaterThan(100);
  });
});

describe('masses et synthèse', () => {
  it('retrouve la masse calculée à la main', () => {
    const m = buildProject(P);
    // ⚠ Ni le poteau ni la traverse ne font leur longueur d'épure : le poteau
    // monte au-dessus du point de travail, la traverse s'arrête avant lui.
    const poteaux = (12 * HPOTEAU * getProfile('IPE 400').G) / 1000;
    const traverses = 12 * (LTRAVERSE / 1000) * getProfile('IPE 360').G;
    const barres = m.members.reduce(
      (s, b) => s + (getProfile(b.profileId).G * cutLengths(b).axis) / 1000,
      0,
    );
    expect(barres).toBeCloseTo(poteaux + traverses, 3);
    expect(m.stats.massKg).toBeGreaterThan(barres); // les jarrets s'ajoutent
    expect(m.stats.byRole.poteau?.massKg).toBeCloseTo(poteaux, 3);
    expect(m.stats.byRole.traverse?.massKg).toBeCloseTo(traverses, 3);
  });

  it('compte les jarrets dans la masse sans les compter comme barres', () => {
    const m = buildProject(P);
    expect(m.stats.memberCount).toBe(24);
    expect(m.stats.byRole.jarret?.count).toBe(12);
    expect(m.stats.byRole.jarret?.massKg).toBeGreaterThan(0);
  });
});

describe('monopente', () => {
  const mono: ProjectParams = { ...P, grid: { ...P.grid, roofType: 'monopente' } };

  it('produit une seule traverse par file et deux poteaux de hauteurs différentes', () => {
    const m = buildProject(mono);
    expect(parRole(m.members, 'traverse')).toHaveLength(6);
    expect(parRole(m.members, 'poteau')).toHaveLength(12);
    const hauteurs = [...new Set(parRole(m.members, 'poteau').map((p) => Math.round(p.end.z)))];
    expect(hauteurs.sort((a, b) => a - b)).toEqual([6000, 8000]);
  });

  it('donne à la traverse la longueur développée de toute la portée', () => {
    const t = parRole(buildProject(mono).members, 'traverse')[0] as Member;
    // Coupée au nu des deux platines de genou, à 220 mm de chaque axe de poteau.
    const cos = 20000 / Math.hypot(20000, 2000);
    expect(cutLengths(t).axis).toBeCloseTo((20000 - 2 * 220) / cos, 6);
  });
});

describe('barres libres', () => {
  it('intègre une barre ajoutée à la main avec des coupes droites', () => {
    const p: ProjectParams = {
      ...P,
      freeMembers: [
        {
          id: 'L1',
          profile: 'IPE 200',
          grade: 'S235',
          start: { x: 0, y: 0, z: 3000 },
          end: { x: 6000, y: 0, z: 3000 },
          rotation: 0,
          label: 'Linteau',
        },
      ],
    };
    const m = buildProject(p);
    const libre = parRole(m.members, 'libre')[0] as Member;
    expect(cutLengths(libre).axis).toBeCloseTo(6000, 6);
    expect(cutAngleDeg(libre, 'start')).toBe(0);
    expect(libre.mark).toBe('LB1');
  });

  it('applique la rotation demandée autour de l’axe de la barre', () => {
    const base = {
      id: 'L1',
      profile: 'IPE 200' as const,
      grade: 'S235' as const,
      start: { x: 0, y: 0, z: 3000 },
      end: { x: 6000, y: 0, z: 3000 },
      label: '',
    };
    const droit = buildProject({ ...P, freeMembers: [{ ...base, rotation: 0 }] });
    const tourne = buildProject({ ...P, freeMembers: [{ ...base, rotation: 90 }] });
    const a = memberFrame(parRole(droit.members, 'libre')[0] as Member);
    const b = memberFrame(parRole(tourne.members, 'libre')[0] as Member);
    expect(Math.abs(a.az.z)).toBeCloseTo(1, 6); // âme verticale
    expect(Math.abs(b.az.y)).toBeCloseTo(1, 6); // âme couchée après rotation
  });
});

describe('génération — déterminisme et performance', () => {
  it('est purement déterministe', () => {
    const a = buildProject(P);
    const b = buildProject(P);
    const sansTemps = (m: ReturnType<typeof buildProject>) =>
      JSON.stringify({ members: m.members, haunches: m.haunches, stats: m.stats });
    expect(sansTemps(a)).toBe(sansTemps(b));
  });

  it('ne modifie pas les paramètres qu’on lui donne', () => {
    const avant = JSON.stringify(P);
    buildProject(P);
    expect(JSON.stringify(P)).toBe(avant);
  });

  it('régénère un hangar de 10 travées bien en dessous de la seconde', () => {
    const grand: ProjectParams = { ...P, grid: { ...P.grid, nBays: 10 } };
    const m = buildProject(grand);
    expect(m.members).toHaveLength(44);
    expect(m.buildMs, `${m.buildMs.toFixed(1)} ms`).toBeLessThan(200);
  });
});
