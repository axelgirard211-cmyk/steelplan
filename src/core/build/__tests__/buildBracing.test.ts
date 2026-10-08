import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { cutAngleDeg, cutLengths, fibreAbscissa, memberFrame, type Member } from '../../geometry/member';
import { add, cross, dot, normalize, scale, sub } from '../../math/vec3';
import { holeDiameter } from '../../model/connections';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { bracedBays } from '../../model/bracing';
import { buildingLength, frameStations, ridgeHeight, ridgeY, roofZ } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import { listerBoulons } from '../bolts';
import { basDePlatineDeGenou } from '../buildFrame';
import { buildProject } from '../buildProject';
import { fenteDuPlat, longueurDeFente } from '../connections/contreventement';
import { groupByMark } from '../marks';
import { sheetDebit } from '../../drawing/sheets/debit';
import type { Plate } from '../types';

/** Projet par défaut, ossature secondaire coupée : on teste les contreventements. */
const P: ProjectParams = {
  ...DEFAULT_PROJECT,
  secondary: {
    purlins: { ...DEFAULT_PROJECT.secondary.purlins, enabled: false },
    rails: { ...DEFAULT_PROJECT.secondary.rails, enabled: false },
    gablePosts: { ...DEFAULT_PROJECT.secondary.gablePosts, enabled: false },
  },
};
const G = P.grid;

const cv = (p: ProjectParams = P): Member[] =>
  buildProject(p).members.filter((m) => m.role === 'contreventement');

describe('choix des travées contreventées', () => {
  it('place d’office les palées en première et dernière travée', () => {
    expect(bracedBays(P.bracing.wall, G.nBays)).toEqual([0, 4]);
  });

  it('respecte une sélection explicite', () => {
    const choisi: ProjectParams = {
      ...P,
      bracing: { ...P.bracing, wall: { ...P.bracing.wall, bays: [2] } },
    };
    expect(bracedBays(choisi.bracing.wall, G.nBays)).toEqual([2]);
  });

  it('ignore une travée inexistante', () => {
    expect(bracedBays({ ...P.bracing.wall, bays: [0, 99] }, G.nBays)).toEqual([0]);
  });

  it('contrevente la travée unique d’un bâtiment à une seule travée', () => {
    expect(bracedBays(P.bracing.wall, 1)).toEqual([0]);
  });
});

