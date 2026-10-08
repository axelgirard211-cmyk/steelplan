import { describe, expect, it } from 'vitest';
import { buildFrameModel, chargerModele, secondaryLoadKnM2 } from '../../analysis/frameModel';
import { solveFrame2d } from '../../analysis/frame2d';
import { intensities } from '../../analysis/loadCases';
import { runChecks } from '../../checks/index';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import type { TrussType } from '../../model/truss';
import { buildProject } from '../buildProject';

/**
 * TRIANGULATION DES FERMES.
 *
 * ⚠ Ce fichier existe à cause d'un défaut qui a traversé toutes les phases sans
 * être vu : trois des quatre topologies n'avaient AUCUNE barre de treillis au
 * droit de l'appui. Le panneau de rive était un Vierendeel, et l'entrait y
 * reprenait l'effort tranchant en flexion — 50 kN·m sur une cornière, pour
 * 52 kN d'effort normal.
 *
 * Rien ne le montrait : la 3D était plausible, les plans corrects, les
 * nomenclatures justes. Seule la RAIDEUR trahissait le défaut, une ferme Pratt
 * fléchissant sept fois plus qu'une Warren de même portée et de mêmes profils.
 * D'où la forme de ces contrôles : on ne compte pas des barres, on mesure ce que
 * la structure fait.
 */

const TOPOLOGIES: TrussType[] = ['warren', 'pratt', 'howe', 'polonceau'];

function projet(type: TrussType, patch: Partial<ProjectParams['truss']> = {}): ProjectParams {
  return {
    ...DEFAULT_PROJECT,
    // Pieds encastrés : sur pieds articulés, le déplacement d'ensemble masque la
    // flèche propre de la ferme, qui est l'objet de la mesure.
    frame: { ...DEFAULT_PROJECT.frame, enabled: false, baseFixity: 'encastre' },
    truss: { ...DEFAULT_PROJECT.truss, enabled: true, type, ...patch },
  };
}

/** Flèche verticale maximale sous G + S, en service. */
function flecheMax(p: ProjectParams): { valeur: number; y: number } {
  const model = buildProject(p);
  const fm = buildFrameModel(p, model);
  const q = intensities(p.loads, secondaryLoadKnM2(p, model));
  const res = solveFrame2d(
    chargerModele(fm, p, q, {
      id: 'T',
      label: 'contrôle',
      kind: 'ELS',
      windDirection: 1,
      factors: { G: 1, S: 1 },
    }),
  );
  let valeur = 0;
  let y = 0;
  for (const [i, n] of fm.nodes.entries()) {
    const dz = res.d[3 * i + 1] ?? 0;
    if (Math.abs(dz) > Math.abs(valeur)) {
      valeur = dz;
      y = n.y;
    }
  }
  return { valeur, y };
}

describe('raideur des fermes', () => {
  const mesures = TOPOLOGIES.map((t) => ({ t, f: flecheMax(projet(t)) }));

  it('toutes les topologies fléchissent du même ordre de grandeur', () => {
    // ⚠ L'invariant central. À portée, charge et profils identiques, quatre
    // triangulations correctes ne peuvent pas différer d'un facteur dix : une
    // ferme beaucoup plus souple que ses sœurs n'est pas « une autre topologie »,
    // c'est une topologie incomplète.
    const valeurs = mesures.map((m) => Math.abs(m.f.valeur));
    const min = Math.min(...valeurs);
    const max = Math.max(...valeurs);
    const detail = mesures.map((m) => `${m.t} ${Math.abs(m.f.valeur).toFixed(1)} mm`).join(', ');
    expect(max / min, detail).toBeLessThan(2);
  });

  it('fléchissent en travée, non près des appuis', () => {
    // Une flèche maximale au voisinage d'un appui signale un mécanisme local,
    // jamais une déformation d'ensemble.
    const portee = DEFAULT_PROJECT.grid.span;
    for (const { t, f } of mesures) {
      expect(f.y, `${t} : flèche maximale en y = ${f.y.toFixed(0)} mm`).toBeGreaterThan(
        0.25 * portee,
      );
      expect(f.y, `${t} : flèche maximale en y = ${f.y.toFixed(0)} mm`).toBeLessThan(0.75 * portee);
    }
  });

  it('restent sous L/500 sous charges de service', () => {
    const limite = DEFAULT_PROJECT.grid.span / 500;
    for (const { t, f } of mesures) {
      expect(Math.abs(f.valeur), `${t}`).toBeLessThan(limite);
    }
  });
});

describe('triangulation au droit des appuis', () => {
  it('chaque nœud d’appui reçoit au moins une barre de treillis', () => {
    // ⚠ C'est la cause directe du défaut. L'entrait aboutit sur l'appui ; si
    // aucune diagonale ni aucun montant n'y arrive, le panneau de rive n'est pas
    // fermé et l'entrait travaille en flexion sur toute la première maille.
    for (const type of TOPOLOGIES) {
      const p = projet(type);
      const fm = buildFrameModel(p, buildProject(p));

      const entraits = fm.segments.filter((s) => s.role === 'membrure-inf');
      expect(entraits.length, type).toBeGreaterThan(0);

      /*
       * ⚠ Ce sont les nœuds d'about de L'ENTRAIT qu'il faut examiner, et non tous
       * les nœuds situés à cette abscisse. Au droit d'un appui il y en a DEUX,
       * superposés : celui de l'entrait et celui de l'arbalétrier. Une diagonale
       * partant du nœud haut suffisait à faire passer le contrôle alors que le
       * nœud bas, lui, ne recevait rien — c'est très exactement le défaut visé.
       */
      const noeudsEntrait = new Set(entraits.flatMap((s) => [s.a, s.b]));
      const yEntrait = [...noeudsEntrait].map((i) => (fm.nodes[i] as { y: number }).y);
      const yMin = Math.min(...yEntrait);
      const yMax = Math.max(...yEntrait);

      for (const yAppui of [yMin, yMax]) {
        const about = [...noeudsEntrait].filter(
          (i) => Math.abs((fm.nodes[i] as { y: number }).y - yAppui) < 10,
        );
        const treillisIci = fm.segments.filter(
          (s) =>
            (s.role === 'diagonale' || s.role === 'montant') &&
            about.some((i) => s.a === i || s.b === i),
        );
        expect(
          treillisIci.length,
          `${type} : aucune barre de treillis sur l’about d’entrait en y = ${yAppui.toFixed(0)}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('émet un montant d’about à chaque appui, pour toutes les topologies', () => {
    for (const type of TOPOLOGIES) {
      const p = projet(type);
      const abouts = buildProject(p).members.filter(
        (m) => m.role === 'montant' && m.position.includes('about'),
      );
      // Deux par ferme, doublées si cornières jumelées, sur chaque file.
      expect(abouts.length, type).toBeGreaterThan(0);
      expect(abouts.length % 2, `${type} : les montants d’about vont par paires`).toBe(0);
    }
  });
});

describe('vérification des fermes par défaut', () => {
  it('sortent vérifiées avec les profils par défaut', () => {
    // Basculer « toiture portée par » sur treillis doit donner un modèle
    // crédible : un modèle rouge dès le premier clic apprend à ignorer les taux.
    for (const type of TOPOLOGIES) {
      const p = projet(type);
      const rapport = runChecks(p, buildProject(p));
      const dépassements = rapport.lines
        .filter((l) => l.ratio > 1)
        .map((l) => `${l.mark} (${l.profileId}) ${l.ratio.toFixed(2)} / ${l.gouverne}`);
      expect(dépassements, type).toEqual([]);
    }
  });
});
