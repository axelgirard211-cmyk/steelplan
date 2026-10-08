import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { getTemplate } from '../../model/templates';
import {
  CLE_AUTOSAVE,
  creerAutosave,
  enregistrerAuto,
  oublierAuto,
  relireAuto,
  stockageDisponible,
} from '../storage';

/** Stockage en mémoire, avec possibilité de simuler ses pannes réelles. */
function faux(opts: { quota?: number; lectureCassee?: boolean } = {}): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => {
      if (opts.lectureCassee) throw new Error('lecture interdite');
      return data.get(k) ?? null;
    },
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => {
      if (opts.quota !== undefined && v.length > opts.quota) {
        // Le nom exact que lèvent les navigateurs quand le quota est atteint.
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      }
      data.set(k, v);
    },
  } as Storage;
}

describe('sauvegarde automatique', () => {
  it('enregistre puis relit le projet à l’identique', () => {
    const store = faux();
    const p = getTemplate('hangar-agricole')!.build();
    expect(enregistrerAuto(p, 7, store)).toBe(true);

    const relu = relireAuto(store);
    expect(relu?.edits).toBe(7);
    expect(relu?.at).toBeGreaterThan(0);
    expect(relu?.project).toEqual(p);
  });

  it('ne rend rien quand rien n’a été enregistré', () => {
    expect(relireAuto(faux())).toBeNull();
  });

  it('oublie la sauvegarde sur demande', () => {
    const store = faux();
    enregistrerAuto(DEFAULT_PROJECT, 1, store);
    oublierAuto(store);
    expect(relireAuto(store)).toBeNull();
  });

  /* --- Les trois façons dont le stockage peut lâcher --- */

  it('signale l’échec sans lever quand le quota est atteint', () => {
    // ⚠ L'autosave est un filet : une écriture refusée ne doit jamais interrompre
    // le travail en cours. Elle renvoie faux, l'interface le dit, on continue.
    const store = faux({ quota: 10 });
    expect(() => enregistrerAuto(DEFAULT_PROJECT, 1, store)).not.toThrow();
    expect(enregistrerAuto(DEFAULT_PROJECT, 1, store)).toBe(false);
  });

  it('rend null plutôt que de lever sur un contenu corrompu', () => {
    // Un JSON tronqué au moment d'une coupure, ou écrit par une autre version.
    for (const brut of ['{', 'null', '[]', '{"projet":42}', '{"projet":"pas du json"}']) {
      const store = faux();
      store.setItem(CLE_AUTOSAVE, brut);
      expect(relireAuto(store), brut).toBeNull();
    }
  });

  it('rend null quand un projet enregistré vient d’un format futur', () => {
    const store = faux();
    store.setItem(
      CLE_AUTOSAVE,
      JSON.stringify({ at: 1, edits: 1, projet: JSON.stringify({ version: 99 }) }),
    );
    expect(relireAuto(store)).toBeNull();
  });

  it('déclare le stockage indisponible quand l’écriture est refusée', () => {
    expect(stockageDisponible(faux({ quota: 0 }))).toBeNull();
    expect(stockageDisponible(undefined)).toBeNull();
    expect(stockageDisponible(faux())).not.toBeNull();
  });

  it('ne lève pas non plus quand la LECTURE est interdite', () => {
    // Safari en navigation privée : l'objet existe, ses méthodes refusent.
    expect(() => relireAuto(faux({ lectureCassee: true }))).not.toThrow();
    expect(relireAuto(faux({ lectureCassee: true }))).toBeNull();
  });
});

describe('enregistrement différé', () => {
  it('n’écrit qu’une fois après une rafale de modifications', () => {
    vi.useFakeTimers();
    const store = faux();
    const espion = vi.spyOn(store, 'setItem');
    const auto = creerAutosave(1000, store);

    // Dix frappes successives dans un champ numérique.
    for (let i = 0; i < 10; i++) auto.planifier(DEFAULT_PROJECT, i);
    expect(espion).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(espion).toHaveBeenCalledTimes(1);
    // C'est bien la DERNIÈRE valeur qui est enregistrée, non la première.
    expect(relireAuto(store)?.edits).toBe(9);
    vi.useRealTimers();
  });

  it('écrit immédiatement à la fermeture, sans attendre le délai', () => {
    vi.useFakeTimers();
    const store = faux();
    const auto = creerAutosave(60_000, store);
    auto.planifier(DEFAULT_PROJECT, 3);
    // ⚠ À la fermeture de l'onglet, le délai n'aurait jamais le temps d'expirer :
    // il faut une écriture synchrone, sinon le filet ne sert à rien au moment
    // précis où il compte.
    expect(auto.immediat(DEFAULT_PROJECT, 4)).toBe(true);
    expect(relireAuto(store)?.edits).toBe(4);
    vi.useRealTimers();
  });

  it('annule une écriture planifiée', () => {
    vi.useFakeTimers();
    const store = faux();
    const auto = creerAutosave(1000, store);
    auto.planifier(DEFAULT_PROJECT, 1);
    auto.annuler();
    vi.advanceTimersByTime(5000);
    expect(relireAuto(store)).toBeNull();
    vi.useRealTimers();
  });

  it('se déclare indisponible sans stockage, et ne lève pas pour autant', () => {
    const auto = creerAutosave(10, null);
    expect(auto.disponible).toBe(false);
    expect(() => auto.planifier(DEFAULT_PROJECT, 1)).not.toThrow();
    expect(auto.immediat(DEFAULT_PROJECT, 1)).toBe(false);
  });
});
