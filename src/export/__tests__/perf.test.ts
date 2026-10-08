import { describe, expect, it } from 'vitest';
import { buildProject } from '../../core/build/buildProject';
import { buildSheets } from '../../core/drawing/buildSheets';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import { sheetToDxf } from '../dxf';
import { sheetsToPdf } from '../pdf';

describe('export — tenue en charge', () => {
  it('exporte le dossier d’un hangar de 10 travées en un temps acceptable', () => {
    const p = { ...DEFAULT_PROJECT, grid: { ...DEFAULT_PROJECT.grid, nBays: 10 } };
    const sheets = buildSheets(buildProject(p), p);
    expect(sheets.length).toBeGreaterThan(15);

    const t0 = performance.now();
    const pdf = sheetsToPdf(sheets);
    const duree = performance.now() - t0;

    expect(pdf.size).toBeGreaterThan(20_000);
    // Un dossier complet doit sortir en quelques secondes, pas en minutes.
    expect(duree, `${duree.toFixed(0)} ms pour ${sheets.length} planches`).toBeLessThan(15_000);
  });

  it('exporte toutes les planches en DXF sans dérive de taille', () => {
    const sheets = buildSheets(buildProject(DEFAULT_PROJECT), DEFAULT_PROJECT);
    for (const s of sheets) {
      const dxf = sheetToDxf(s);
      expect(dxf.length, s.titre).toBeGreaterThan(2000);
      expect(dxf.length, `${s.titre} : fichier démesuré`).toBeLessThan(6_000_000);
    }
  });
});
