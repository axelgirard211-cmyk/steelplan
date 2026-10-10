import { describe, expect, it } from 'vitest';
import { rubriqueDe } from '../../core/model/validate';
import { normaliser, RUBRIQUES, rubriqueParTitre } from '../projet/rubriques';

describe('rubriques de l’onglet Projet', () => {
  it('donnent une fiche à CHAQUE paramètre que la validation peut signaler', () => {
    // ⚠ Une erreur dont la rubrique n'aurait pas de fiche mènerait nulle part.
    for (const p of [
      'grid.span',
      'frame.columnProfile',
      'frame.enabled',
      'truss.nPanels',
      'secondary.purlins.spacing',
      'ouvertures.profile',
      'bracing.wall.bays',
      'connections.ridge.rows',
      'site.altitude',
      'loads.loads.neige',
      'finition.note',
      'atelier.tombee',
      'freeMembers.L1.profile',
      'meta.indice',
    ]) {
      expect(RUBRIQUES.map((r) => r.titre), p).toContain(rubriqueDe(p));
    }
  });

  it('ramènent un paramètre sans rubrique au contrôle du modèle', () => {
    expect(rubriqueParTitre('Projet').id).toBe('rubrique-controle');
  });

  it('cherchent sans tenir compte des accents ni des majuscules', () => {
    expect(normaliser('  Épaisseur de Platine ')).toBe('epaisseur de platine');
  });
});