describe('contreventements — comptage et plans', () => {
  const barres = cv();

  it('pose les trois familles au complet', () => {
    const poutreAuVent = barres.filter((b) => b.position.includes('poutre au vent'));
    const palees = barres.filter((b) => b.position.includes('palée'));
    const pignons = barres.filter((b) => b.position.includes('pignon'));
    // 2 travées × 2 versants × 2 diagonales
    expect(poutreAuVent).toHaveLength(8);
    // 2 travées × 2 long pans × 2 diagonales
    expect(palees).toHaveLength(8);
    // 2 pignons × 2 diagonales
    expect(pignons).toHaveLength(4);
    expect(barres).toHaveLength(20);
  });

  /*
   * ⚠ Chaque maille est DANS LE PLAN DES AXES des pièces qu'elle relie, ses deux
   * brins de part et d'autre, à une demi-épaisseur de tube plus 5 mm : ils se
   * croisent sans se toucher. Écartée de ce plan — sous les traverses, devant les
   * poteaux, derrière les potelets —, elle ne trouvait aucune face où souder un
   * gousset, et l'effort arrivait excentré sur les poteaux.
   */
  const ecart = (profil: string): number => getProfile(profil).h / 2 + 5;

  it('pose la poutre au vent dans le plan des traverses, parallèlement aux versants', () => {
    const diagonales = barres.filter((x) => x.position.includes('poutre au vent'));
    expect(diagonales.length).toBeGreaterThan(0);
    const cosA = Math.cos(Math.atan2(ridgeHeight(G) - G.eaveHeight, ridgeY(G)));
    for (const b of diagonales) {
      // Écart au plan des axes, mesuré selon la normale au versant : constant
      // sur toute la barre, et d'un brin de chaque côté.
      const e0 = (b.start.z - roofZ(G, b.start.y)) * cosA;
      const e1 = (b.end.z - roofZ(G, b.end.y)) * cosA;
      expect(Math.abs(e0), b.position).toBeCloseTo(ecart(P.bracing.roof.profile), 3);
      expect(e1, b.position).toBeCloseTo(e0, 3);
    }
  });

  it('pose les palées dans le plan des poteaux, dans un plan vertical', () => {
    for (const b of barres.filter((x) => x.position.includes('palée'))) {
      expect(b.start.y).toBeCloseTo(b.end.y, 6);
      const axe = b.start.y < G.span / 2 ? 0 : G.span;
      expect(Math.abs(b.start.y - axe), b.position).toBeCloseTo(ecart(P.bracing.wall.profile), 6);
    }
  });

  it('pose le contreventement de pignon dans le plan du pignon', () => {
    const L = buildingLength(G);
    for (const b of barres.filter((x) => x.position.includes('contreventement de pignon'))) {
      expect(b.start.x).toBeCloseTo(b.end.x, 6);
      const axe = b.start.x < L / 2 ? 0 : L;
      expect(Math.abs(b.start.x - axe), b.position).toBeCloseTo(ecart(P.bracing.gable.profile), 6);
    }
  });

  it('éboute les diagonales de palée au bout de leur plat d’attache', () => {
    /*
     * ⚠ La diagonale de la maille est une longueur d'ÉPURE. La barre s'arrête
     * au-delà de son gousset — au-delà des rives de semelle du poteau —, et son
     * plat d'about comble la distance.
     */
    const palees = barres.filter((x) => x.position.includes('palée'));
    const zTete = G.eaveHeight - getProfile(P.frame.rafterProfile).h / 2;
    const epure = Math.hypot(G.baySpacing, zTete);
    const b = getProfile(P.frame.columnProfile).b;
    for (const d of palees) {
      expect(cutLengths(d).axis, d.position).toBeLessThan(epure - b);
      expect(cutLengths(d).axis, d.position).toBeGreaterThan(epure - 2 * 500);
    }
  });

  it('coupe les diagonales d’équerre : elles s’assemblent sur goussets', () => {
    for (const b of barres) {
      expect(cutAngleDeg(b, 'start'), b.position).toBe(0);
      expect(cutAngleDeg(b, 'end'), b.position).toBe(0);
    }
  });

  it('croise bien les deux diagonales d’une même maille', () => {
    const palee = barres.filter((b) => b.position.includes('palée de stabilité — travée 1, long pan gauche'));
    expect(palee).toHaveLength(2);
    const [d1, d2] = palee as [Member, Member];
    // Les deux diagonales partent du bas de la maille et montent : ce qui les
    // fait se croiser, c'est leur inclinaison opposée selon X.
    expect(Math.sign(d1.end.z - d1.start.z)).toBe(1);
    expect(Math.sign(d2.end.z - d2.start.z)).toBe(1);
    expect(Math.sign(d1.end.x - d1.start.x)).toBe(-Math.sign(d2.end.x - d2.start.x));
    // Et elles occupent la même maille.
    expect(Math.min(d1.start.x, d1.end.x)).toBeCloseTo(Math.min(d2.start.x, d2.end.x), 6);
    expect(Math.max(d1.start.x, d1.end.x)).toBeCloseTo(Math.max(d2.start.x, d2.end.x), 6);
  });

  it('regroupe les palées identiques sous un seul repère', () => {
    const palees = barres.filter((x) => x.position.includes('palée'));
    expect(groupByMark(palees).size).toBe(1);
  });
});

