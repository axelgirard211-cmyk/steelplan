import { describe, expect, it } from 'vitest';
import { aideDuChamp, NB_AIDES } from '../aide';

describe('aide des paramètres', () => {
  it('explique les paramètres techniques', () => {
    expect(NB_AIDES).toBeGreaterThan(60);
    expect(aideDuChamp('Platine traverse–poteau — pince', 'pince', 'Assemblages')).toMatch(/1,2 d0/);
    expect(aideDuChamp('Classe d’exécution', 'Classe d’exécution', 'Atelier')).toMatch(/EN 1090-2/);
  });

  it('départage les homonymes par leur fiche', () => {
    // « Traverses » : un profil dans le portique, une limite de flèche dans les charges.
    expect(aideDuChamp('Traverses', 'Traverses', 'Charges et critères')).toMatch(/Flèche/);
    expect(aideDuChamp('Traverses', 'Traverses', 'Portique')).toBeNull();
    expect(aideDuChamp('Pannes', 'Pannes', 'Ossature secondaire')).toMatch(/couverture/);
    expect(aideDuChamp('Pannes', 'Pannes', 'Charges et critères')).toMatch(/Flèche/);
  });

  it('préfère l’aide du libellé complet à celle de la seule ligne', () => {
    const pannes = aideDuChamp('Pannes — entraxe demandé', 'entraxe demandé', 'Ossature secondaire');
    const lisses = aideDuChamp('Lisses de bardage — entraxe demandé', 'entraxe demandé', 'Ossature secondaire');
    expect(pannes).toMatch(/rampant/);
    expect(lisses).not.toBe(pannes);
  });

  it('ne dit rien d’un champ qu’elle ne connaît pas', () => {
    expect(aideDuChamp('Client', 'Client', 'Cartouche et indices')).toBeNull();
  });
});
