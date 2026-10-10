import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { buildFrameModel, chargerModele, currentFrameX, secondaryLoadKnM2 } from '../../analysis/frameModel';
import { combinaisonsSecondaires, combinations, intensities, type Combination } from '../../analysis/loadCases';
import { runChecks } from '../../checks/index';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { ridgeHeight, ridgeY, type GridParams } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import { chargesClimatiques, modeleDeCharges } from '../index';
import { coefficientsParoi } from '../vent';
import { casDeVent, cpePannes, ventSurPortique, type CasVent } from '../zonesVent';

/**
 * VENT PAR ZONES ET NEIGE DISSYMÉTRIQUE.
 *
 * ⚠ Les valeurs attendues sont celles des TABLEAUX de l'EN 1991-1-4 (7.1, 7.3,
 * 7.4a-b), moyennées à la main sur les zones de la figure 7.8 — jamais ce que
 * le code produit aujourd'hui.
 */

const cas = (id: string): CasVent => {
  const c = casDeVent().find((x) => x.id === id);
  if (!c) throw new Error(`cas ${id} absent`);
  return c;
};

/** Deux versants à 5° exactement, 20 × 48 m, égout à 6 m. */
const g5: GridParams = {
  ...DEFAULT_PROJECT.grid,
  roofType: 'bipente',
  slopeUnit: 'degres',
  slope: 5,
  slopeRight: 5,
  asymmetric: false,
  span: 20_000,
  eaveHeight: 6000,
  nBays: 8,
  baySpacing: 6000,
};
const h5 = ridgeHeight(g5) / 1000;
const e5 = Math.min(48, 2 * h5); // vent de travers : b = longueur

describe('cas de vent à examiner', () => {
  it('compte huit cas : travers dans les deux sens, pignon, chaque pression intérieure', () => {
    const tous = casDeVent();
    expect(tous).toHaveLength(8);
    expect(new Set(tous.map((c) => c.id)).size).toBe(8);
    expect(tous.filter((c) => c.incidence === 'travers' && c.sens > 0)).toHaveLength(3);
    expect(tous.filter((c) => c.incidence === 'travers' && c.sens < 0)).toHaveLength(3);
    expect(tous.filter((c) => c.incidence === 'pignon')).toHaveLength(2);
    expect(new Set(tous.map((c) => c.cpi))).toEqual(new Set([0.2, -0.3]));
  });
});

describe('vent de travers — tableaux 7.1 et 7.4a', () => {
  const paroi = coefficientsParoi(h5, 20);

  it('charge les DEUX long-pans : pression D au vent, succion E sous le vent', () => {
    const v = ventSurPortique(g5, cas('T+A0.2'), 18_000, 24_000);
    expect(v.murGauche).toBeCloseTo(paroi.D - 0.2, 6);
    expect(v.murDroit).toBeCloseTo(paroi.E - 0.2, 6);
  });

  it('zone la toiture : G sur e/10 à l’égout, H ensuite, J puis I sous le vent', () => {
    // Portique loin des pignons : pas d'angle F.
    const v = ventSurPortique(g5, cas('T+A0.2'), 18_000, 24_000);
    const t = e5 / 10;
    expect(v.toit(0, 10_000)).toBeCloseTo((t * -1.2 + (10 - t) * -0.6) / 10 - 0.2, 6);
    // À 5°, I et J valent tous deux −0,6.
    expect(v.toit(10_000, 20_000)).toBeCloseTo(-0.6 - 0.2, 6);
  });

  it('prend l’angle F pour le portique de rive, à moins de e/4 du pignon', () => {
    const v = ventSurPortique(g5, cas('T+A0.2'), 0, 3000);
    expect(3000).toBeLessThan((e5 / 4) * 1000);
    const t = e5 / 10;
    expect(v.toit(0, 10_000)).toBeCloseTo((t * -1.7 + (10 - t) * -0.6) / 10 - 0.2, 6);
  });

  it('examine aussi le versant au vent POUSSÉ, avec la dépression intérieure', () => {
    const v = ventSurPortique(g5, cas('T+P'), 18_000, 24_000);
    // À 5°, F, G et H valent +0,0 : seule la dépression intérieure presse.
    expect(v.toit(0, 10_000)).toBeCloseTo(0.3, 6);
    expect(v.toit(10_000, 20_000)).toBeCloseTo(-0.6 + 0.3, 6);
  });

  it('est symétrique : le vent inverse donne l’image miroir', () => {
    const a = ventSurPortique(g5, cas('T+A-0.3'), 18_000, 24_000);
    const b = ventSurPortique(g5, cas('T-A-0.3'), 18_000, 24_000);
    expect(b.murDroit).toBeCloseTo(a.murGauche, 9);
    expect(b.murGauche).toBeCloseTo(a.murDroit, 9);
    expect(b.toit(10_000, 20_000)).toBeCloseTo(a.toit(0, 10_000), 9);
    expect(b.toit(2000, 5000)).toBeCloseTo(a.toit(15_000, 18_000), 9);
  });
});

