import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { GRILLE_PAR_DEFAUT } from '../../model/prix';
import { validateProject } from '../../model/validate';
import { avecGrilleEntreprise, lireGrilleEntreprise, memoriserGrilleEntreprise, verifierGrille } from '../grilleEntreprise';

/** Stockage en mémoire. */
function faux(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  } as Storage;
}

describe('grille de l’entreprise', () => {
  const maison = { ...GRILLE_PAR_DEFAUT, heureAtelier: 62, montage: 480, marge: 7 };

  it('se mémorise et passe aux nouveaux projets', () => {
    const s = faux();
    expect(lireGrilleEntreprise(s)).toBeNull();
    expect(avecGrilleEntreprise(DEFAULT_PROJECT, s)).toBe(DEFAULT_PROJECT);
    expect(memoriserGrilleEntreprise(maison, s)).toBe(true);
    expect(avecGrilleEntreprise(DEFAULT_PROJECT, s).prix).toEqual(maison);
  });

  it('refuse une grille corrompue plutôt que de chiffrer avec', () => {
    // ⚠ Le stockage peut avoir été tronqué ou modifié à la main.
    expect(verifierGrille({ ...maison, marge: 'sept' })).toBeNull();
    expect(verifierGrille({ ...maison, acier: { S235: null } })).toBeNull();
    expect(verifierGrille({ ...maison, acier: { S999: 1 } })).toBeNull();
    expect(verifierGrille([1, 2])).toBeNull();
    const s = faux();
    s.setItem('steelplan.grille-entreprise.v1', '{"acier":');
    expect(lireGrilleEntreprise(s)).toBeNull();
  });

  it('complète une grille enregistrée avant l’arrivée d’un champ', () => {
    const { transport: _t, ...ancienne } = maison;
    expect(verifierGrille(ancienne)?.transport).toBe(GRILLE_PAR_DEFAUT.transport);
  });

  it('signale un prix négatif sans suspendre les plans', () => {
    const issues = validateProject({ ...DEFAULT_PROJECT, prix: { ...GRILLE_PAR_DEFAUT, montage: -5 } });
    const i = issues.find((x) => x.path === 'prix.montage');
    expect(i?.level).toBe('avertissement');
    expect(issues.some((x) => x.level === 'erreur')).toBe(false);
  });
});