describe('contreventements — formes', () => {
  const avecForme = (shape: 'croix' | 'diagonale' | 'k') =>
    cv({
      ...P,
      bracing: {
        ...P.bracing,
        roof: { ...P.bracing.roof, enabled: false },
        gable: { ...P.bracing.gable, enabled: false },
        wall: { ...P.bracing.wall, shape },
      },
    });

  it('la croix pose deux diagonales par maille', () => {
    expect(avecForme('croix')).toHaveLength(8);
  });

  it('la diagonale simple n’en pose qu’une', () => {
    expect(avecForme('diagonale')).toHaveLength(4);
  });

  it('la palée en K fait converger deux brins à mi-hauteur', () => {
    const k = avecForme('k');
    expect(k).toHaveLength(8); // 2 brins par maille
    const maille = k.filter((b) => b.position.includes('travée 1, long pan gauche'));
    expect(maille).toHaveLength(2);
    const [bas, haut] = maille as [Member, Member];
    /*
     * Les deux brins VISENT le même point — le milieu du montant opposé — et
     * s'arrêtent au bout de leurs plats, sur le gousset commun : de part et
     * d'autre du point visé, à la même distance du poteau.
     * ⚠ Ils convergeaient au centre de la MAILLE, en l'air, sur un nœud que
     * rien ne tenait.
     */
    const zTete = G.eaveHeight - getProfile(P.frame.rafterProfile).h / 2;
    for (const brin of [bas, haut]) {
      expect(G.baySpacing - brin.end.x, brin.position).toBeGreaterThan(getProfile(P.frame.columnProfile).b / 2);
      expect(G.baySpacing - brin.end.x, brin.position).toBeLessThan(500);
    }
    expect((bas.end.z + haut.end.z) / 2).toBeCloseTo(zTete / 2, 0);
    expect(bas.end.x).toBeCloseTo(haut.end.x, 6);
  });
});

describe('contreventements — adaptation au reste du modèle', () => {
  it('s’arrête en tête de poteau quand la toiture est portée par des fermes', () => {
    // La hauteur d'appui est FIXÉE ici, et non héritée du projet par défaut :
    // c'est la règle « tête de poteau = égout − hauteur de ferme » qu'on vérifie,
    // pas la valeur d'un réglage.
    const hauteurAppui = 1200;
    const treillis: ProjectParams = {
      ...P,
      frame: { ...P.frame, enabled: false },
      truss: { ...P.truss, enabled: true, heightAtSupport: hauteurAppui },
    };
    const palees = cv(treillis).filter((b) => b.position.includes('palée'));
    const hauts = palees.flatMap((b) => [b.start.z, b.end.z]);
    // Sous le niveau d'entrait, jamais dedans : la palée s'attache au gousset
    // placé sous la membrure inférieure.
    const niveauEntrait = G.eaveHeight - hauteurAppui;
    for (const z of hauts) expect(z).toBeLessThan(niveauEntrait);
  });

  it('suit la toiture en monopente', () => {
    const mono: ProjectParams = { ...P, grid: { ...G, roofType: 'monopente' } };
    const barres = cv(mono);
    const poutreAuVent = barres.filter((b) => b.position.includes('poutre au vent'));
    // Un seul versant en monopente : 2 travées × 1 versant × 2 diagonales
    expect(poutreAuVent).toHaveLength(4);
    for (const b of poutreAuVent) {
      // Dans le plan des traverses et parallèle au versant, comme en bipente.
      const e0 = b.start.z - roofZ(mono.grid, b.start.y);
      const e1 = b.end.z - roofZ(mono.grid, b.end.y);
      expect(Math.abs(e0), b.position).toBeLessThan(getProfile(P.bracing.roof.profile).h);
      expect(e1, b.position).toBeCloseTo(e0, 3);
    }
  });

  it('se retire entièrement quand on le désactive', () => {
    const sans: ProjectParams = {
      ...P,
      bracing: {
        ...P.bracing,
        roof: { ...P.bracing.roof, enabled: false },
        wall: { ...P.bracing.wall, enabled: false },
        gable: { ...P.bracing.gable, enabled: false },
      },
    };
    expect(cv(sans)).toHaveLength(0);
  });

  it('relie bien l’égout au faîtage dans la poutre au vent', () => {
    const barres = cv().filter((b) => b.position.includes('poutre au vent'));
    // ⚠ Les abouts ne tombent plus EXACTEMENT sur la rive et le faîtage : la
    // diagonale est éboutée à la face des traverses qu'elle rejoint. On vérifie
    // donc qu'elle va bien de l'une à l'autre, à l'ébout près.
    const tolerance = getProfile(P.frame.rafterProfile).h;
    for (const b of barres) {
      const ys = [b.start.y, b.end.y];
      const versFaitage = ys.some((y) => Math.abs(y - ridgeY(G)) < tolerance);
      const versRive = ys.some((y) => Math.abs(y) < tolerance || Math.abs(y - G.span) < tolerance);
      expect(versFaitage, `${b.position} : ${ys.map((y) => y.toFixed(0)).join(' → ')}`).toBe(true);
      expect(versRive, b.position).toBe(true);
    }
  });
});

