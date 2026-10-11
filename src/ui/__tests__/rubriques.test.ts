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

  it('montrent l’essentiel d’abord : ce qui décrit un bâtiment courant', () => {
    /*
     * L'affichage « essentiel » doit suffire à décrire un hangar : sa trame, sa
     * toiture, son portique, son ossature, ses ouvertures, son site. Le reste se
     * règle fin — et garde ses valeurs quand il est masqué.
     */
    const essentiel = RUBRIQUES.filter((r) => !r.avancee).map((r) => r.court);
    for (const r of ['Trame', 'Toiture', 'Portique', 'Pannes et lisses', 'Ouvertures', 'Site, neige et vent', 'Contrôle du modèle']) {
      expect(essentiel).toContain(r);
    }
    expect(RUBRIQUES.filter((r) => r.avancee).length).toBeGreaterThan(5);
    // Le contrôle du modèle, qui liste les anomalies, ne se masque jamais.
    expect(rubriqueParTitre('Contrôle du modèle').avancee).toBeFalsy();
  });

  it('ramènent un paramètre sans rubrique au contrôle du modèle', () => {
    expect(rubriqueParTitre('Projet').id).toBe('rubrique-controle');
  });

  it('cherchent sans tenir compte des accents ni des majuscules', () => {
    expect(normaliser('  Épaisseur de Platine ')).toBe('epaisseur de platine');
  });
});
