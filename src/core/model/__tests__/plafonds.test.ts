import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '../../io/serialize';
import { DEFAULT_PROJECT } from '../defaults';
import { barresEstimees, PLAFONDS } from '../plafonds';
import type { ProjectParams } from '../project';
import { TEMPLATES } from '../templates';
import { isValid, validateProject } from '../validate';

/**
 * PLAFONDS MÉTIER — un fichier forgé ne doit pas pouvoir figer l'onglet : la
 * validation refuse, AVANT toute génération, les trames et les répartitions
 * démesurées.
 */

type Retouche = (p: any) => void;
const avec = (r: Retouche): ProjectParams => {
  const p = structuredClone(DEFAULT_PROJECT) as any;
  r(p);
  return p as ProjectParams;
};
const erreurs = (p: ProjectParams) => validateProject(p).filter((i) => i.level === 'erreur');

describe('plafonds de trame', () => {
  it('laisse valides tous les gabarits', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      expect(erreurs(p), t.id).toEqual([]);
      expect(barresEstimees(p).total, t.id).toBeLessThan(PLAFONDS.barres);
    }
  });

  it('refuse 2 000 travées, et vite', () => {
    const debut = performance.now();
    const e = erreurs(avec((p) => (p.grid.nBays = 2000)));
    expect(performance.now() - debut).toBeLessThan(500);
    expect(e.map((i) => i.path)).toContain('grid.nBays');
  });

  it('accepte le plafond lui-même, refuse au-delà', () => {
    expect(erreurs(avec((p) => (p.grid.nBays = 100))).map((i) => i.path)).not.toContain('grid.nBays');
    expect(erreurs(avec((p) => (p.grid.nBays = 101))).map((i) => i.path)).toContain('grid.nBays');
  });

  it('refuse portée, hauteur et entraxe démesurés', () => {
    expect(erreurs(avec((p) => (p.grid.span = 150_000))).map((i) => i.path)).toContain('grid.span');
    expect(erreurs(avec((p) => (p.grid.eaveHeight = 50_000))).map((i) => i.path)).toContain('grid.eaveHeight');
    expect(erreurs(avec((p) => (p.grid.baySpacing = 30_000))).map((i) => i.path)).toContain('grid.baySpacing');
  });

  it('refuse un faîtage hors d’échelle par la pente', () => {
    const p = avec((q) => {
      q.grid.slopeUnit = 'degres';
      q.grid.slope = 89.9;
    });
    expect(erreurs(p).map((i) => i.path)).toContain('grid.slope');
  });
});

describe('garde sur le nombre de barres générées', () => {
  it('refuse un entraxe de pannes de 1 mm', () => {
    const e = erreurs(avec((p) => (p.secondary.purlins.spacing = 1)));
    expect(e.map((i) => i.path)).toContain('secondary.purlins.spacing');
  });

  it('refuse un nombre de pannes démesuré', () => {
    const p = avec((q) => {
      q.secondary.purlins.mode = 'nombre';
      q.secondary.purlins.count = 1e9;
    });
    expect(erreurs(p).map((i) => i.path)).toContain('secondary.purlins.count');
  });

  it('refuse des lisses tous les millimètres', () => {
    const e = erreurs(avec((p) => (p.secondary.rails.spacing = 1)));
    expect(e.map((i) => i.path)).toContain('secondary.rails.spacing');
  });

  it('refuse des grilles de boulons démesurées sans les construire', () => {
    const debut = performance.now();
    const e = erreurs(avec((p) => (p.connections.rafterToColumn.rows = 1e8)));
    expect(performance.now() - debut).toBeLessThan(500);
    expect(e.map((i) => i.path)).toContain('connections.rafterToColumn.rows');
  });

  it('un fichier forgé se relit en projet NON générable', () => {
    const texte = serializeProject(avec((p) => (p.grid.nBays = 2000)));
    const { issues } = deserializeProject(texte);
    expect(isValid(issues)).toBe(false);
  });
});

describe('listes et répartitions forgées', () => {
  const chemins = (p: ProjectParams) => erreurs(p).map((i) => i.path);

  it('borne les rangées d’une éclisse posée, et elle seule', () => {
    expect(chemins(avec((p) => Object.assign(p.connections.splice, { enabled: true, rows: 1_000_000 })))).toContain(
      'connections.splice.rows',
    );
    expect(chemins(avec((p) => Object.assign(p.connections.splice, { enabled: true, rows: 1 })))).toContain(
      'connections.splice.rows',
    );
    expect(chemins(avec((p) => Object.assign(p.connections.splice, { enabled: false, rows: 1_000_000 })))).not.toContain(
      'connections.splice.rows',
    );
  });

  it('refuse les travées de contreventement fractionnaires ou répétées, en un message', () => {
    const roof = (bays: number[]) => avec((p) => Object.assign(p.bracing.roof, { enabled: true, bays }));
    expect(chemins(roof([0.5]))).toContain('bracing.roof.bays');
    expect(chemins(roof([0, 0]))).toContain('bracing.roof.bays');
    const foule = erreurs(roof(Array(20_000).fill(0))).filter((i) => i.path === 'bracing.roof.bays');
    expect(foule).toHaveLength(1);
    expect(chemins(roof([0, 4]))).not.toContain('bracing.roof.bays');
  });

  it('veut un nombre entier de tiges d’ancrage', () => {
    expect(chemins(avec((p) => (p.connections.columnBase.anchorCount = 2.5)))).toContain('connections.columnBase.anchorCount');
    expect(chemins(avec((p) => (p.connections.columnBase.anchorCount = 0)))).toContain('connections.columnBase.anchorCount');
  });
});
