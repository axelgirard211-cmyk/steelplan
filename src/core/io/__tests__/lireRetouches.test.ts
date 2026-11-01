import { describe, expect, it } from 'vitest';
import { lireRetouches } from '../lireRetouches';
import { FormatError } from '../migrate';

/**
 * RELECTURE DES RETOUCHES — la frontière entre le fichier et les planches.
 *
 * ⚠ Une retouche mal relue se paie à l'impression : un NaN fait disparaître la
 * planche entière, et un effacement perdu fait réapparaître ce que le
 * dessinateur avait retiré. Un fichier fautif est refusé, et l'erreur NOMME le
 * chemin du champ en cause — sans lui, l'utilisateur ne sait pas quoi réparer.
 *
 * Ce qui n'est PAS une faute de format, en revanche : une planche ou une entité
 * générée que le modèle actuel ne produit plus. Le modèle a pu changer depuis
 * l'enregistrement ; ces retouches sont gardées et signalées « à revoir » ou
 * « caduques » à l'application, jamais jetées à la lecture.
 */

const ligne = { kind: 'ligne', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, layer: 'contour' };

/** L'erreur levée par `f`, pour en lire le type et le message. */
function erreurDe(f: () => unknown): Error {
  try {
    f();
  } catch (e) {
    return e as Error;
  }
  throw new Error('aucune erreur levée');
}

describe('planches', () => {
  it('relit une planche ordinaire sans perte', () => {
    const brut = [{ planche: 'plan', masques: ['m1'], ajouts: [{ id: 'r1', origine: '', entite: ligne }] }];
    expect(lireRetouches(brut, 'retouches')).toEqual(brut);
  });

  it('refuse une planche sans identifiant texte, en nommant son chemin', () => {
    for (const planche of [undefined, 3, null, { id: 'plan' }]) {
      const e = erreurDe(() => lireRetouches([{ planche: 'plan' }, { planche, ajouts: [] }], 'retouches'));
      expect(e, String(planche)).toBeInstanceOf(FormatError);
      expect(e.message).toContain('« retouches[1].planche »');
    }
  });

  it('garde une planche que le modèle actuel ne produit plus', () => {
    // ⚠ Une ferme-treillis supprimée puis rétablie retrouve ses retouches : les
    // jeter à la lecture les perdrait pour de bon au prochain enregistrement.
    const brut = [{ planche: 'planche-disparue-42', masques: [], ajouts: [{ id: 'r1', origine: '', entite: ligne }] }];
    expect(lireRetouches(brut, 'retouches')[0]?.planche).toBe('planche-disparue-42');
  });

  it('refuse une liste de retouches qui n’en est pas une', () => {
    const e = erreurDe(() => lireRetouches({ planche: 'plan' }, 'retouches'));
    expect(e).toBeInstanceOf(FormatError);
    expect(e.message).toContain('« retouches »');
    expect(e.message).toMatch(/une liste/);
    expect(erreurDe(() => lireRetouches(['plan'], 'retouches')).message).toContain('« retouches[0] »');
  });
});

describe('ajouts et masques', () => {
  it.each([
    ['un objet', { r1: ligne }],
    ['un texte', 'r1'],
    ['un nombre', 1],
    ['un booléen', true],
  ])('refuse des ajouts donnés comme %s, en nommant le chemin', (_nom, ajouts) => {
    const e = erreurDe(() => lireRetouches([{ planche: 'plan', ajouts }], 'retouches'));
    expect(e).toBeInstanceOf(FormatError);
    expect(e.message).toContain('« retouches[0].ajouts »');
    expect(e.message).toMatch(/une liste/);
  });

  it('prend des listes vides quand ajouts et masques sont absents', () => {
    expect(lireRetouches([{ planche: 'plan' }], 'retouches')).toEqual([{ planche: 'plan', ajouts: [], masques: [] }]);
    // `null` vaut absence, comme le champ omis.
    expect(lireRetouches([{ planche: 'plan', ajouts: null, masques: null }], 'retouches')).toEqual([{ planche: 'plan', ajouts: [], masques: [] }]);
  });

  it('refuse des masques qui ne sont pas des empreintes texte', () => {
    expect(erreurDe(() => lireRetouches([{ planche: 'plan', masques: 'm1' }], 'retouches')).message).toContain('« retouches[0].masques »');
    expect(erreurDe(() => lireRetouches([{ planche: 'plan', masques: ['m1', 7] }], 'retouches')).message).toContain('« retouches[0].masques[1] »');
  });

  it('nomme le chemin complet d’un champ fautif au fond d’une entité', () => {
    const brut = [
      { planche: 'plan' },
      {
        planche: 'detail',
        ajouts: [
          { id: 'r1', origine: '', entite: ligne },
          { id: 'r2', origine: '', entite: { kind: 'polyligne', points: [{ x: 0, y: 0 }, { x: 1, y: Number.NaN }], fermee: false, layer: 'contour' } },
        ],
      },
    ];
    const e = erreurDe(() => lireRetouches(JSON.parse(JSON.stringify(brut)), 'retouches'));
    expect(e).toBeInstanceOf(FormatError);
    // JSON écrit NaN « null » : c'est sous cette forme qu'il revient du fichier.
    expect(e.message).toContain('« retouches[1].ajouts[1].entite.points[1].y »');
  });

  it('refuse un ajout sans identifiant ou d’une nature inconnue', () => {
    expect(erreurDe(() => lireRetouches([{ planche: 'p', ajouts: [{ entite: ligne }] }], 'r')).message).toContain('« r[0].ajouts[0].id »');
    expect(erreurDe(() => lireRetouches([{ planche: 'p', ajouts: [{ id: 'a', entite: { ...ligne, kind: 'spline' } }] }], 'r')).message).toContain('« r[0].ajouts[0].entite.kind »');
  });
});

describe('références orphelines', () => {
  it('garde un masque dont l’entité générée n’existe plus', () => {
    // ⚠ L'effacement « caduc » est compté et proposé au nettoyage à
    // l'application (`valider`), jamais supprimé à la lecture : la lecture ne
    // connaît pas la planche, elle ne peut pas savoir s'il est caduc.
    const brut = [{ planche: 'plan', masques: ['ligne|contour|999.00,999.00;0.00,0.00'], ajouts: [] }];
    expect(lireRetouches(brut, 'retouches')[0]?.masques).toEqual(brut[0]?.masques);
  });

  it('garde un ajout dont l’origine a disparu, pour qu’il soit signalé « à revoir »', () => {
    const brut = [{ planche: 'plan', masques: [], ajouts: [{ id: 'r1', origine: 'ligne|contour|introuvable', entite: ligne }] }];
    expect(lireRetouches(brut, 'retouches')[0]?.ajouts[0]?.origine).toBe('ligne|contour|introuvable');
  });

  it('refuse une origine qui n’est pas une empreinte texte, en nommant son chemin', () => {
    const e = erreurDe(() => lireRetouches([{ planche: 'plan', ajouts: [{ id: 'r1', origine: 12, entite: ligne }] }], 'retouches'));
    expect(e).toBeInstanceOf(FormatError);
    expect(e.message).toContain('« retouches[0].ajouts[0].origine »');
  });

  it('prend une origine absente pour une retouche sans origine', () => {
    expect(lireRetouches([{ planche: 'plan', ajouts: [{ id: 'r1', entite: ligne }] }], 'retouches')[0]?.ajouts[0]?.origine).toBe('');
  });
});