describe('vent sur pignon — tableau 7.4b', () => {
  const ep = Math.min(20, 2 * h5); // b = portée

  it('aspire toute la toiture et les deux long-pans loin du pignon : I et C', () => {
    const v = ventSurPortique(g5, cas('P0.2'), 30_000, 36_000);
    expect(30).toBeGreaterThan(ep);
    expect(v.toit(0, 10_000)).toBeCloseTo(-0.6 - 0.2, 6);
    expect(v.toit(10_000, 20_000)).toBeCloseTo(-0.6 - 0.2, 6);
    expect(v.murGauche).toBeCloseTo(-0.5 - 0.2, 6);
    expect(v.murDroit).toBeCloseTo(v.murGauche, 9);
  });

  it('prend A puis B sur les long-pans près du pignon au vent', () => {
    const v = ventSurPortique(g5, cas('P-0.3'), 0, 3000);
    const a = ep / 5;
    expect(v.murGauche).toBeCloseTo((a * -1.2 + (3 - a) * -0.8) / 3 + 0.3, 6);
  });

  it('interpole entre les pentes du tableau', () => {
    const g10: GridParams = { ...g5, slope: 10, slopeRight: 10 };
    const loin = ventSurPortique(g10, cas('P-0.3'), 36_000, 42_000);
    // I : −0,6 à 5°, −0,5 à 15°.
    expect(loin.toit(0, 10_000)).toBeCloseTo(-0.55 + 0.3, 6);
  });
});

describe('versant unique — tableau 7.3a', () => {
  const mono: GridParams = { ...g5, roofType: 'monopente' };

  it('aspire davantage quand le vent frappe l’égout HAUT (θ = 180°)', () => {
    const e = Math.min(48, (2 * ridgeHeight(mono)) / 1000);
    const v = ventSurPortique(mono, cas('T-A0.2'), 18_000, 24_000);
    // G −1,3 sur e/10 le long de l'égout haut (y = portée), H −0,8 au-delà.
    const t = e / 10;
    expect(v.toit(0, 20_000)).toBeCloseTo((t * -1.3 + (20 - t) * -0.8) / 20 - 0.2, 6);
  });

  it('donne aux pannes la rive G la plus aspirée des deux sens', () => {
    expect(cpePannes(g5)).toBeCloseTo(-1.2, 6);
    expect(cpePannes(mono)).toBeCloseTo(-1.3, 6);
  });
});

/* ------------------------------------------------------------------ */

describe('combinaisons avec cas de vent et neige dissymétrique', () => {
  const m = modeleDeCharges(DEFAULT_PROJECT);
  const vents = casDeVent();
  const combs = combinations(m, { vents, neiges: ['uniforme', 'reduitGauche', 'reduitDroite'] });

  it('fait de chaque cas de vent une action dominante, à l’ELU comme à l’ELS', () => {
    for (const v of vents) {
      expect(combs.some((c) => c.kind === 'ELU' && c.vent === v && c.factors.W === 1.5 && c.factors.G === 1.35)).toBe(true);
      expect(combs.some((c) => c.kind === 'ELS' && c.vent === v && c.factors.W === 1)).toBe(true);
    }
  });

  it('ne cherche le soulèvement 1,0 G + 1,5 W qu’avec les vents qui aspirent la toiture', () => {
    const soulevement = combs.filter((c) => c.factors.G === 1 && c.factors.W === 1.5);
    expect(soulevement.map((c) => c.vent?.id).sort()).toEqual(
      vents.filter((v) => v.versant === 'aspiration').map((v) => v.id).sort(),
    );
  });

  it('accompagne la neige dominante des seuls vents qui poussent la toiture', () => {
    const avecW = combs.filter((c) => c.factors.S === 1.5 && c.factors.W);
    expect(avecW.length).toBeGreaterThan(0);
    for (const c of avecW) expect(c.vent?.versant).toBe('pression');
  });

  it('examine la neige réduite de moitié sur chaque versant, et le dit', () => {
    for (const n of ['reduitGauche', 'reduitDroite'] as const) {
      for (const kind of ['ELU', 'ELS'] as const) {
        const c = combs.find((x) => x.kind === kind && x.neige === n);
        expect(c?.label).toContain('½');
      }
    }
  });

  it('garde les combinaisons d’avant en saisie manuelle : ni zones, ni dissymétrie', () => {
    for (const c of combinations(m)) {
      expect(c.vent).toBeUndefined();
      expect(c.neige).toBeUndefined();
    }
  });

  it('ne donne à l’ossature secondaire que des combinaisons distinctes', () => {
    const sec = combinaisonsSecondaires(combs);
    expect(sec.some((c) => c.neige)).toBe(false);
    const cles = sec.map((c) => `${c.kind}${JSON.stringify(c.factors)}`);
    expect(new Set(cles).size).toBe(cles.length);
    expect(sec.length).toBeLessThan(combs.length);
  });
});

/* ------------------------------------------------------------------ */

