import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import { runChecks } from '../../checks/index';
import { kFlambementPlan } from '../../checks/buckling';
import { horsDomaineSecondOrdre } from '../../checks/types';
import { solveFrame2d } from '../frame2d';
import { buildFrameModel, chargerModele, currentFrameX, secondaryLoadKnM2 } from '../frameModel';
import { combinations, intensities } from '../loadCases';
import { classer, defautAplomb, sensibilite } from '../secondOrdre';

/**
 * IMPERFECTIONS ET SECOND ORDRE.
 *
 * ⚠ Ce module a RELÂCHÉ une hypothèse : les poteaux passaient d'une longueur de
 * flambement de 2,0 × hauteur à 1,0 × hauteur dès que l'ossature est classée à
 * nœuds fixes. Un allègement se vérifie plus sévèrement qu'un renforcement — il
 * faut prouver que la classification MORD, c'est-à-dire qu'une ossature souple
 * est bien détectée et retombe sur le traitement conservatif.
 */

const P = DEFAULT_PROJECT;

function modele(p: ProjectParams): ReturnType<typeof buildFrameModel> & { tributary: number } {
  const m = buildProject(p);
  return { ...buildFrameModel(p, m, currentFrameX(p)), tributary: p.grid.baySpacing };
}

function premierCas(p: ProjectParams): ReturnType<typeof chargerModele> {
  const m = buildProject(p);
  const fm = modele(p);
  const q = intensities(p.loads, secondaryLoadKnM2(p, m));
  const comb = combinations(p.loads).find((c) => c.id === 'ELU-1');
  return chargerModele(fm, p, q, comb as NonNullable<typeof comb>);
}

describe('défaut d’aplomb — EN 1993-1-1 § 5.3.2', () => {
  it('part de φ0 = 1/200 et le réduit, jamais l’inverse', () => {
    for (const [h, n] of [
      [3000, 2],
      [6000, 2],
      [12000, 6],
    ] as const) {
      const phi = defautAplomb(h, n);
      expect(phi, `h=${h} n=${n}`).toBeLessThanOrEqual(1 / 200);
      expect(phi).toBeGreaterThan(1 / 400);
    }
  });

  it('décroît avec la hauteur puis se stabilise à 2/3', () => {
    /*
     * αh = 2/√h borné à [2/3, 1]. Un bâtiment de 4 m n'a aucune réduction ;
     * au-delà de 9 m la réduction est plafonnée. Retenir φ0 brut surestimerait
     * les moments d'imperfection de 40 % sur un portique courant.
     */
    expect(defautAplomb(4000, 2)).toBeGreaterThan(defautAplomb(9000, 2));
    expect(defautAplomb(9000, 2)).toBeCloseTo(defautAplomb(25_000, 2), 12);
  });

  it('décroît avec le nombre de poteaux : les défauts ne se cumulent pas tous', () => {
    expect(defautAplomb(6000, 2)).toBeGreaterThan(defautAplomb(6000, 8));
  });
});

