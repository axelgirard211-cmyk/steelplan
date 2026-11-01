import { describe, expect, it } from 'vitest';
import { getGrade } from '../../catalog/grades';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { verifierGrille } from '../grilleEntreprise';
import { lireRetouches } from '../lireRetouches';
import { FormatError, deserializeProject, serializeProject } from '../serialize';

/**
 * DURCISSEMENT DE LA RELECTURE — un fichier de projet est une entrée NON
 * fiable : chaque champ à valeurs fermées doit être confronté à sa liste, et
 * aucune clé héritée d'Object.prototype ne doit passer pour une valeur connue.
 */

/** Le projet par défaut, enregistré puis modifié par `retouche` comme le ferait un fichier forgé. */
function fichier(retouche: (o: Record<string, any>) => void): string {
  const o = JSON.parse(serializeProject(DEFAULT_PROJECT)) as Record<string, any>;
  retouche(o);
  return JSON.stringify(o);
}

const refuse = (texte: string, chemin: string) => {
  expect(() => deserializeProject(texte)).toThrow(FormatError);
  expect(() => deserializeProject(texte)).toThrow(chemin);
};

describe('énumérations relues sur liste blanche', () => {
  it('relit sans faute le projet par défaut', () => {
    expect(deserializeProject(serializeProject(DEFAULT_PROJECT)).project).toEqual(DEFAULT_PROJECT);
  });

  it('refuse une nuance « toString » en nommant le chemin', () => {
    refuse(fichier((o) => (o.frame.grade = 'toString')), 'frame.grade');
    refuse(fichier((o) => (o.secondary.purlins.grade = 'constructor')), 'secondary.purlins.grade');
  });

  it('refuse un mode de répartition inconnu', () => {
    refuse(fichier((o) => (o.secondary.purlins.mode = 'bogus')), 'secondary.purlins.mode');
    refuse(fichier((o) => (o.site.mode = 'bogus')), 'site.mode');
  });

  it('refuse les autres énumérations forgées', () => {
    refuse(fichier((o) => (o.grid.roofType = 'dome')), 'grid.roofType');
    refuse(fichier((o) => (o.truss.type = '__proto__')), 'truss.type');
    refuse(fichier((o) => (o.bracing.roof.shape = 'x')), 'bracing.roof.shape');
    refuse(fichier((o) => (o.connections.rafterToColumn.bolt.cls = '12.9')), 'connections.rafterToColumn.bolt.cls');
    refuse(fichier((o) => (o.connections.secondaryBolt.d = 13)), 'connections.secondaryBolt.d');
    refuse(fichier((o) => (o.finition.type = 'chrome')), 'finition.type');
    refuse(fichier((o) => (o.site.zoneNeige = 'Z')), 'site.zoneNeige');
  });

  it('contrôle aussi les listes : ouvertures et barres libres', () => {
    const ouverture = { id: 'o1', face: 'toit', type: 'porte', position: 0, largeur: 1000, hauteur: 2000, allege: 0 };
    refuse(fichier((o) => (o.ouvertures.items = [ouverture])), 'ouvertures.items[0].face');
    const barre = { id: 'b1', profile: 'IPE 200', grade: 'valueOf', start: { x: 0, y: 0, z: 0 }, end: { x: 1000, y: 0, z: 0 }, rotation: 0, label: '' };
    refuse(fichier((o) => (o.freeMembers = [barre])), 'freeMembers[0].grade');
  });
});

describe('tables consultées par une clé venue du fichier', () => {
  it('getGrade refuse une clé héritée au lieu de rendre une fonction', () => {
    expect(() => getGrade('toString' as never)).toThrow(/inconnue/);
    expect(getGrade('S355').fy).toBe(355);
  });

  it('lireRetouches refuse le calque « constructor »', () => {
    const retouche = [{ planche: 'P1', ajouts: [{ id: 'a', entite: { kind: 'ligne', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, layer: 'constructor' } }] }];
    expect(() => lireRetouches(retouche, 'retouches')).toThrow(FormatError);
    expect(() => lireRetouches(retouche, 'retouches')).toThrow('retouches[0].ajouts[0].entite.layer');
  });

  it('la grille d’entreprise refuse une nuance « toString »', () => {
    const g = JSON.parse(JSON.stringify(DEFAULT_PROJECT.prix)) as Record<string, any>;
    expect(verifierGrille(g)).not.toBeNull();
    g.acier = { ...g.acier, toString: 1 };
    expect(verifierGrille(g)).toBeNull();
  });
});
