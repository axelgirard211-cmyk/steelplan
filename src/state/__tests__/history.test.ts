import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import { useProjectStore } from '../store';

describe('historique — annuler / rétablir', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(DEFAULT_PROJECT);
  });

  it('applique une édition et la retrouve dans l’historique', () => {
    const s = useProjectStore.getState();
    s.edit('Portée', (d) => {
      d.grid.span = 24000;
    });
    expect(useProjectStore.getState().project.grid.span).toBe(24000);
    expect(useProjectStore.getState().past).toHaveLength(1);
    expect(useProjectStore.getState().past[0]?.label).toBe('Portée');
  });

  it('annule et rétablit une édition', () => {
    const s = useProjectStore.getState();
    s.edit('Portée', (d) => {
      d.grid.span = 24000;
    });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.grid.span).toBe(20000);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.grid.span).toBe(24000);
  });

  it('remonte une pile d’éditions dans l’ordre inverse', () => {
    const valeurs = [21000, 22000, 23000, 24000, 25000];
    for (const v of valeurs) {
      useProjectStore.getState().edit(`Portée ${v}`, (d) => {
        d.grid.span = v;
      });
    }
    for (const v of [...valeurs].reverse().slice(1)) {
      useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.grid.span).toBe(v);
    }
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.grid.span).toBe(20000);
    expect(useProjectStore.getState().past).toHaveLength(0);
  });

  it('ne conserve pas le futur après une nouvelle édition', () => {
    const s = useProjectStore.getState();
    s.edit('a', (d) => {
      d.grid.span = 24000;
    });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().future).toHaveLength(1);
    useProjectStore.getState().edit('b', (d) => {
      d.grid.nBays = 8;
    });
    expect(useProjectStore.getState().future).toHaveLength(0);
    expect(useProjectStore.getState().project.grid.span).toBe(20000);
    expect(useProjectStore.getState().project.grid.nBays).toBe(8);
  });

  it('ignore une édition sans effet', () => {
    useProjectStore.getState().edit('rien', (d) => {
      d.grid.span = 20000; // valeur déjà en place
    });
    expect(useProjectStore.getState().past).toHaveLength(0);
  });

  it('ne modifie jamais l’objet précédent (immuabilité)', () => {
    const avant = useProjectStore.getState().project;
    useProjectStore.getState().edit('Portée', (d) => {
      d.grid.span = 30000;
    });
    expect(avant.grid.span).toBe(20000);
    expect(useProjectStore.getState().project).not.toBe(avant);
    // Les branches non touchées sont partagées, pas recopiées.
    expect(useProjectStore.getState().project.connections).toBe(avant.connections);
  });

  it('revalide le projet à chaque édition', () => {
    useProjectStore.getState().edit('Profil inconnu', (d) => {
      d.frame.columnProfile = 'IPE 999';
    });
    expect(
      useProjectStore.getState().issues.some((i) => i.path === 'frame.columnProfile'),
    ).toBe(true);
    useProjectStore.getState().undo();
    expect(
      useProjectStore.getState().issues.some((i) => i.path === 'frame.columnProfile'),
    ).toBe(false);
  });

  it('l’historique reste léger : quelques centaines d’octets par édition', () => {
    for (let i = 1; i <= 200; i++) {
      useProjectStore.getState().edit(`e${i}`, (d) => {
        d.grid.span = 20000 + i;
      });
    }
    const poids = JSON.stringify(useProjectStore.getState().past).length;
    const poidsProjet = JSON.stringify(useProjectStore.getState().project).length;
    expect(useProjectStore.getState().past).toHaveLength(200);
    // Le point de comparaison est la stratégie par instantanés : 200 éditions
    // coûteraient 200 copies du projet. Les patches doivent rester sous 20 %
    // de ce volume — en pratique on est autour de 6 %.
    expect(poids).toBeLessThan(poidsProjet * 200 * 0.2);
    // Et le coût unitaire d'une édition doit rester de l'ordre de la centaine
    // d'octets, quelle que soit la taille du projet.
    expect(poids / 200).toBeLessThan(300);
  });
});