describe('αcr — EN 1993-1-1 § 5.2.1(4)B', () => {
  it('vaut k·h/V, la raideur latérale mesurée indépendamment', () => {
    /*
     * ⚠ Contrôle de PREMIER PRINCIPE : on remesure la raideur latérale du
     * portique en le poussant nous-mêmes, et on recompose αcr à la main. Un
     * αcr cohérent avec lui-même mais faux ne passerait pas ici.
     */
    const fm = modele(P);
    const input = premierCas(P);
    const s = sensibilite(fm, input);

    // Têtes de poteaux : le nœud le plus haut au droit de chaque appui.
    const tetes = [...input.supports.keys()].map((i) => {
      const yA = fm.nodes[i]?.y ?? 0;
      let best = i;
      let zMax = fm.nodes[i]?.z ?? 0;
      for (const [j, n] of fm.nodes.entries()) {
        if (Math.abs(n.y - yA) < 1 && n.z > zMax) {
          zMax = n.z;
          best = j;
        }
      }
      return best;
    });

    const H = 10_000;
    const res = solveFrame2d({
      nodes: input.nodes,
      elements: input.elements.map((e) => ({ ...e, qPerp: 0, qAxial: 0 })),
      supports: input.supports,
      nodalLoads: new Map(tetes.map((n) => [n, [H / tetes.length, 0, 0] as const])),
    });
    const delta = Math.max(...tetes.map((n) => Math.abs(res.d[3 * n] ?? 0)));
    const k = H / delta;

    let vertical = 0;
    for (const [i, e] of input.elements.entries()) {
      const seg = fm.segments[i] as { L: number; c: number; s: number };
      vertical -= (e.qAxial * seg.s + e.qPerp * seg.c) * seg.L;
    }
    const hauteur = P.grid.eaveHeight;

    expect((k * hauteur) / vertical).toBeCloseTo(s.alphaCr, 1);
  });

  it('est INVERSEMENT proportionnel à la charge verticale', () => {
    /*
     * ⚠ Invariant physique, et pas seulement numérique : αcr est le facteur par
     * lequel il faudrait multiplier les charges pour atteindre l'instabilité.
     * Doubler la charge rapproche donc l'ossature du flambement d'exactement un
     * facteur deux. Un αcr qui resterait constant sous charge doublée ne
     * mesurerait pas ce qu'il prétend mesurer.
     */
    const fm = modele(P);
    const input = premierCas(P);
    const double = {
      ...input,
      elements: input.elements.map((e) => ({ ...e, qPerp: e.qPerp * 2, qAxial: e.qAxial * 2 })),
    };
    const simple = sensibilite(fm, input).alphaCr;
    expect(sensibilite(fm, double).alphaCr).toBeCloseTo(simple / 2, 6);
  });

  it('raidit nettement le portique quand on encastre les pieds', () => {
    const encastre: ProjectParams = { ...P, frame: { ...P.frame, baseFixity: 'encastre' } };
    const a = sensibilite(modele(P), premierCas(P)).alphaCr;
    const b = sensibilite(modele(encastre), premierCas(encastre)).alphaCr;
    expect(b, `articulé ${a.toFixed(1)} → encastré ${b.toFixed(1)}`).toBeGreaterThan(a * 3);
  });

  it('rend αcr infini sous soulèvement : rien ne déstabilise une ossature tirée vers le haut', () => {
    /*
     * Sous « 1,00 G + 1,50 W », la résultante verticale est NÉGATIVE : le vent
     * arrache la toiture. Il n'y a alors aucune charge gravitaire à amplifier,
     * et le second ordre ne joue pas. Rendre un αcr fini y serait un artefact.
     */
    const m = buildProject(P);
    const fm = modele(P);
    const q = intensities(P.loads, secondaryLoadKnM2(P, m));
    const uplift = combinations(P.loads).find((c) => c.factors.G === 1 && c.factors.W === 1.5);
    expect(uplift).toBeDefined();
    const s = sensibilite(fm, chargerModele(fm, P, q, uplift as NonNullable<typeof uplift>));
    expect(s.alphaCr).toBe(Infinity);
    expect(s.amplification).toBe(1);
  });
});

