import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import type { ProjectParams } from '../../core/model/project';
import { checksReport, structuralModel } from '../derived';

/**
 * ⚠⚠ LE GARDE-FOU QUI EMPÊCHE LA PAGE BLANCHE.
 *
 * Taper une portée de 0 faisait lever le générateur pendant le rendu, et
 * l'interface ENTIÈRE disparaissait — la saisie fautive aussitôt sauvegardée,
 * si bien que « Restaurer » au rechargement replantait à l'identique. Ces tests
 * tiennent la règle : aucune saisie, si absurde soit-elle, ne fait lever la
 * dérivation du modèle.
 */

const avec = (grid: Partial<ProjectParams['grid']>): ProjectParams => ({
  ...DEFAULT_PROJECT,
  grid: { ...DEFAULT_PROJECT.grid, ...grid },
});

describe('dérivation du modèle face aux saisies invalides', () => {
  it('ne lève JAMAIS, quelle que soit la saisie', () => {
    const absurdes: ProjectParams[] = [
      avec({ span: 0 }),
      avec({ span: -5000 }),
      avec({ nBays: 0 }),
      avec({ baySpacing: 0 }),
      avec({ eaveHeight: 0 }),
      avec({ span: Number.NaN }),
      avec({ span: 1 }), // valide pour la validation, dégénéré pour la géométrie
    ];
    for (const p of absurdes) {
      expect(() => structuralModel(p), JSON.stringify(p.grid)).not.toThrow();
      expect(() => checksReport(p), JSON.stringify(p.grid)).not.toThrow();
    }
  });

  it('garde le DERNIER ÉTAT VALIDE pendant une saisie fautive', () => {
    /*
     * La 3D et les plans ne doivent ni disparaître ni montrer autre chose que
     * ce qui était juste un instant plus tôt : on corrige un chiffre, on ne
     * repart pas d'une page vide.
     */
    const valide = avec({ span: 18_000 });
    const modeleValide = structuralModel(valide);
    const fautif = { ...valide, grid: { ...valide.grid, span: 0 } };
    expect(structuralModel(fautif)).toBe(modeleValide);
  });

  it('reconstruit dès que la saisie redevient valide', () => {
    const a = structuralModel(avec({ span: 0 }));
    const b = structuralModel(avec({ span: 22_000 }));
    expect(b).not.toBe(a);
    expect(b.stats.massKg).toBeGreaterThan(0);
  });
});
