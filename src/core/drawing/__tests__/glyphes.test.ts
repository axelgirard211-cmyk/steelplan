import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { buildBom } from '../../bom/index';
import { runChecks } from '../../checks/index';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import { POSTES, sheetsBordereau } from '../postes';
import { buildSheets } from '../buildSheets';
import { transcriptible, versCp1252 } from '../../../export/glyphes';

/**
 * ⚠ Le PDF est écrit en Helvetica standard, qui ne connaît que le jeu
 * Windows-1252. Un « ≥ », un « ☐ » ou un « ∩ » s'y impriment en charabia — sur
 * le papier même qui part à l'atelier, sans que l'écran l'ait laissé voir.
 */

describe('glyphes imprimables en PDF', () => {
  it('sait écrire chaque caractère du dossier, tel quel ou translittéré', () => {
    const fautes = new Set<string>();
    for (const p of [DEFAULT_PROJECT, ...TEMPLATES.map((t) => t.build())]) {
      const M = buildProject(p);
      const sheets = buildSheets(M, p, buildBom(p, M), runChecks(p, M));
      const toutes = [...sheets, ...POSTES.flatMap((x) => sheetsBordereau(x.id, sheets, p.meta))];
      for (const s of toutes) {
        for (const e of s.scene.entities) {
          if (e.kind !== 'texte') continue;
          for (const c of e.texte) if (!transcriptible(c)) fautes.add(`« ${c} » dans ${s.titre} : ${e.texte}`);
        }
      }
    }
    expect([...fautes], [...fautes].slice(0, 10).join('\n')).toEqual([]);
  });

  it('translittère sans perdre le sens', () => {
    expect(versCp1252('λ = 1,15 ⚠ W⁻ — 2\u202f138')).toBe('lambda = 1,15 (!) W- — 2\u00a0138');
    expect(versCp1252('Ø22 — 12 × 1467 µm ½ ²')).toBe('Ø22 — 12 × 1467 µm ½ ²');
  });
});