describe('transfert au portique', () => {
  const p: ProjectParams = { ...DEFAULT_PROJECT, site: { ...DEFAULT_PROJECT.site, mode: 'eurocode' } };
  const model = buildProject(p);
  const fm = { ...buildFrameModel(p, model, currentFrameX(p)), tributary: p.grid.baySpacing };
  const qp = chargesClimatiques(p).vent.qp;
  const q = intensities(modeleDeCharges(p), secondaryLoadKnM2(p, model), qp);
  const b = p.grid.baySpacing;
  const yr = ridgeY(p.grid);

  const seule = (extra: Partial<Combination>): Combination => ({
    id: 'essai',
    label: '',
    kind: 'ELS',
    factors: {},
    windDirection: 1,
    ...extra,
  });

  /** Résultante des charges réparties, en repère global (N). */
  const resultante = (comb: Combination, filtre: (i: number) => boolean = () => true): { y: number; z: number } => {
    const input = chargerModele(fm, p, q, comb);
    let y = 0;
    let z = 0;
    for (const [i, e] of input.elements.entries()) {
      if (!filtre(i)) continue;
      const seg = fm.segments[i] as { L: number; c: number; s: number };
      y += (e.qAxial * seg.c - e.qPerp * seg.s) * seg.L;
      z += (e.qAxial * seg.s + e.qPerp * seg.c) * seg.L;
    }
    return { y, z };
  };
  const milieu = (seg: { a: number; b: number }): number => ((fm.nodes[seg.a]?.y ?? 0) + (fm.nodes[seg.b]?.y ?? 0)) / 2;
  const hauteur = (gauche: boolean): number =>
    fm.segments.filter((s) => s.role === 'poteau' && milieu(s) < yr === gauche).reduce((t, s) => t + s.L * s.partDeCharge, 0);
  /**
   * Résultante attendue des pressions de toiture, débords compris : une
   * pression c (positive vers l'intérieur) sur un tronçon (dy, dz) pousse de
   * c·(dz·signe(dy), −|dy|), quelle que soit l'orientation du tronçon.
   */
  const toiture = (v: ReturnType<typeof ventSurPortique>): { y: number; z: number } => {
    let y = 0;
    let z = 0;
    for (const s of fm.segments.filter((x) => x.role === 'traverse' || x.role === 'console')) {
      const A = fm.nodes[s.a];
      const B = fm.nodes[s.b];
      if (!A || !B) continue;
      const c = v.toit(A.y, B.y) * s.partDeCharge;
      y += c * (B.z - A.z) * Math.sign(B.y - A.y);
      z -= c * Math.abs(B.y - A.y);
    }
    return { y, z };
  };

  it('pousse le portique de la somme des deux long-pans et de la toiture', () => {
    for (const c of casDeVent().filter((x) => x.incidence === 'travers')) {
      const v = ventSurPortique(p.grid, c, b / 2, (3 * b) / 2);
      const t = toiture(v);
      // qp en kN/m² = 1e-3 N/mm².
      const attendu = (qp / 1000) * b * (v.murGauche * hauteur(true) - v.murDroit * hauteur(false) + t.y);
      const r = resultante(seule({ factors: { W: 1 }, windDirection: c.sens, vent: c }));
      expect(r.y).toBeCloseTo(attendu, 3);
      expect(r.z).toBeCloseTo((qp / 1000) * b * t.z, 3);
      // Le vent souffle dans son sens : la résultante le suit.
      expect(Math.sign(r.y)).toBe(c.sens);
    }
  });

  it('soulève sans pousser sous vent de pignon', () => {
    for (const c of casDeVent().filter((x) => x.incidence === 'pignon')) {
      const v = ventSurPortique(p.grid, c, b / 2, (3 * b) / 2);
      const r = resultante(seule({ factors: { W: 1 }, vent: c }));
      expect(Math.abs(r.y)).toBeLessThan(1e-6 * Math.abs(r.z));
      expect(r.z).toBeCloseTo((qp / 1000) * b * toiture(v).z, 3);
      expect(r.z).toBeGreaterThan(0);
    }
  });

  it('ne met que la moitié de la neige sur le versant réduit', () => {
    const gauche = (i: number): boolean => {
      const s = fm.segments[i];
      return s !== undefined && s.role === 'traverse' && ((fm.nodes[s.a]?.y ?? 0) + (fm.nodes[s.b]?.y ?? 0)) / 2 < yr;
    };
    const droite = (i: number): boolean => fm.segments[i]?.role === 'traverse' && !gauche(i);
    const comb = seule({ factors: { S: 1 }, neige: 'reduitGauche' });
    expect(resultante(comb, gauche).z / resultante(comb, droite).z).toBeCloseTo(0.5, 6);
  });

  it('arrive au rapport : cas de vent dans les combinaisons, zonage dans les hypothèses', () => {
    const r = runChecks(p, model);
    expect(r.combinations.filter((c) => c.vent).length).toBeGreaterThanOrEqual(16);
    expect(r.hypotheses.some((h) => h.includes('PAR ZONES'))).toBe(true);
    expect(runChecks(DEFAULT_PROJECT, buildProject(DEFAULT_PROJECT)).combinations.some((c) => c.vent)).toBe(false);
  });
});
