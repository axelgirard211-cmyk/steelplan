import { describe, expect, it } from 'vitest';
import { moduleIntrouvable } from '../GardeFou';

describe('module chargé à la demande introuvable', () => {
  it('se reconnaît, quel que soit le navigateur', () => {
    // ⚠ « Réessayer » ne relit pas un module en échec : seul un rechargement le fait.
    expect(moduleIntrouvable(new Error('Failed to fetch dynamically imported module: http://localhost:5174/src/ui/panels/Vue3dPanel.tsx'))).toBe(true);
    expect(moduleIntrouvable(new Error('Importing a module script failed.'))).toBe(true);
    expect(moduleIntrouvable(new Error('error loading dynamically imported module'))).toBe(true);
  });

  it('laisse les autres erreurs au traitement ordinaire', () => {
    expect(moduleIntrouvable(new Error('Coupe d’onglet impossible'))).toBe(false);
  });
});
