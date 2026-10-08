import { describe, expect, it } from 'vitest';
import {
  createPlate,
  FAMILY_LABELS,
  findProfile,
  getProfile,
  memberMass,
  memberPaintArea,
  PROFILES,
  profilesByFamily,
} from '../index';
import { sectionOutline } from '../../geometry/section';
import { chsProps, rect, rectSetProps, roundedRectProps } from '../geom';
import { L_EQUAL_ROWS } from '../angles';
import { UPE_ROWS } from '../upe';
import { UPN_ROWS } from '../upn';
import { GRADES } from '../grades';
import type { Profile } from '../types';

const RHO = 7850; // kg/m³

/** Écart relatif entre deux valeurs. */
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

/**
 * Ces tests ne vérifient pas « le code » mais LES DONNÉES : chaque ligne saisie
 * à la main dans les tables est recoupée par des relations physiques qui ne
 * peuvent pas toutes être fausses en même temps. Une faute de frappe sur une
 * inertie casse le contrôle du rayon de giration ; une faute sur une aire casse
 * le contrôle de masse. C'est le filet de sécurité du catalogue.
 */
describe('catalogue — intégrité', () => {
  it('contient tous les profils attendus', () => {
    expect(profilesByFamily('IPE')).toHaveLength(18);
    expect(profilesByFamily('HEA')).toHaveLength(19);
    expect(profilesByFamily('HEB')).toHaveLength(19);
    expect(profilesByFamily('HEM')).toHaveLength(19);
    expect(profilesByFamily('UPN')).toHaveLength(12);
    expect(profilesByFamily('UPE')).toHaveLength(14);
    expect(profilesByFamily('L').length).toBeGreaterThan(15);
    expect(profilesByFamily('LI').length).toBeGreaterThan(15);
    expect(profilesByFamily('CHS').length).toBeGreaterThan(25);
    expect(PROFILES.length).toBeGreaterThan(250);
  });

  it('n’a aucun identifiant en double', () => {
    const ids = PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('n’expose aucune valeur non finie ou négative', () => {
    /*
     * ⚠ `Iyz` est EXCLU de la règle de positivité, et c'est la seule exclusion.
     * Un produit d'inertie porte un signe : celui du sens dans lequel penchent
     * les axes principaux. Il est négatif pour toutes les pannes en Z du
     * catalogue, et l'exiger positif reviendrait à interdire la seule grandeur
     * qui distingue un Z d'un C.
     */
    for (const p of PROFILES) {
      for (const [k, v] of Object.entries(p)) {
        if (typeof v !== 'number') continue;
        expect(Number.isFinite(v), `${p.id}.${k} = ${v}`).toBe(true);
        if (k === 'Iyz') continue;
        expect(v, `${p.id}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('a un libellé français pour chaque famille présente', () => {
    for (const p of PROFILES) expect(FAMILY_LABELS[p.family]).toBeTruthy();
  });
});

describe('catalogue — cohérence masse ↔ aire', () => {
  it('G = A × 7850 kg/m³ à 2 % près', () => {
    for (const p of PROFILES) {
      const attendu = (p.A / 1e6) * RHO; // A en mm² → m²
      expect(rel(p.G, attendu), `${p.id} : G=${p.G} vs ${attendu.toFixed(2)}`).toBeLessThan(0.02);
    }
  });
});

describe('catalogue — cohérence rayons de giration ↔ inerties', () => {
  it('iy = √(Iy/A) et iz = √(Iz/A) à 1,5 % près', () => {
    for (const p of PROFILES) {
      expect(rel(p.iy, Math.sqrt(p.Iy / p.A)), `${p.id}.iy`).toBeLessThan(0.015);
      expect(rel(p.iz, Math.sqrt(p.Iz / p.A)), `${p.id}.iz`).toBeLessThan(0.015);
    }
  });
});

describe('catalogue — cohérence modules ↔ inerties', () => {
  it('Wel = I / v sur les sections doublement symétriques (I, tubes, plats)', () => {
    for (const p of PROFILES) {
      // Cornières, U et profils formés à froid : traités ci-dessous, aucun
      // n'étant doublement symétrique.
      if (p.shape === 'L' || p.shape === 'U' || p.shape === 'Z' || p.shape === 'C') continue;
      expect(rel(p.Wely, p.Iy / (p.h / 2)), `${p.id}.Wely`).toBeLessThan(0.015);
      expect(rel(p.Welz, p.Iz / (p.b / 2)), `${p.id}.Welz`).toBeLessThan(0.015);
    }
  });

  it('Wel = I / v sur les profils formés à froid, v lu sur le contour', () => {
    /*
     * ⚠ La fibre extrême est mesurée SUR LE CONTOUR DESSINÉ, non recalculée à
     * partir des cotes. Un test qui re-dérive la géométrie qu'il vérifie ne
     * vérifie que lui-même : c'est exactement ce qui avait laissé passer deux
     * masses à livrer divergentes dans les nomenclatures.
     *
     * Ni le Z ni le C ne sont doublement symétriques — le C n'a pas d'axe
     * vertical de symétrie, le Z n'a même pas ses deux ailes de la même
     * largeur — et v vaut donc rarement h/2.
     */
    for (const p of PROFILES) {
      if (p.shape !== 'Z' && p.shape !== 'C') continue;
      const pts = sectionOutline(p).outer;
      const vz = Math.max(...pts.map((q) => Math.abs(q.z)));
      const vy = Math.max(...pts.map((q) => Math.abs(q.y)));
      expect(rel(p.Wely, p.Iy / vz), `${p.id}.Wely`).toBeLessThan(1e-9);
      expect(rel(p.Welz, p.Iz / vy), `${p.id}.Welz`).toBeLessThan(1e-9);
    }
  });

  it('Wel = I / v sur les U (fibre extrême selon z = b − cy)', () => {
    for (const p of PROFILES) {
      if (p.shape !== 'U') continue;
      // Axe fort : la section est symétrique, la fibre extrême est h/2.
      expect(rel(p.Wely, p.Iy / (p.h / 2)), `${p.id}.Wely`).toBeLessThan(0.015);
      // Axe faible : Welz est dérivé de Iz et cy, on vérifie la relation.
      expect(rel(p.Welz, p.Iz / (p.b - p.cy)), `${p.id}.Welz`).toBeLessThan(1e-9);
    }
  });

  it('le Welz dérivé reste proche des valeurs tabulées (contrôle croisé)', () => {
    const tabules = [...UPN_ROWS, ...UPE_ROWS];
    const ecarts: string[] = [];
    for (const row of tabules) {
      const p = getProfile(row[0]);
      const e = rel(p.Welz, row[13] * 1e3);
      if (e > 0.06) ecarts.push(`${row[0]} : dérivé ${(p.Welz / 1e3).toFixed(2)} cm³ vs table ${row[13]} cm³`);
    }
    expect(ecarts, ecarts.join('\n')).toHaveLength(0);
  });

  it('Wel = I / v sur les cornières (fibre extrême = aile − centre de gravité)', () => {
    for (const p of PROFILES) {
      if (p.shape !== 'L') continue;
      // Flexion autour de y ⇒ fibre extrême selon z, au bout de la grande aile.
      expect(rel(p.Wely, p.Iy / (p.a - p.cz)), `${p.id}.Wely`).toBeLessThan(0.02);
      // Flexion autour de z ⇒ fibre extrême selon y, au bout de la petite aile.
      expect(rel(p.Welz, p.Iz / (p.a2 - p.cy)), `${p.id}.Welz`).toBeLessThan(0.02);
    }
  });

  it('Wpl ≥ Wel, avec un facteur de forme plausible (1,0 à 2,1)', () => {
    for (const p of PROFILES) {
      const fy = p.Wply / p.Wely;
      const fz = p.Wplz / p.Welz;
      expect(fy, `${p.id} facteur de forme y = ${fy.toFixed(3)}`).toBeGreaterThanOrEqual(1);
      expect(fy, `${p.id} facteur de forme y = ${fy.toFixed(3)}`).toBeLessThan(2.1);
      expect(fz, `${p.id} facteur de forme z = ${fz.toFixed(3)}`).toBeGreaterThanOrEqual(1);
      expect(fz, `${p.id} facteur de forme z = ${fz.toFixed(3)}`).toBeLessThan(2.1);
    }
  });
});

describe('catalogue — cohérence géométrique des profils en I et U', () => {
  it('l’aire tabulée encadre l’aire des rectangles constitutifs', () => {
    for (const p of PROFILES) {
      if (p.shape !== 'I' && p.shape !== 'U') continue;
      const nbSemelles = p.shape === 'I' ? 2 : 2;
      const brut = nbSemelles * p.b * p.tf + p.tw * (p.h - 2 * p.tf);
      // Les congés ajoutent de la matière : l'aire réelle est supérieure,
      // mais de moins de 15 %.
      expect(p.A, `${p.id} aire`).toBeGreaterThan(brut * 0.99);
      expect(p.A, `${p.id} aire`).toBeLessThan(brut * 1.15);
    }
  });

  it('les dimensions restent croissantes dans chaque famille', () => {
    for (const f of ['IPE', 'HEB', 'UPN', 'UPE'] as const) {
      const list = profilesByFamily(f);
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1] as Profile;
        const cur = list[i] as Profile;
        expect(cur.h, `${f} hauteur`).toBeGreaterThanOrEqual(prev.h);
        expect(cur.A, `${f} aire`).toBeGreaterThan(prev.A);
        expect(cur.Iy, `${f} inertie`).toBeGreaterThan(prev.Iy);
      }
    }
  });
});

describe('catalogue — recoupement des cornières tabulées par le calcul', () => {
  it('la section idéalisée retrouve les tables à 4 % près', () => {
    for (const row of L_EQUAL_ROWS) {
      const [id, a, a2, t, , Acm2, , Iycm4, , , , Ietacm4] = row;
      const g = rectSetProps([rect(0, t, 0, a), rect(t, a2, 0, t)]);
      expect(rel(g.A, Acm2 * 100), `${id} aire`).toBeLessThan(0.04);
      expect(rel(g.Iy, Iycm4 * 1e4), `${id} Iy`).toBeLessThan(0.04);
      expect(rel(g.Imin, Ietacm4 * 1e4), `${id} Ieta`).toBeLessThan(0.04);
    }
  });
});

describe('géométrie — formules fermées', () => {
  it('la couronne circulaire redonne les valeurs de catalogue', () => {
    // CHS 168.3×5 : A = 25,7 cm², I = 856 cm⁴, Wel = 102 cm³
    const p5 = chsProps(168.3, 5);
    expect(p5.A / 100).toBeCloseTo(25.7, 1);
    expect(p5.I / 1e4).toBeCloseTo(856, 0);
    expect(p5.Wel / 1e3).toBeCloseTo(102, 0);

    // CHS 168.3×6,3 : A = 32,1 cm², I = 1053 cm⁴
    const p63 = chsProps(168.3, 6.3);
    expect(p63.A / 100).toBeCloseTo(32.1, 1);
    expect(p63.I / 1e4).toBeCloseTo(1053, 0);
  });

  it('le rectangle arrondi dégénère correctement en cercle', () => {
    const r = 50;
    const p = roundedRectProps(2 * r, 2 * r, r);
    expect(p.A).toBeCloseTo(Math.PI * r * r, 6);
    expect(p.Iy).toBeCloseTo((Math.PI * r ** 4) / 4, 4);
    expect(2 * p.Sy).toBeCloseTo((4 * r ** 3) / 3, 4);
    expect(p.perimeter).toBeCloseTo(2 * Math.PI * r, 8);
  });

  it('le rectangle arrondi dégénère correctement en rectangle vif', () => {
    const p = roundedRectProps(100, 200, 0);
    expect(p.A).toBe(20000);
    expect(p.Iy).toBeCloseTo((100 * 200 ** 3) / 12, 6);
    expect(2 * p.Sy).toBeCloseTo((100 * 200 ** 2) / 4, 6);
  });

  it('le tube carré calculé retrouve la table (SHS 100×100×5 : A ≈ 18,4 cm²)', () => {
    const shs = getProfile('SHS 100x100x5');
    expect(shs.A / 100).toBeCloseTo(18.4, 1);
    expect(shs.G).toBeCloseTo(14.4, 1);
  });

  it('le module plastique d’un rectangle plein vaut b·h²/4', () => {
    const p = rectSetProps([rect(0, 30, 0, 200)]);
    expect(p.Wply).toBeCloseTo((30 * 200 ** 2) / 4, 6);
    expect(p.Wplz).toBeCloseTo((200 * 30 ** 2) / 4, 6);
  });
});

describe('catalogue — accès et utilitaires', () => {
  it('getProfile lève sur un identifiant inconnu', () => {
    expect(() => getProfile('IPE 999')).toThrow(/inconnu/);
    expect(findProfile('IPE 999')).toBeUndefined();
  });

  it('convertit correctement les unités depuis les tables', () => {
    const ipe200 = getProfile('IPE 200');
    expect(ipe200.h).toBe(200);
    expect(ipe200.A).toBeCloseTo(2850, 0); // 28,5 cm² → mm²
    expect(ipe200.Iy).toBeCloseTo(1943e4, 0); // 1943 cm⁴ → mm⁴
    expect(ipe200.Wely).toBeCloseTo(194e3, 0); // 194 cm³ → mm³
    expect(ipe200.iy).toBeCloseTo(82.6, 1); // 8,26 cm → mm
  });

  it('calcule la masse et la surface à peindre d’une barre', () => {
    const ipe200 = getProfile('IPE 200');
    // 6 m d'IPE 200 à 22,4 kg/m
    expect(memberMass(ipe200, 6000)).toBeCloseTo(134.4, 1);
    // Périmètre ≈ 0,768 m²/m → 4,6 m² sur 6 m
    expect(memberPaintArea(ipe200, 6000)).toBeCloseTo(4.61, 1);
  });

  it('fabrique un plat quelconque', () => {
    const p = createPlate(200, 15);
    expect(p.id).toBe('Plat 200x15');
    expect(p.A).toBe(3000);
    expect(p.G).toBeCloseTo(23.55, 2);
    expect(p.Wplz).toBeCloseTo((15 * 200 ** 2) / 4, 6);
  });
});

describe('nuances d’acier', () => {
  it('expose les limites d’élasticité de l’EN 1993-1-1', () => {
    expect(GRADES.S235.fy).toBe(235);
    expect(GRADES.S275.fy).toBe(275);
    expect(GRADES.S355.fy).toBe(355);
    expect(GRADES.S235.epsilon).toBeCloseTo(1.0, 3);
    expect(GRADES.S355.epsilon).toBeCloseTo(0.814, 3);
  });
});
