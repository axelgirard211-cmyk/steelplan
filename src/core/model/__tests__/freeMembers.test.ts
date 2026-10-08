import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { cutLengths } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../defaults';
import {
  decalageParDefaut,
  dupliquer,
  dupliquerEnSerie,
  longueurLibre,
  nouvelleBarre,
  prochainId,
} from '../freeMembers';
import type { FreeMember } from '../project';

const P = DEFAULT_PROJECT;

describe('barres libres', () => {
  it('crée une barre posée dans le bâtiment, non à l’origine', () => {
    const m = nouvelleBarre(P);
    // Une barre créée en (0,0,0) serait enfouie sous le sol et invisible : le
    // premier réflexe de l'utilisateur serait de recliquer sur « Ajouter ».
    expect(m.start.z).toBe(P.grid.eaveHeight);
    expect(m.start.y).toBe(P.grid.span / 2);
    expect(longueurLibre(m)).toBeCloseTo(P.grid.baySpacing, 6);
  });

  it('attribue des identifiants libres, sans jamais réutiliser les supprimés', () => {
    const l1 = { id: 'L1' } as FreeMember;
    const l3 = { id: 'L3' } as FreeMember;
    expect(prochainId([])).toBe('L1');
    expect(prochainId([l1])).toBe('L2');
    // L2 a été supprimée : on la reprend, car aucun identifiant n'est mémorisé
    // ailleurs — mais jamais un identifiant déjà pris.
    expect(prochainId([l1, l3])).toBe('L2');
    expect(prochainId([l1, l3, { id: 'L2' } as FreeMember])).toBe('L4');
  });
});

describe('duplication', () => {
  const source = nouvelleBarre(P);

  it('décale la copie : jamais superposée à l’originale', () => {
    // ⚠ Une copie posée exactement sur l'originale est invisible en 3D, se
    // superpose sur les plans, et n'apparaît que dans la nomenclature — sous forme
    // d'un doublon que l'utilisateur découvre trop tard.
    const dec = decalageParDefaut(P);
    expect(Math.hypot(dec.x, dec.y, dec.z)).toBeGreaterThan(0);

    const copie = dupliquer(source, dec, [source]);
    expect(copie.id).not.toBe(source.id);
    expect(copie.start.x).toBe(source.start.x + dec.x);
    expect(copie.end.x).toBe(source.end.x + dec.x);
    // Tout le reste est conservé : profil, nuance, orientation, longueur.
    expect(copie.profile).toBe(source.profile);
    expect(copie.grade).toBe(source.grade);
    expect(copie.rotation).toBe(source.rotation);
    expect(longueurLibre(copie)).toBeCloseTo(longueurLibre(source), 9);
  });

  it('décale d’une travée par défaut : une copie par portique', () => {
    expect(decalageParDefaut(P).x).toBe(P.grid.baySpacing);
  });

  it('duplique en série avec un décalage cumulé, non répété', () => {
    const dec = decalageParDefaut(P);
    const copies = dupliquerEnSerie(source, dec, 4, [source]);
    expect(copies).toHaveLength(4);
    for (const [i, c] of copies.entries()) {
      expect(c.start.x, `copie ${i + 1}`).toBe(source.start.x + dec.x * (i + 1));
    }
    // Quatre identifiants distincts, et distincts de la source.
    const ids = new Set([source.id, ...copies.map((c) => c.id)]);
    expect(ids.size).toBe(5);
  });

  it('ne produit rien pour un nombre nul ou négatif', () => {
    expect(dupliquerEnSerie(source, decalageParDefaut(P), 0, [])).toEqual([]);
    expect(dupliquerEnSerie(source, decalageParDefaut(P), -3, [])).toEqual([]);
  });
});

describe('intégration au modèle', () => {
  it('entre dans le modèle, la 3D et le poids total comme toute autre barre', () => {
    const source = nouvelleBarre(P);
    const avec = {
      ...P,
      freeMembers: [source, ...dupliquerEnSerie(source, decalageParDefaut(P), 2, [source])],
    };
    const sans = buildProject(P);
    const modele = buildProject(avec);

    expect(modele.stats.memberCount).toBe(sans.stats.memberCount + 3);
    expect(modele.stats.massKg).toBeGreaterThan(sans.stats.massKg);

    const libres = modele.members.filter((m) => m.role === 'libre');
    expect(libres).toHaveLength(3);
    for (const m of libres) {
      expect(cutLengths(m).axis).toBeCloseTo(P.grid.baySpacing, 6);
      // Coupes droites aux deux abouts : rien à biseauter sur une barre libre.
      expect(cutLengths(m).min).toBeCloseTo(cutLengths(m).max, 6);
    }
  });

  it('regroupe les copies identiques sous un seul repère', () => {
    // Trois barres interchangeables : une seule ligne de débit, quantité 3.
    const source = nouvelleBarre(P);
    const avec = {
      ...P,
      freeMembers: [source, ...dupliquerEnSerie(source, decalageParDefaut(P), 2, [source])],
    };
    const libres = buildProject(avec).members.filter((m) => m.role === 'libre');
    expect(new Set(libres.map((m) => m.mark)).size).toBe(1);
  });
});