describe('classification et conséquences', () => {
  it('classe le portique par défaut à NŒUDS FIXES', () => {
    const s = sensibilite(modele(P), premierCas(P));
    expect(s.classe, `αcr = ${s.alphaCr.toFixed(1)}`).toBe('rigide');
    expect(s.amplification).toBe(1);
  });

  it('DÉTECTE une ossature souple et lui rend le traitement conservatif', () => {
    /*
     * ⚠ Le test qui justifie tout l'allègement. Un portique haut sur poteaux
     * grêles est réellement déplaçable : s'il ressortait « rigide », le passage
     * de Lcr = 2h à 1h serait un cadeau injustifié.
     */
    const souple: ProjectParams = {
      ...P,
      grid: { ...P.grid, eaveHeight: 12_000, span: 30_000 },
      frame: { ...P.frame, columnProfile: 'IPE 200', rafterProfile: 'IPE 220' },
    };
    const s = sensibilite(modele(souple), premierCas(souple));
    expect(s.classe, `αcr = ${s.alphaCr.toFixed(2)}`).not.toBe('rigide');
    expect(s.alphaCr).toBeLessThan(10);

    // Et la longueur de flambement suit le classement, dans les deux sens.
    expect(kFlambementPlan('articule', 'poteau', 'rigide')).toBe(1);
    expect(kFlambementPlan('articule', 'poteau', 'instable')).toBe(2);
    expect(kFlambementPlan('encastre', 'poteau', 'instable')).toBe(1.5);
  });

  it('amplifie selon 1/(1−1/αcr), et seulement pour 3 ≤ αcr < 10', () => {
    /*
     * ⚠ Ce test recopiait la formule au lieu d'appeler le code : il passait
     * pendant que `sensibilite` amplifiait dès αcr > 1 — un facteur 2 à αcr = 2,
     * sans aucune validité normative (EN 1993-1-1 § 5.2.2(6)B).
     */
    const cas: [number, 'rigide' | 'souple' | 'instable', number][] = [
      [Infinity, 'rigide', 1],
      [20, 'rigide', 1],
      [10, 'rigide', 1],
      [9.99, 'souple', 1 / (1 - 1 / 9.99)],
      [5, 'souple', 1.25],
      [3, 'souple', 1.5],
      [2.99, 'instable', 1],
      [2, 'instable', 1],
      [1.5, 'instable', 1],
      [0.5, 'instable', 1],
      [0, 'instable', 1],
    ];
    for (const [alphaCr, classe, amplification] of cas) {
      const c = classer(alphaCr);
      expect(c.classe, `αcr = ${alphaCr}`).toBe(classe);
      expect(c.amplification, `αcr = ${alphaCr}`).toBeCloseTo(amplification, 12);
    }
  });

  it('inscrit αcr et l’imperfection dans les hypothèses du rapport', () => {
    /*
     * ⚠ Un résultat de calcul sans ses hypothèses n'est pas vérifiable. Le
     * lecteur doit savoir que la longueur de flambement vient d'un CLASSEMENT et
     * non d'un forfait — c'est ce qui lui permet de contester le résultat.
     */
    const h = runChecks(P, buildProject(P)).hypotheses.join('\n');
    expect(h).toMatch(/αcr/);
    expect(h).toMatch(/nœuds fixes/);
    expect(h).toMatch(/[Ii]mperfection d’aplomb/);
  });
});

describe('αcr < 3 : l’absence de second ordre est DITE, pas compensée', () => {
  /*
   * Une ferme ne tient les poteaux que par ses membrures : sur pieds articulés,
   * le portique par défaut tombe sous αcr = 3. C'est le cas réel où un facteur
   * 1/(1 − 1/αcr) ≈ 1,9 était appliqué sans validité normative.
   */
  const ferme: ProjectParams = { ...P, truss: { ...P.truss, enabled: true } };

  function pireSensibilite(p: ProjectParams): ReturnType<typeof sensibilite> {
    const m = buildProject(p);
    const fm = modele(p);
    const q = intensities(p.loads, secondaryLoadKnM2(p, m));
    return combinations(p.loads)
      .map((c) => sensibilite(fm, chargerModele(fm, p, q, c)))
      .reduce((a, b) => (b.alphaCr < a.alphaCr ? b : a));
  }

  it('garde les efforts au premier ordre entre 1 et 3', () => {
    const s = pireSensibilite(ferme);
    // Le cas doit bien tomber dans la plage fautive, sans quoi le test ne prouve rien.
    expect(s.alphaCr).toBeGreaterThan(1);
    expect(s.alphaCr).toBeLessThan(3);
    expect(s.classe).toBe('instable');
    expect(s.amplification).toBe(1);
  });

  it('le rapport déclare l’ossature hors domaine, en tête et sur chaque barre du portique', () => {
    const r = runChecks(ferme, buildProject(ferme));
    expect(r.secondOrdre?.classe).toBe('instable');

    const message = horsDomaineSecondOrdre(r);
    expect(message).not.toBeNull();
    expect(message).toMatch(/αcr = \d+,\d/);
    expect(message).toMatch(/second ordre/);

    const poteaux = r.lines.filter((l) => l.role === 'poteau');
    expect(poteaux.length).toBeGreaterThan(0);
    for (const l of poteaux) {
      expect(l.avertissements.join('\n'), l.mark).toMatch(/premier ordre/);
    }
    expect(r.hypotheses.join('\n')).toMatch(/premier ordre/);
  });

  it('ne dit rien de tel sur une ossature dans le domaine', () => {
    const r = runChecks(P, buildProject(P));
    expect(r.secondOrdre?.classe).toBe('rigide');
    expect(horsDomaineSecondOrdre(r)).toBeNull();
    for (const l of r.lines) {
      expect(l.avertissements.join('\n'), l.mark).not.toMatch(/premier ordre/);
    }
  });
});
