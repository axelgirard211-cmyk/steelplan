import { describe, expect, it } from 'vitest';
import { buildProject } from '../../core/build/buildProject';
import { piecesDeDebit } from '../../core/drawing/sheets/element';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import { champTexte, elementToDstv, LONGUEUR_IDENTIFIANT } from '../dstv';

/**
 * ⚠ L'en-tête ST est POSITIONNEL : un texte saisi contenant un retour à la
 * ligne ne doit jamais ajouter de ligne, sous peine de décaler tous les champs.
 */
const ELS = piecesDeDebit(buildProject(DEFAULT_PROJECT));
const piece = ELS.find((e) => elementToDstv(e, { meta: DEFAULT_PROJECT.meta }) !== null)!;

/** Lignes de l'en-tête ST, entre « ST » et le mot-clé suivant. */
function entete(contenu: string): string[] {
  const l = contenu.split('\n');
  const i = l.indexOf('ST');
  const out: string[] = [];
  for (let k = i + 1; k < l.length && (l[k] as string).startsWith('  '); k += 1) out.push((l[k] as string).trim());
  return out;
}

describe('en-tête DSTV et textes saisis', () => {
  it('garde 24 champs quand le nom contient des retours à la ligne', () => {
    const meta = { ...DEFAULT_PROJECT.meta, nom: 'A\nB\r\nC', chantier: 'X Y\tZ' };
    const h = entete(elementToDstv(piece, { meta, phase: '1\n2' }) as string);
    expect(h).toHaveLength(24);
    expect(h[0]).toBe('A B C');
    expect(h[1]).toBe('X Y Z');
    expect(h[2]).toBe('1 2');
    expect(h[5]).toBe(String(piece.quantite));
  });

  it('borne la longueur et remplace un champ vide', () => {
    const meta = { ...DEFAULT_PROJECT.meta, nom: 'Bâtiment industriel de stockage', chantier: '\n\n' };
    const h = entete(elementToDstv(piece, { meta }) as string);
    expect(h[0]).toBe('Bâtiment industriel de stockage');
    expect(h[1]).toBe('Bâtiment industriel de stockage');
    const long = entete(elementToDstv(piece, { meta: { ...meta, nom: 'x'.repeat(500) } }) as string);
    expect(Array.from(long[0] as string).length).toBe(LONGUEUR_IDENTIFIANT);
  });

  it('champTexte retire tout caractère de contrôle', () => {
    expect(champTexte('a\u0000b\u007fc​d', '-')).toBe('a b c d');
    expect(champTexte('   ', 'repli')).toBe('repli');
    expect(champTexte(undefined, 'repli')).toBe('repli');
  });
});