describe('modèle complet — projet par défaut', () => {
  const m = buildProject(DEFAULT_PROJECT);

  it('assemble portique, ossature secondaire et contreventements', () => {
    const compte = (r: Member['role']) => m.members.filter((x) => x.role === r).length;
    expect(compte('poteau')).toBe(12);
    expect(compte('traverse')).toBe(12);
    // Le débord de toiture : une console par genou.
    expect(compte('console')).toBe(12);
    expect(compte('panne')).toBe(75);
    expect(compte('lierne')).toBe(70);
    // 2 long pans × 4 niveaux × 5 travées, plus 2 pignons × 4 niveaux × 4 travées
    // entre potelets.
    expect(compte('lisse')).toBe(40 + 32);
    expect(compte('potelet')).toBe(6);
    // 8 en poutre au vent, 8 en palées, et 8 en pignon : deux mailles de rive
    // par pignon, entre poteau d'angle et premier potelet.
    expect(compte('contreventement')).toBe(24);
    // Une cornière d'attache par croisement panne / file : 15 pannes × 6 files.
    expect(compte('attache')).toBe(90);
    expect(m.haunches).toHaveLength(12);
    // Une équerre d'angle par lisse de pignon arrivant sur un poteau d'angle :
    // 4 niveaux × 2 angles × 2 pignons.
    expect(compte('equerre')).toBe(16);
    expect(m.members).toHaveLength(389);
  });

  it('ne demande aucune diagonale plus longue qu’une barre de tube du commerce', () => {
    /*
     * ⚠ La croix de pignon allait d'un angle à l'autre du pignon : 20,65 m d'un
     * seul tube de 48 mm. Aucun négociant ne le livre, aucun plateau ne le
     * porte. Les diagonales doivent sortir d'une barre de 12 m.
     */
    for (const d of m.members.filter((x) => x.role === 'contreventement')) {
      expect(cutLengths(d).max, d.position).toBeLessThanOrEqual(12_000 - 20);
    }
  });

  it('reste déterministe', () => {
    const a = buildProject(DEFAULT_PROJECT);
    const b = buildProject(DEFAULT_PROJECT);
    const cle = (x: typeof a) => JSON.stringify({ m: x.members, h: x.haunches, s: x.stats });
    expect(cle(a)).toBe(cle(b));
  });

  it('régénère un hangar de 10 travées bien en dessous de la seconde', () => {
    const grand = buildProject({ ...DEFAULT_PROJECT, grid: { ...G, nBays: 10 } });
    expect(grand.members.length).toBeGreaterThan(400);
    expect(grand.buildMs, `${grand.buildMs.toFixed(1)} ms`).toBeLessThan(500);
  });

  it('totalise une masse plausible pour un hangar de 600 m²', () => {
    // Un hangar industriel courant pèse de l'ordre de 25 à 55 kg/m² d'emprise.
    const parM2 = m.stats.massKg / 600;
    expect(parM2, `${parM2.toFixed(1)} kg/m²`).toBeGreaterThan(20);
    expect(parM2, `${parM2.toFixed(1)} kg/m²`).toBeLessThan(60);
  });
});

