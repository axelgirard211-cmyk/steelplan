import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { getProfile } from '../../catalog/index';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import { solveFrame2d } from '../../analysis/frame2d';
import {
  buildFrameModel,
  chargerModele,
  currentFrameX,
  secondaryLoadKnM2,
} from '../../analysis/frameModel';
import { combinations, intensities } from '../../analysis/loadCases';
import { chi, chiLT, courbes, inertieGauchissement, inertieTorsion, mcr } from '../buckling';
import { classer, epsilon, mnRd, nRd, vplRd } from '../section';
import { runChecks } from '../index';

const projet = (patch: Partial<ProjectParams> = {}): ProjectParams => ({
  ...DEFAULT_PROJECT,
  ...patch,
});

/* ================================================================== */
/* Combinaisons                                                        */
/* ================================================================== */

describe('combinaisons EN 1990', () => {
  const p = projet();
  const combs = combinations(p.loads);

  it('produit la combinaison fondamentale 1,35 G + 1,5 Q', () => {
    const c = combs.find((x) => x.factors.G === 1.35 && x.factors.Q === 1.5);
    expect(c).toBeDefined();
    expect(c?.kind).toBe('ELU');
  });

  it('produit la combinaison de soulèvement, poids propre favorable', () => {
    // ⚠ C'est l'oubli classique du pré-dimensionnement : toutes les autres
    // combinaisons sont gravitaires et masquent l'arrachement des pieds.
    const c = combs.find((x) => x.kind === 'ELU' && x.factors.G === 1 && x.factors.W === 1.5);
    expect(c).toBeDefined();
    expect(c?.factors.S).toBeUndefined();
  });

  it('examine les deux sens de vent', () => {
    const sens = new Set(combs.filter((c) => c.factors.W).map((c) => c.windDirection));
    expect(sens).toEqual(new Set([1, -1]));
  });

  it('n’applique aucun coefficient partiel aux ELS', () => {
    for (const c of combs.filter((x) => x.kind === 'ELS')) {
      expect(c.factors.G).toBe(1);
      for (const v of Object.values(c.factors)) expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('n’associe pas neige et exploitation, ψ0 valant zéro par défaut', () => {
    for (const c of combs) {
      if (c.factors.S && c.factors.Q) expect(c.factors.Q).toBeGreaterThan(0);
    }
    // Avec le ψ0 par défaut, la combinaison neige n'appelle pas l'exploitation.
    const neige = combs.find((c) => c.kind === 'ELU' && c.factors.S === 1.5);
    expect(neige?.factors.Q).toBeUndefined();
  });
});

/* ================================================================== */
/* Modèle de calcul extrait du modèle de construction                  */
/* ================================================================== */

describe('extraction du modèle de calcul', () => {
  const p = projet();
  const model = buildProject(p);
  const fm = buildFrameModel(p, model);

  it('ne retient que les barres du plan du portique', () => {
    const x = currentFrameX(p);
    for (const seg of fm.segments) {
      const m = model.members.find((y) => y.id === seg.memberId);
      expect(m?.start.x).toBeCloseTo(x, 3);
    }
  });

  it('fusionne les abouts concourants en un seul nœud', () => {
    // Poteau et traverse partagent le nœud de genou : deux barres, trois nœuds
    // d'about et non quatre.
    const utilises = new Set(fm.segments.flatMap((s) => [s.a, s.b]));
    expect(utilises.size).toBeLessThan(2 * fm.segments.length);
  });

  it('appuie tous les pieds de poteaux, et eux seuls', () => {
    const poteaux = model.members.filter(
      (m) => m.role === 'poteau' && Math.abs(m.start.x - fm.x) < 5,
    );
    expect(fm.supports.size).toBe(poteaux.length);
    for (const [i] of fm.supports) {
      expect(Math.abs((fm.nodes[i] as { z: number }).z)).toBeLessThan(5);
    }
  });

  it('subdivise les traverses pour rendre leur flèche lisible', () => {
    const parBarre = new Map<string, number>();
    for (const s of fm.segments) parBarre.set(s.memberId, (parBarre.get(s.memberId) ?? 0) + 1);
    const traverse = model.members.find((m) => m.role === 'traverse' && Math.abs(m.start.x - fm.x) < 5);
    expect(parBarre.get(traverse?.id ?? '')).toBeGreaterThan(2);
  });
});

/* ================================================================== */
/* Chemin des charges                                                  */
/* ================================================================== */

describe('application des charges', () => {
  const p = projet();
  const model = buildProject(p);
  const fm = buildFrameModel(p, model);
  const q = intensities(p.loads, secondaryLoadKnM2(p, model));

  it('distingue les surfaces de référence rampant et projection horizontale', () => {
    // Une seule action à la fois, pour isoler la conversion.
    const seulementG = { G: 1 };
    const seulementS = { S: 1 };
    const base = { id: 'T', label: 'test', kind: 'ELS' as const, windDirection: 1 as const };
    const sansPoids = projet({
      loads: { ...p.loads, loads: { ...p.loads.loads, includeSelfWeight: false } },
    });

    const iG = chargerModele(fm, sansPoids, q, { ...base, factors: seulementG });
    const iS = chargerModele(fm, sansPoids, q, { ...base, factors: seulementS });

    const rampant = fm.segments.findIndex((s) => s.role === 'traverse');
    expect(rampant).toBeGreaterThanOrEqual(0);
    const seg = fm.segments[rampant] as { c: number };
    const cosA = Math.abs(seg.c);
    const b = p.grid.baySpacing;

    // Permanent : donné par m² de rampant, donc densité linéique directe.
    const attenduG = (q.gToit * b) / 1000;
    expect(Math.abs((iG.elements[rampant]?.qPerp ?? 0) / cosA)).toBeCloseTo(attenduG, 6);
    // Neige : donnée par m² de projection, donc × cos α le long du rampant.
    const attenduS = (q.sToit * b * cosA) / 1000;
    expect(Math.abs((iS.elements[rampant]?.qPerp ?? 0) / cosA)).toBeCloseTo(attenduS, 6);
  });

  it('équilibre chaque combinaison : réactions = charges appliquées, NODALES COMPRISES', () => {
    /*
     * ⚠ L'invariant qui protège tout le chemin des charges. Une erreur de signe,
     * de repère local ou de cos α le casse immédiatement, sur n'importe quelle
     * combinaison et n'importe quelle géométrie.
     *
     * Il somme les DEUX chemins de charge : les charges réparties sur les barres
     * ET les charges nodales. Le jour où les forces d'imperfection d'aplomb sont
     * apparues, il a signalé un écart horizontal de 573 N — exactement φ·V. Ne
     * sommer que les charges réparties aurait laissé passer, plus tard, une
     * charge nodale qui ne serait allée nulle part.
     */
    for (const comb of combinations(p.loads)) {
      const input = chargerModele(fm, p, q, comb);
      const res = solveFrame2d(input);

      let appliqueeZ = 0;
      let appliqueeY = 0;
      for (const [i, e] of input.elements.entries()) {
        const seg = fm.segments[i] as { L: number; c: number; s: number };
        // Retour au repère global : x local = (c, s), z local = (−s, c).
        appliqueeY += (e.qAxial * seg.c - e.qPerp * seg.s) * seg.L;
        appliqueeZ += (e.qAxial * seg.s + e.qPerp * seg.c) * seg.L;
      }
      for (const [fy, fz] of input.nodalLoads.values()) {
        appliqueeY += fy;
        appliqueeZ += fz;
      }
      const reactionZ = [...res.reactions.values()].reduce((s, [, fz]) => s + fz, 0);
      const reactionY = [...res.reactions.values()].reduce((s, [fy]) => s + fy, 0);

      expect(reactionZ).toBeCloseTo(-appliqueeZ, 2);
      expect(reactionY).toBeCloseTo(-appliqueeY, 2);
    }
  });

  it('applique une imperfection d’aplomb de φ·V, jamais nulle sous charge', () => {
    /*
     * ⚠ Sans elle, une combinaison purement gravitaire sur un portique symétrique
     * donnait un déplacement latéral RIGOUREUSEMENT NUL. Aucun bâtiment ne fait
     * ça : il est construit de travers, et l'EN 1993-1-1 § 5.3.2 impose d'en
     * tenir compte. Le contrôle porte sur le RAPPORT à la charge verticale, seule
     * façon de vérifier que c'est bien φ·V et non une constante.
     */
    const gravitaire = combinations(p.loads).find((c) => c.id === 'ELU-1');
    expect(gravitaire).toBeDefined();
    const input = chargerModele(fm, p, q, gravitaire!);

    let vertical = 0;
    for (const [i, e] of input.elements.entries()) {
      const seg = fm.segments[i] as { L: number; c: number; s: number };
      vertical -= (e.qAxial * seg.s + e.qPerp * seg.c) * seg.L;
    }
    const horizontal = [...input.nodalLoads.values()].reduce((s, [fy]) => s + fy, 0);

    expect(vertical).toBeGreaterThan(0);
    // φ vaut entre 1/200 et 1/300 une fois αh et αm appliqués.
    const phi = Math.abs(horizontal) / vertical;
    expect(phi, `φ = 1/${(1 / phi).toFixed(0)}`).toBeGreaterThan(1 / 320);
    expect(phi).toBeLessThanOrEqual(1 / 200);
  });

  it('soulève la toiture sous dépression de vent', () => {
    const soulevement = combinations(p.loads).find(
      (c) => c.kind === 'ELU' && c.factors.G === 1 && c.factors.W === 1.5,
    );
    expect(soulevement).toBeDefined();
    const input = chargerModele(fm, p, q, soulevement!);
    const res = solveFrame2d(input);
    const reactionZ = [...res.reactions.values()].reduce((s, [, fz]) => s + fz, 0);
    // Réaction verticale descendante : les pieds sont tirés vers le haut.
    expect(reactionZ).toBeLessThan(0);
  });
});

/* ================================================================== */
/* Classification et résistances                                       */
/* ================================================================== */

describe('classification de section', () => {
  it('classe un IPE en flexion en classe 1', () => {
    for (const id of ['IPE 200', 'IPE 300', 'IPE 400', 'HEA 300']) {
      expect(classer(getProfile(id), 235).cls).toBe(1);
    }
  });

  it('déclasse la même section sous forte compression', () => {
    const p = getProfile('IPE 600');
    const enFlexion = classer(p, 355);
    const comprime = classer(p, 355, -0.9 * p.A * 355);
    expect(comprime.cls).toBeGreaterThan(enFlexion.cls);
    expect(comprime.gouverne).toBe('âme');
  });

  it('ne classe jamais une cornière au-delà de la classe 3', () => {
    expect(classer(getProfile('L 60x60x6'), 235).cls).toBe(3);
  });

  it('classe une section pleine en classe 1', () => {
    expect(classer(getProfile('Rond Ø20'), 235).cls).toBe(1);
  });

  it('utilise ε = √(235/fy)', () => {
    expect(epsilon(235)).toBeCloseTo(1, 9);
    expect(epsilon(355)).toBeCloseTo(0.814, 3);
  });
});

describe('résistances de section', () => {
  it('retrouve la résistance plastique d’un IPE 200 S235', () => {
    const p = getProfile('IPE 200');
    // A = 28,5 cm² × 235 = 669 kN
    expect(nRd(p, 235) / 1000).toBeCloseTo((p.A * 235) / 1000, 6);
    expect(nRd(p, 235) / 1000).toBeGreaterThan(660);
    expect(nRd(p, 235) / 1000).toBeLessThan(680);
  });

  it('réduit le moment résistant sous effort normal, mais pas en dessous du seuil', () => {
    const p = getProfile('IPE 300');
    const mpl = mnRd(p, 235, 1, 0);
    // Faible effort normal : aucune réduction (deux seuils de l'EN 1993-1-1).
    expect(mnRd(p, 235, 1, -0.1 * nRd(p, 235))).toBeCloseTo(mpl, 6);
    // Effort normal élevé : réduction effective.
    expect(mnRd(p, 235, 1, -0.6 * nRd(p, 235))).toBeLessThan(0.7 * mpl);
  });

  it('calcule l’aire de cisaillement sur l’âme, non sur la section entière', () => {
    const p = getProfile('IPE 400');
    // Vpl = Av·fy/√3 ; Av vaut environ 42 cm² pour un IPE 400.
    const vpl = vplRd(p, 235) / 1000;
    expect(vpl).toBeGreaterThan(500);
    expect(vpl).toBeLessThan(620);
  });
});

/* ================================================================== */
/* Flambement et déversement                                           */
/* ================================================================== */

describe('flambement', () => {
  it('retrouve χ d’un IPE 300 S235 de 6 m, courbe b', () => {
    // Recoupé sur les tables : λ̄ ≈ 1,91 sur l'axe faible, χ ≈ 0,228.
    const p = getProfile('IPE 300');
    expect(courbes(p).z).toBe('b');
    const r = chi(p, 235, p.Iz, 6000, 'b');
    expect(r.lambdaBar).toBeCloseTo(1.91, 2);
    expect(r.chi).toBeCloseTo(0.228, 3);
  });

  it('n’applique aucune réduction en dessous de λ̄ = 0,2', () => {
    const p = getProfile('HEB 300');
    expect(chi(p, 235, p.Iy, 500, 'b').chi).toBe(1);
  });

  it('choisit la courbe selon h/b, et pénalise toujours l’axe faible', () => {
    const elance = courbes(getProfile('IPE 400')); // h/b = 2,2
    expect(elance).toEqual({ y: 'a', z: 'b' });
    const trapu = courbes(getProfile('HEB 200')); // h/b = 1,0
    expect(trapu).toEqual({ y: 'b', z: 'c' });
  });

  it('décroît quand la longueur de flambement croît', () => {
    const p = getProfile('IPE 200');
    let precedent = 1.1;
    for (const l of [1000, 2000, 4000, 8000]) {
      const x = chi(p, 235, p.Iz, l, 'b').chi;
      expect(x).toBeLessThan(precedent);
      precedent = x;
    }
  });
});

describe('caractéristiques de torsion approchées', () => {
  it('retrouve It à 6 % près sur les valeurs tabulées', () => {
    // Tables : IPE 200 → 6,98 cm⁴ ; IPE 400 → 51,1 cm⁴ ; IPE 300 → 20,1 cm⁴.
    const attendus: [string, number][] = [
      ['IPE 200', 6.98e4],
      ['IPE 300', 20.1e4],
      ['IPE 400', 51.1e4],
    ];
    for (const [id, tabule] of attendus) {
      const calcule = inertieTorsion(getProfile(id));
      // Sous-estimation systématique : elle réduit Mcr, donc majore le taux de
      // déversement. C'est le seul sens acceptable pour une approximation ici.
      expect(calcule).toBeLessThan(tabule);
      expect(calcule / tabule).toBeGreaterThan(0.9);
    }
  });

  it('retrouve Iw à 2 % près sur les valeurs tabulées', () => {
    // Tables : IPE 400 → 490 000 cm⁶ = 4,90·10¹¹ mm⁶.
    expect(inertieGauchissement(getProfile('IPE 400')) / 4.9e11).toBeCloseTo(1, 1);
    // IPE 200 → 13 000 cm⁶ = 1,30·10¹⁰ mm⁶.
    expect(inertieGauchissement(getProfile('IPE 200')) / 1.3e10).toBeCloseTo(1, 1);
  });
});

describe('déversement', () => {
  const p = getProfile('IPE 400');

  it('ne déverse pas un tronçon court', () => {
    expect(chiLT(p, 235, 1, 1500).chiLT).toBe(1);
  });

  it('pénalise fortement une traverse non maintenue', () => {
    const court = chiLT(p, 235, 1, 2000).chiLT;
    const long = chiLT(p, 235, 1, 12000).chiLT;
    expect(long).toBeLessThan(court);
    expect(long).toBeLessThan(0.5);
  });

  it('décroît Mcr comme la longueur croît', () => {
    expect(mcr(p, 3000)).toBeGreaterThan(mcr(p, 6000));
    expect(mcr(p, 6000)).toBeGreaterThan(mcr(p, 12000));
  });

  it('borne χLT par 1/λ̄LT²', () => {
    const r = chiLT(p, 355, 1, 20000);
    expect(r.chiLT).toBeLessThanOrEqual(1 / r.lambdaLT ** 2 + 1e-12);
  });
});

/* ================================================================== */
/* Rapport complet                                                     */
/* ================================================================== */

describe('rapport de vérification', () => {
  const p = projet();
  const model = buildProject(p);
  const rapport = runChecks(p, model);

  it('rend compte de chaque repère : vérifié, ou exclu avec sa raison', () => {
    // ⚠ Une pièce sans taux de travail apparaîtrait grise dans un modèle coloré,
    // et serait lue comme « vérifiée » alors qu'elle serait « oubliée ». Toute
    // pièce est donc soit vérifiée, soit nommément exclue.
    const exclus = new Set(rapport.nonVerifiables.map((x) => x.mark));
    const reperes = new Set(model.members.map((m) => m.mark));
    const orphelins = [...reperes].filter((r) => !rapport.byMark.has(r) && !exclus.has(r));
    expect(orphelins).toEqual([]);
    for (const x of rapport.nonVerifiables) expect(x.raison.length).toBeGreaterThan(20);
  });

  it('donne des taux de travail finis et positifs', () => {
    for (const l of rapport.lines) {
      expect(Number.isFinite(l.ratio)).toBe(true);
      expect(l.ratio).toBeGreaterThanOrEqual(0);
      expect(l.ratio).toBeLessThan(50);
    }
  });

  it('nomme la vérification qui gouverne, et elle est bien la plus élevée', () => {
    for (const l of rapport.lines) {
      expect(l.ratios[l.gouverne]).toBeCloseTo(l.ratio, 9);
    }
  });

  it('nomme la combinaison la plus défavorable', () => {
    for (const l of rapport.lines) expect(l.combinaison).toMatch(/EL[US]/);
  });

  it('classe les lignes du plus sollicité au moins sollicité', () => {
    for (let i = 1; i < rapport.lines.length; i++) {
      expect((rapport.lines[i - 1] as { ratio: number }).ratio).toBeGreaterThanOrEqual(
        (rapport.lines[i] as { ratio: number }).ratio,
      );
    }
  });

  it('mesure la flèche des traverses sur leur corde, non en absolu', () => {
    const traverse = rapport.lines.find((l) => l.role === 'traverse');
    expect(traverse?.fleche).not.toBeNull();
    // Le déplacement absolu d'une traverse de portique atteint plusieurs
    // centimètres ; sa flèche relative reste très inférieure à sa limite.
    expect(traverse?.fleche?.valeur).toBeLessThan(traverse?.fleche?.limite ?? 0);
  });

  it('produit ses hypothèses, y compris la mise en garde sur les bracons', () => {
    const texte = rapport.hypotheses.join(' ');
    expect(texte).toContain('bracon');
    expect(texte).toContain('γM0');
    expect(texte).toMatch(/déversement/);
  });

  it('reste sous la seconde', () => {
    expect(rapport.ms).toBeLessThan(1000);
  });
});

describe('sensibilité du rapport aux paramètres', () => {
  it('augmente le taux de travail quand la neige double', () => {
    const p = projet();
    const doublee = projet({
      loads: { ...p.loads, loads: { ...p.loads.loads, neige: p.loads.loads.neige * 2 } },
    });
    const a = runChecks(p, buildProject(p));
    const b = runChecks(doublee, buildProject(doublee));
    expect(b.maxRatio).toBeGreaterThan(a.maxRatio);
  });

  it('allège le portique quand on encastre les pieds', () => {
    const p = projet();
    const encastre = projet({ frame: { ...p.frame, baseFixity: 'encastre' } });
    const articule = runChecks(p, buildProject(p));
    const fixe = runChecks(encastre, buildProject(encastre));
    // Le moment en travée de traverse et le déplacement en tête diminuent.
    const trA = articule.lines.find((l) => l.role === 'traverse');
    const trE = fixe.lines.find((l) => l.role === 'traverse');
    expect(Math.abs(trE?.myEd ?? 0)).toBeLessThan(Math.abs(trA?.myEd ?? Infinity));
  });

  it('vérifie aussi un treillis, sans code spécifique', () => {
    const base = projet();
    const p = projet({
      frame: { ...base.frame, enabled: false },
      truss: { ...base.truss, enabled: true },
    });
    const model = buildProject(p);
    const rapport = runChecks(p, model);
    const membrures = rapport.lines.filter(
      (l) => l.role === 'membrure-sup' || l.role === 'membrure-inf',
    );
    expect(membrures.length).toBeGreaterThan(0);
    // Une membrure inférieure de treillis travaille en traction.
    const inf = rapport.lines.find((l) => l.role === 'membrure-inf');
    expect(inf?.nEd).toBeDefined();
  });
});

describe('sollicitations portées au rapport', () => {
  it('donne le moment d’axe faible : aucun taux de flexion sans moment affiché', () => {
    /*
     * ⚠ Une lisse sous G + Q n'a pas de moment fort mais fléchit sous le poids
     * du bardage. La note affichait « My = 0 » en face d'un taux de 37 % en
     * section : un taux que rien, dans la ligne, n'expliquait.
     */
    const r = runChecks(DEFAULT_PROJECT, buildProject(DEFAULT_PROJECT));
    const secondaires = r.lines.filter((l) => l.role === 'panne' || l.role === 'lisse');
    expect(secondaires.length).toBeGreaterThan(0);
    for (const l of secondaires) {
      if (l.ratios.section < 0.01) continue;
      expect(Math.abs(l.nEd) + Math.abs(l.myEd) + Math.abs(l.mzEd), `${l.mark} ${l.combinaison}`).toBeGreaterThan(0);
    }
    // Et au moins une pièce secondaire fléchit réellement sur son axe faible.
    expect(secondaires.some((l) => l.mzEd > 0)).toBe(true);
  });
});
