import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { cutLengths, memberFrame, type Member } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { leftSlopeRad, rafterLength, ridgeHeight, ridgeY } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import type { TrussType } from '../../model/truss';
import { buildProject } from '../buildProject';
import { nodeStations, panelsPerSlope, tieLevel, tieZ, trussDepthAtRidge } from '../buildTruss';

/**
 * Projet à fermes treillis, ossature secondaire et contreventements coupés.
 *
 * ⚠ Les hauteurs et le nombre de panneaux sont FIXÉS ici, et non hérités des
 * réglages par défaut : un test qui lit une valeur par défaut teste cette valeur
 * et non la règle géométrique. Changer un défaut cassait alors une dizaine
 * d'assertions sans qu'aucune règle n'ait bougé.
 */
const TREILLIS_TEST = { nPanels: 8, heightAtSupport: 1200, heightAtRidge: 2200 } as const;

function projetTreillis(patch: Partial<ProjectParams['truss']> = {}): ProjectParams {
  return {
    ...DEFAULT_PROJECT,
    frame: { ...DEFAULT_PROJECT.frame, enabled: false },
    truss: { ...DEFAULT_PROJECT.truss, enabled: true, ...TREILLIS_TEST, ...patch },
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
}

const parRole = (ms: readonly Member[], r: Member['role']): Member[] =>
  ms.filter((m) => m.role === r);

/**
 * Barres d'une seule ferme (la première file), pour compter sans multiplier.
 * Le filtre porte sur l'identifiant et non sur x : les cornières doubles sont
 * décalées de part et d'autre du plan de la ferme.
 */
const premiereFerme = (ms: readonly Member[]): Member[] =>
  ms.filter((m) => m.id.startsWith('0-') && m.role !== 'poteau');

const G = DEFAULT_PROJECT.grid;

describe('ferme treillis — géométrie d’ensemble', () => {
  // Cornières simples : ce bloc mesure la géométrie, pas le dédoublement.
  const p = projetTreillis({ doubleAngles: false });
  const m = buildProject(p);

  it('conserve les poteaux et les raccourcit de la hauteur de ferme', () => {
    const poteaux = parRole(m.members, 'poteau');
    expect(poteaux).toHaveLength(12);
    // 6 m d'égout − 1,20 m de ferme = tête de poteau à 4,80 m
    for (const po of poteaux) expect(po.end.z).toBeCloseTo(4800, 6);
    expect(tieLevel(G, p.truss)).toBeCloseTo(4800, 6);
  });

  it('scie les têtes de poteaux d’équerre : la ferme repose dessus', () => {
    // Sous une traverse à âme pleine la tête serait en onglet ; sous une ferme
    // elle est plane, la platine d'appui est horizontale.
    for (const po of parRole(m.members, 'poteau')) {
      const f = memberFrame(po);
      const n = po.cutEnd.normal;
      expect(Math.abs(n.x * f.ax.x + n.y * f.ax.y + n.z * f.ax.z)).toBeCloseTo(1, 9);
    }
  });

  it('fait suivre la ligne de toiture par la membrure supérieure', () => {
    const hauts = parRole(premiereFerme(m.members), 'membrure-sup');
    const egout = hauts.flatMap((b) => [b.start, b.end]).filter((q) => q.y === 0);
    expect(egout.length).toBeGreaterThan(0);
    // L'égout reste à la hauteur d'égout : c'est l'arbalétrier qui y arrive.
    for (const q of egout) expect(q.z).toBeCloseTo(G.eaveHeight, 6);
    const faitage = hauts.flatMap((b) => [b.start, b.end]).filter((q) => Math.abs(q.y - 10000) < 1);
    for (const q of faitage) expect(q.z).toBeCloseTo(ridgeHeight(G), 6);
  });

  it('donne à l’arbalétrier la longueur développée du versant', () => {
    const hauts = parRole(premiereFerme(m.members), 'membrure-sup');
    expect(hauts).toHaveLength(2); // un par versant
    for (const b of hauts) {
      expect(cutLengths(b).axis).toBeCloseTo(rafterLength(G, 'gauche'), 6);
    }
  });

  it('émet l’entrait droit en une seule pièce, de toute la portée', () => {
    const bas = parRole(premiereFerme(m.members), 'membrure-inf');
    expect(bas).toHaveLength(1);
    expect(cutLengths(bas[0] as Member).axis).toBeCloseTo(G.span, 6);
    expect((bas[0] as Member).start.z).toBeCloseTo(4800, 6);
    expect((bas[0] as Member).end.z).toBeCloseTo(4800, 6);
  });

  it('déduit la hauteur au faîtage de la pente quand l’entrait est droit', () => {
    // 1,20 m à l'appui + 1 m de montée du versant = 2,20 m au faîtage
    expect(trussDepthAtRidge(G, p.truss)).toBeCloseTo(2200, 6);
    expect(trussDepthAtRidge(G, p.truss)).toBeCloseTo(
      p.truss.heightAtSupport + ridgeY(G) * Math.tan(leftSlopeRad(G)),
      6,
    );
  });

  it('respecte exactement la hauteur demandée quand l’entrait est retroussé', () => {
    const retrousse = projetTreillis({ straightTie: false, heightAtRidge: 1600, doubleAngles: false });
    expect(trussDepthAtRidge(G, retrousse.truss)).toBeCloseTo(1600, 6);
    // L'entrait monte : au faîtage il est plus haut qu'à l'appui.
    expect(tieZ(G, retrousse.truss, 10000)).toBeGreaterThan(tieZ(G, retrousse.truss, 0));
    const bas = parRole(premiereFerme(buildProject(retrousse).members), 'membrure-inf');
    expect(bas).toHaveLength(2); // entrait brisé : une pièce par versant
  });

  it('place toujours un nœud au faîtage', () => {
    for (const n of [6, 7, 8, 9, 12]) {
      const t = { ...DEFAULT_PROJECT.truss, nPanels: n };
      const ys = nodeStations(G, t);
      expect(ys, `nPanels=${n}`).toContain(ridgeY(G));
      expect(ys).toHaveLength(2 * panelsPerSlope(G, t) + 1);
    }
  });
});

describe('ferme treillis — topologies de treillis', () => {
  const compte = (type: TrussType, patch: Partial<ProjectParams['truss']> = {}) => {
    const p = projetTreillis({ type, ...patch });
    const barres = premiereFerme(buildProject(p).members);
    // Avec l'option double cornière, chaque barre est émise en deux exemplaires.
    const facteur = p.truss.doubleAngles ? 2 : 1;
    return {
      montants: parRole(barres, 'montant').length / facteur,
      diagonales: parRole(barres, 'diagonale').length / facteur,
      barres,
      facteur,
    };
  };

  it('Warren classique : une diagonale par panneau, alternées, sans montant', () => {
    const c = compte('warren', { warrenWithPosts: false });
    expect(c.diagonales).toBe(8); // 8 panneaux
    expect(c.montants).toBe(0);
    // Les diagonales doivent alterner de sens : une monte, la suivante descend.
    const diag = parRole(c.barres, 'diagonale').filter((_, i) => i % c.facteur === 0);
    const sens = diag.map((d) => Math.sign(d.end.z - d.start.z));
    for (let i = 1; i < sens.length; i++) {
      expect(sens[i], `diagonale ${i}`).toBe(-(sens[i - 1] as number));
    }
  });

  it('Warren avec montants : un montant à chaque nœud, ABOUTS COMPRIS', () => {
    // 8 panneaux ⇒ 9 nœuds, dont les 2 d'appui.
    expect(compte('warren', { warrenWithPosts: true }).montants).toBe(9);
  });

  it('Pratt : montants à tous les nœuds et diagonales symétriques', () => {
    const c = compte('pratt');
    expect(c.montants).toBe(9);
    expect(c.diagonales).toBe(8);
    const diag = parRole(c.barres, 'diagonale').filter((_, i) => i % c.facteur === 0);
    // Le premier panneau descend vers le centre, le dernier remonte : symétrie.
    const premier = diag[0] as Member;
    const dernier = diag[diag.length - 1] as Member;
    expect(premier.start.z).toBeGreaterThan(premier.end.z);
    expect(dernier.start.z).toBeLessThan(dernier.end.z);
  });

  it('Howe : même trame que le Pratt, diagonales inversées', () => {
    const pratt = compte('pratt');
    const howe = compte('howe');
    expect(howe.montants).toBe(pratt.montants);
    expect(howe.diagonales).toBe(pratt.diagonales);
    const dP = parRole(pratt.barres, 'diagonale')[0] as Member;
    const dH = parRole(howe.barres, 'diagonale')[0] as Member;
    expect(Math.sign(dP.end.z - dP.start.z)).toBe(-Math.sign(dH.end.z - dH.start.z));
  });

  it('Polonceau : contrefiches perpendiculaires à l’arbalétrier', () => {
    const p = projetTreillis({ type: 'polonceau', doubleAngles: false });
    const barres = premiereFerme(buildProject(p).members);
    const arbaGauche = parRole(barres, 'membrure-sup')[0] as Member;
    const rampant = memberFrame(arbaGauche).ax;

    const contrefiches = parRole(barres, 'montant').filter((b) => b.position.includes('contrefiche'));
    expect(contrefiches.length).toBeGreaterThan(0);

    for (const cf of contrefiches.filter((b) => b.end.y < ridgeY(G))) {
      const ax = memberFrame(cf).ax;
      const produit = ax.x * rampant.x + ax.y * rampant.y + ax.z * rampant.z;
      expect(Math.abs(produit), `${cf.position} n’est pas perpendiculaire`).toBeLessThan(1e-9);
    }
  });

  it('Polonceau : un poinçon vertical au faîtage, et des tirants montants', () => {
    const p = projetTreillis({ type: 'polonceau', doubleAngles: false });
    const barres = premiereFerme(buildProject(p).members);
    const poincon = parRole(barres, 'montant').find((b) => b.position.includes('poinçon'));
    if (!poincon) throw new Error('poinçon absent');
    expect(poincon.start.y).toBeCloseTo(poincon.end.y, 6);
    expect(poincon.start.z).toBeLessThan(poincon.end.z);
    expect(poincon.start.y).toBeCloseTo(ridgeY(G), 6);

    // Chaque contrefiche a son tirant : autant de tirants que de contrefiches.
    const cf = parRole(barres, 'montant').filter((b) => b.position.includes('contrefiche'));
    const ti = parRole(barres, 'diagonale').filter((b) => b.position.includes('tirant'));
    expect(ti).toHaveLength(cf.length);
  });

  it('toutes les barres de treillis restent dans le plan de leur ferme', () => {
    for (const type of ['warren', 'pratt', 'howe', 'polonceau'] as TrussType[]) {
      const p = projetTreillis({ type, doubleAngles: false });
      for (const b of premiereFerme(buildProject(p).members)) {
        expect(b.start.x, `${type} ${b.position}`).toBeCloseTo(0, 6);
        expect(b.end.x, `${type} ${b.position}`).toBeCloseTo(0, 6);
      }
    }
  });
});

describe('ferme treillis — double cornière dos à dos', () => {
  const p = projetTreillis();
  const barres = premiereFerme(buildProject(p).members);

  it('émet deux cornières par barre, dont une en miroir', () => {
    const entraits = parRole(barres, 'membrure-inf');
    expect(entraits).toHaveLength(2);
    const [a, b] = entraits as [Member, Member];
    expect(a.mirrored).toBe(false);
    expect(b.mirrored).toBe(true);
  });

  it('les décale symétriquement de part et d’autre du gousset', () => {
    const [a, b] = parRole(barres, 'membrure-inf') as [Member, Member];
    const profil = getProfile(a.profileId);
    if (profil.shape !== 'L') throw new Error('profil attendu : cornière');
    const gousset = p.connections.gusset.thickness;
    const attendu = profil.cy + gousset / 2;

    // Le décalage est perpendiculaire au plan de la ferme, donc selon X.
    expect(Math.abs(a.start.x - b.start.x)).toBeCloseTo(2 * attendu, 6);
    expect((a.start.x + b.start.x) / 2).toBeCloseTo(0, 6); // centrées sur la ferme
  });

  it('laisse exactement l’épaisseur du gousset entre les deux dos', () => {
    const [a, b] = parRole(barres, 'membrure-inf') as [Member, Member];
    const profil = getProfile(a.profileId);
    if (profil.shape !== 'L') throw new Error('profil attendu : cornière');
    const fa = memberFrame(a);
    const fb = memberFrame(b);
    // Le dos de la grande aile est à −cy du centre de gravité, selon +y local.
    const dosA = a.start.x + fa.ay.x * -profil.cy;
    const dosB = b.start.x + fb.ay.x * -profil.cy;
    expect(Math.abs(dosA - dosB)).toBeCloseTo(p.connections.gusset.thickness, 6);
  });

  it('retourne bien la section, pas seulement la position', () => {
    const [a, b] = parRole(barres, 'membrure-inf') as [Member, Member];
    const fa = memberFrame(a);
    const fb = memberFrame(b);
    // Même axe, même hauteur de section, largeur inversée : c'est une symétrie.
    expect(fb.ax.y).toBeCloseTo(fa.ax.y, 9);
    expect(fb.az.z).toBeCloseTo(fa.az.z, 9);
    expect(fb.ay.x).toBeCloseTo(-fa.ay.x, 9);
  });

  it('donne aux deux cornières la même longueur de débit', () => {
    const [a, b] = parRole(barres, 'membrure-inf') as [Member, Member];
    const la = cutLengths(a);
    const lb = cutLengths(b);
    expect(lb.axis).toBeCloseTo(la.axis, 6);
    expect(lb.max).toBeCloseTo(la.max, 6);
    expect(lb.min).toBeCloseTo(la.min, 6);
  });

  it('les compte comme deux pièces distinctes au repérage', () => {
    const [a, b] = parRole(barres, 'membrure-inf') as [Member, Member];
    // Deux cornières symétriques ne sont pas interchangeables en atelier.
    expect(a.mark).not.toBe(b.mark);
  });

  it('n’édite pas de doublon si le profil n’est pas une cornière', () => {
    const tubes = projetTreillis({
      topChordProfile: 'CHS 114.3x5',
      bottomChordProfile: 'CHS 114.3x5',
      postProfile: 'CHS 60.3x4',
      diagonalProfile: 'CHS 60.3x4',
    });
    const b = premiereFerme(buildProject(tubes).members);
    expect(parRole(b, 'membrure-inf')).toHaveLength(1);
  });
});