/* ================================================================== */
/* Attaches des diagonales                                             */
/* ================================================================== */

describe('contreventements — attaches des diagonales', () => {
  /*
   * Plat soudé dans le tube fendu, boulonné par deux boulons sur un gousset
   * soudé sur la pièce porteuse. ⚠ Les diagonales partaient sans rien à leurs
   * abouts : ni gousset, ni plat, ni boulon.
   */
  const M = buildProject(DEFAULT_PROJECT);
  const parId = new Map(M.members.map((m) => [m.id, m]));
  const tubes = M.members.filter((m) => m.role === 'contreventement');
  const plats = M.plates.filter((pl) => pl.kind === 'plat-tube');
  const goussets = M.plates.filter((pl) => pl.kind === 'gousset-cv');
  const point = (pl: Plate, q: { y: number; z: number }) => add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z)));
  const surAme = (g: Plate, appui: Member): boolean => Math.abs(dot(normalize(cross(g.u, g.v)), memberFrame(appui).az)) > 0.9;
  const d0 = holeDiameter(DEFAULT_PROJECT.connections.gusset.bolt);

  it('équipe chaque about de diagonale d’un plat engagé dans sa fente', () => {
    expect(tubes).toHaveLength(24);
    for (const t of tubes) {
      const siens = plats.filter((pl) => pl.porteur === t.id);
      expect(siens, t.position).toHaveLength(2);
      const abouts = siens.map((pl) => fenteDuPlat(t, pl));
      expect(new Set(abouts.map((a) => a.about)), t.position).toEqual(new Set(['origine', 'extremite']));
      for (const a of abouts) {
        // 1,5 D arrondi à la dizaine, 80 mm au moins : 100 pour un Ø60,3.
        expect(a.longueur, t.position).toBeCloseTo(longueurDeFente(getProfile(t.profileId).h), 6);
        expect(a.saillie, t.position).toBeGreaterThan(0);
      }
    }
    expect(longueurDeFente(60.3)).toBe(100);
  });

  it('porte la fente sur la PIÈCE, là où le débiteur la lit', () => {
    // La fente se scie au débit : elle est sur le tube, déduite de son plat.
    for (const t of tubes) {
      expect(t.fentes?.map((f) => f.about), t.position).toEqual(['extremite', 'origine']);
      for (const f of t.fentes ?? []) {
        expect(f.longueur).toBeCloseTo(longueurDeFente(getProfile(t.profileId).h), 6);
        expect(f.largeur).toBe(DEFAULT_PROJECT.connections.gusset.thickness + 2);
      }
    }
    const t = tubes[0] as Member;
    const plan = sheetDebit(t, { page: 1, total: 1, meta: DEFAULT_PROJECT.meta, quantite: 1 });
    const textes = plan.scene.entities.flatMap((e) => (e.kind === 'texte' ? [e.texte] : []));
    expect(textes.some((x) => x.startsWith('Fentes d’about'))).toBe(true);
  });

  it('boulonne chaque plat sur un gousset par deux boulons, et rien d’autre', () => {
    const boulons = listerBoulons(M.members, M.plates).filter((b) => b.usage === 'contreventements');
    // 24 diagonales × 2 abouts × 2 boulons.
    expect(boulons).toHaveLength(96);
    for (const b of boulons) {
      const natures = b.pieces.map((id) => M.plates.find((pl) => pl.id === id)?.kind).sort();
      expect(natures).toEqual(['gousset-cv', 'plat-tube']);
      expect(b.grip).toBe(2 * DEFAULT_PROJECT.connections.gusset.thickness);
    }
  });

  it('soude chaque gousset dans le métal de sa pièce : entre ses semelles, ou sur leur largeur', () => {
    expect(goussets.length).toBeGreaterThan(0);
    for (const g of goussets) {
      const appui = parId.get(g.porteur ?? '') as Member;
      expect(['poteau', 'traverse', 'potelet']).toContain(appui.role);
      const pr = getProfile(appui.profileId);
      if (pr.shape !== 'I') throw new Error('appui sans semelles');
      const f = memberFrame(appui);
      const plan = Math.abs(dot(sub(g.origin, appui.start), normalize(cross(g.u, g.v))));
      if (surAme(g, appui)) expect(plan + g.thickness / 2, g.id).toBeLessThan(pr.h / 2 - pr.tf - pr.r);
      else expect(plan + g.thickness / 2, g.id).toBeLessThan(pr.b / 2);
      // Entre les deux coupes de la pièce : pas dans une platine.
      const s = g.outline.map((q) => dot(sub(point(g, q), appui.start), f.ax));
      const coupes = [appui.cutStart, appui.cutEnd].map((c) => fibreAbscissa(f, appui.start, c, { y: 0, z: 0 }));
      expect(Math.min(...s), g.id).toBeGreaterThan(Math.min(...coupes));
      expect(Math.max(...s), g.id).toBeLessThan(Math.max(...coupes));
    }
  });

  it('loge les boulons au-delà des rives de semelle, avec la place d’une clé', () => {
    for (const g of goussets) {
      const appui = parId.get(g.porteur ?? '') as Member;
      const pr = getProfile(appui.profileId);
      if (pr.shape !== 'I') continue;
      const obstacle = surAme(g, appui) ? pr.b / 2 : pr.h / 2;
      for (const h of g.holes) {
        const ecartement = dot(sub(point(g, h.at), appui.start), g.v);
        expect(ecartement, g.id).toBeGreaterThanOrEqual(obstacle + 2 * d0 - 0.01);
      }
    }
  });

  it('arrête le gousset de semelle du poteau d’angle sous la platine de genou', () => {
    // 2 pignons × 2 mailles de rive × un pied et une tête sur le poteau d'angle.
    const surSemelle = goussets.filter((g) => !surAme(g, parId.get(g.porteur ?? '') as Member));
    expect(surSemelle).toHaveLength(8);
    for (const g of surSemelle) {
      const po = parId.get(g.porteur ?? '') as Member;
      const i = frameStations(DEFAULT_PROJECT.grid).findIndex((x) => Math.abs(x - po.start.x) < 1);
      const bas = basDePlatineDeGenou(DEFAULT_PROJECT, i, po.start.y < G.span / 2 ? 'gauche' : 'droite') as number;
      expect(Math.max(...g.outline.map((q) => point(g, q).z)), g.id).toBeLessThan(bas);
    }
  });

  it('arrête le tube au-delà de la tête de son dernier boulon', () => {
    for (const pl of plats) {
      const t = parId.get(pl.porteur ?? '') as Member;
      const f = memberFrame(t);
      const coupes = [t.cutStart, t.cutEnd].map((c) => fibreAbscissa(f, t.start, c, { y: 0, z: 0 }));
      for (const h of pl.holes) {
        const s = dot(sub(point(pl, h.at), t.start), f.ax);
        const hors = Math.max(Math.min(...coupes) - s, s - Math.max(...coupes));
        expect(hors, pl.id).toBeGreaterThan(0.9 * DEFAULT_PROJECT.connections.gusset.bolt.d + 10 - 0.01);
      }
    }
  });

  it('partage un gousset entre les deux brins d’une palée en K', () => {
    const k = buildProject({
      ...P,
      bracing: {
        ...P.bracing,
        roof: { ...P.bracing.roof, enabled: false },
        gable: { ...P.bracing.gable, enabled: false },
        wall: { ...P.bracing.wall, shape: 'k' },
      },
    });
    const gk = k.plates.filter((pl) => pl.kind === 'gousset-cv');
    // 2 travées × 2 long pans × (deux pieds de brin + le nœud commun).
    expect(gk).toHaveLength(12);
    expect(gk.filter((g) => g.holes.length === 4)).toHaveLength(4);
  });
});
