import { describe, expect, it } from 'vitest';
import { FormatError } from '../../core/io/serialize';
import { lireProjet, TAILLE_MAX_PROJET } from '../fichier';

describe('taille d’un fichier de projet', () => {
  it('refuse un fichier de plus de 5 Mo, avec un message clair', async () => {
    const gros = new Blob([new Uint8Array(TAILLE_MAX_PROJET + 1)]);
    await expect(lireProjet(gros)).rejects.toBeInstanceOf(FormatError);
    await expect(lireProjet(gros)).rejects.toThrow(/trop volumineux.*5 Mo/);
  });

  it('lit un fichier de taille raisonnable', async () => {
    await expect(lireProjet(new Blob(['{"version":1}']))).resolves.toBe('{"version":1}');
  });
});
