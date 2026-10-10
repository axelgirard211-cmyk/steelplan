import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { isValid, rubriqueDe, validateProject } from '../../model/validate';
import {
  buildingLength,
  footprintArea,
  rafterLength,
  ridgeHeight,
  ridgeY,
  roofArea,
} from '../../model/grid';
import { deserializeProject, serializeProject } from '../serialize';
import { FormatError } from '../migrate';
import type { ProjectParams } from '../../model/project';

describe('sérialisation du projet', () => {
  it('fait un aller-retour sans perte', () => {
    const texte = serializeProject(DEFAULT_PROJECT);
    const { project } = deserializeProject(texte);
    expect(project).toEqual(DEFAULT_PROJECT);
  });

  it('relit une liste d’objets de longueur quelconque', () => {
    /*
     * ⚠ Le lecteur ne connaissait qu'une liste d'objets, celle des barres libres ;
     * toute autre tombait dans la branche des listes de NOMBRES et le fichier
     * était refusé. Le jour où le modèle a reçu les couches de peinture, tous les
     * projets enregistrés sont devenus illisibles d'un coup — et rien dans le
     * message d'erreur ne disait pourquoi.
     */
    for (const n of [0, 1, 3]) {
      const couches = Array.from({ length: n }, (_, i) => ({
        nom: `Couche ${i + 1}`,
        epaisseur: 40 + i,
        ral: 'RAL 9010',
      }));
      const p: ProjectParams = {
        ...DEFAULT_PROJECT,
        finition: { ...DEFAULT_PROJECT.finition, couches },
      };
      expect(deserializeProject(serializeProject(p)).project.finition.couches).toEqual(couches);
    }
  });

  it('produit un JSON lisible et versionné', () => {
    const texte = serializeProject(DEFAULT_PROJECT);
    expect(texte).toContain('\n  "version": 1');
    expect(JSON.parse(texte).grid.span).toBe(20000);
  });

  it('complète les champs absents par les valeurs par défaut', () => {
    const partiel = JSON.stringify({ version: 1, grid: { span: 24000 } });
    const { project } = deserializeProject(partiel);
    expect(project.grid.span).toBe(24000);
    expect(project.grid.baySpacing).toBe(DEFAULT_PROJECT.grid.baySpacing);
    expect(project.frame.columnProfile).toBe(DEFAULT_PROJECT.frame.columnProfile);
  });

  it('refuse un champ dont le type est incohérent', () => {
    const mauvais = JSON.stringify({ version: 1, grid: { span: 'vingt mètres' } });
    expect(() => deserializeProject(mauvais)).toThrow(FormatError);
    expect(() => deserializeProject(mauvais)).toThrow(/grid.span/);
  });

  it('refuse un NaN déguisé', () => {
    expect(() => deserializeProject('{"version":1,"grid":{"span":null}}')).toThrow(FormatError);
  });

  it('refuse un fichier sans version, ou d’une version future', () => {
    expect(() => deserializeProject('{"grid":{}}')).toThrow(/version/i);
    expect(() => deserializeProject('{"version":99}')).toThrow(/plus récente/);
  });

  it('refuse un fichier qui n’est pas du JSON', () => {
    expect(() => deserializeProject('<xml/>')).toThrow(/JSON/);
  });

  it('conserve les barres libres', () => {
    const p: ProjectParams = {
      ...DEFAULT_PROJECT,
      freeMembers: [
        {
          id: 'LIB1',
          profile: 'IPE 200',
          grade: 'S275',
          start: { x: 0, y: 0, z: 3000 },
          end: { x: 6000, y: 0, z: 3000 },
          rotation: 90,
          label: 'Linteau',
        },
      ],
    };
    const { project } = deserializeProject(serializeProject(p));
    expect(project.freeMembers).toHaveLength(1);
    expect(project.freeMembers[0]?.label).toBe('Linteau');
    expect(project.freeMembers[0]?.end.x).toBe(6000);
  });
});

describe('validation du projet', () => {
  it('accepte le projet par défaut sans erreur', () => {
    const issues = validateProject(DEFAULT_PROJECT);
    const erreurs = issues.filter((i) => i.level === 'erreur');
    expect(erreurs, JSON.stringify(erreurs, null, 2)).toHaveLength(0);
    expect(isValid(issues)).toBe(true);
  });

  it('détecte un profil absent du catalogue', () => {
    const p = { ...DEFAULT_PROJECT, frame: { ...DEFAULT_PROJECT.frame, columnProfile: 'IPE 999' } };
    const issues = validateProject(p);
    expect(issues.some((i) => i.path === 'frame.columnProfile' && i.level === 'erreur')).toBe(true);
  });

  it('détecte une pince de boulon inférieure au minimum EN 1993-1-8', () => {
    const p: ProjectParams = {
      ...DEFAULT_PROJECT,
      connections: {
        ...DEFAULT_PROJECT.connections,
        rafterToColumn: { ...DEFAULT_PROJECT.connections.rafterToColumn, edgeDistance: 10 },
      },
    };
    const issues = validateProject(p);
    expect(issues.some((i) => i.path === 'connections.rafterToColumn.edgeDistance')).toBe(true);
  });

  it('détecte un jarret plus long que le rampant', () => {
    const p: ProjectParams = {
      ...DEFAULT_PROJECT,
      frame: { ...DEFAULT_PROJECT.frame, haunch: { enabled: true, length: 99000, depth: 700 } },
    };
    expect(validateProject(p).some((i) => i.path === 'frame.haunch.length')).toBe(true);
  });

  it('ne signale qu’UNE faute pour une portée négative, sans erreur en cascade', () => {
    // ⚠ Le jarret « plus long que le rampant de −15 m » n'est pas une seconde
    // faute : c'est la même, vue à travers une grandeur déduite.
    const p: ProjectParams = { ...DEFAULT_PROJECT, grid: { ...DEFAULT_PROJECT.grid, span: -30000 } };
    const erreurs = validateProject(p).filter((i) => i.level === 'erreur');
    expect(erreurs.map((i) => i.path)).toEqual(['grid.span']);
    // Et sans la valeur interne en mm, qui ne correspond pas à ce qu'on a tapé en m.
    expect(erreurs[0]?.message).not.toMatch(/30000/);
  });

  it('nomme la rubrique où corriger, pas le chemin interne', () => {
    expect(rubriqueDe('grid.span')).toBe('Trame — paramètres');
    expect(rubriqueDe('connections.rafterToColumn.rows')).toBe('Assemblages');
    expect(rubriqueDe('truss.nPanels')).toBe('Toiture');
    expect(rubriqueDe('frame.enabled')).toBe('Toiture');
    expect(rubriqueDe('freeMembers[2].profile')).toBe('Barres libres');
  });

  describe('bâtiment long', () => {
    const long: ProjectParams = { ...DEFAULT_PROJECT, grid: { ...DEFAULT_PROJECT.grid, nBays: 24 } };
    const avert = (p: ProjectParams, path: string) =>
      validateProject(p).filter((i) => i.level === 'avertissement' && i.path === path);

    it('signale qu’au-delà de 100 m un joint de dilatation est d’usage', () => {
      expect(avert(long, 'grid.nBays')).toHaveLength(1);
      expect(avert(DEFAULT_PROJECT, 'grid.nBays')).toHaveLength(0);
    });

    it('signale des palées aux seules extrémités, et propose la travée centrale', () => {
      const [a] = avert(long, 'bracing.wall.bays');
      expect(a?.message).toMatch(/travée 13/);
      // Une palée au centre : la file se dilate librement vers les pignons.
      const centree: ProjectParams = {
        ...long,
        bracing: { ...long.bracing, wall: { ...long.bracing.wall, bays: [0, 12, 23] } },
      };
      expect(avert(centree, 'bracing.wall.bays')).toHaveLength(0);
    });

    it('ne dit rien d’un hangar courant', () => {
      expect(avert(DEFAULT_PROJECT, 'bracing.wall.bays')).toHaveLength(0);
    });
  });

  it('refuse deux structures principales simultanées', () => {
    const p: ProjectParams = {
      ...DEFAULT_PROJECT,
      truss: { ...DEFAULT_PROJECT.truss, enabled: true },
    };
    expect(validateProject(p).some((i) => i.path === 'truss.enabled')).toBe(true);
  });
});

describe('géométrie de la trame', () => {
  const g = DEFAULT_PROJECT.grid; // 20 m de portée, bipente 10 %, égout 6 m

  it('place le faîtage au milieu en bipente symétrique', () => {
    expect(ridgeY(g)).toBeCloseTo(10000, 6);
  });

  it('calcule la hauteur au faîtage', () => {
    // 6 m + 10 m × 10 % = 7 m
    expect(ridgeHeight(g)).toBeCloseTo(7000, 6);
  });

  it('calcule la longueur développée du rampant', () => {
    // √(10 000² + 1 000²) = 10 049,88 mm
    expect(rafterLength(g, 'gauche')).toBeCloseTo(Math.hypot(10000, 1000), 6);
    expect(rafterLength(g, 'droite')).toBeCloseTo(rafterLength(g, 'gauche'), 6);
  });

  it('décale le faîtage en bipente dissymétrique', () => {
    const asym = { ...g, asymmetric: true, slopeRight: 20 };
    // Les deux versants doivent arriver à la même altitude au faîtage.
    const y = ridgeY(asym);
    // Les deux versants montent à la même altitude : 10 % sur y = 20 % sur le reste.
    expect(y * 0.1).toBeCloseTo((asym.span - y) * 0.2, 6);
    // Le versant à 20 % monte deux fois plus vite : il lui faut deux fois moins
    // de portée, donc le faîtage s'éloigne de lui.
    expect(y).toBeCloseTo(13333.33, 1);
    expect(ridgeHeight(asym)).toBeCloseTo(6000 + 1333.33, 1);
  });

  it('place le point haut sur l’appui opposé en monopente', () => {
    const mono = { ...g, roofType: 'monopente' as const };
    expect(ridgeY(mono)).toBe(20000);
    expect(ridgeHeight(mono)).toBeCloseTo(8000, 6); // 6 m + 20 m × 10 %
  });

  it('calcule longueurs et surfaces du bâtiment', () => {
    expect(buildingLength(g)).toBe(30000); // 5 travées de 6 m
    expect(footprintArea(g)).toBeCloseTo(600, 6); // 20 × 30 m
    expect(roofArea(g)).toBeCloseTo((2 * Math.hypot(10000, 1000) * 30000) / 1e6, 6);
  });
});

/* ================================================================== */
/* Listes vides par défaut : ouvertures et historique des indices      */
/* ================================================================== */

describe('listes dont la valeur par défaut est vide', () => {
  /*
   * ⚠ LE PIÈGE DÉJÀ RENCONTRÉ DEUX FOIS. Une liste d'objets vide par défaut ne
   * fournit aucun gabarit au relecteur : sans lecteur dédié, il tombe dans la
   * branche des nombres et REFUSE le fichier. C'est ainsi que l'arrivée des
   * couches de peinture avait rendu illisible chaque projet enregistré. Ces
   * tests font l'aller-retour complet avec des listes NON vides.
   */
  const AVEC = {
    ...DEFAULT_PROJECT,
    meta: {
      ...DEFAULT_PROJECT.meta,
      indice: 'B',
      revisions: [
        { indice: 'A', date: '2026-09-01', objet: 'Première diffusion', auteur: 'LM' },
        { indice: 'B', date: '2026-10-04', objet: 'Ajout du portail P1', auteur: 'LM' },
      ],
    },
    ouvertures: {
      ...DEFAULT_PROJECT.ouvertures,
      enabled: true,
      items: [
        {
          id: 'P1',
          face: 'long-pan-gauche' as const,
          type: 'portail' as const,
          position: 8000,
          largeur: 4000,
          hauteur: 4500,
          allege: 0,
        },
      ],
    },
  };

  it('relit à l’identique un projet portant des indices et des ouvertures', () => {
    const relu = deserializeProject(serializeProject(AVEC)).project;
    expect(relu.meta.revisions).toEqual(AVEC.meta.revisions);
    expect(relu.ouvertures.items).toEqual(AVEC.ouvertures.items);
  });

  it('lit un fichier ANCIEN, sans historique ni ouvertures, avec des listes vides', () => {
    const ancien = JSON.parse(serializeProject(DEFAULT_PROJECT)) as Record<string, unknown>;
    delete (ancien['meta'] as Record<string, unknown>)['revisions'];
    delete ancien['ouvertures'];
    const relu = deserializeProject(JSON.stringify(ancien)).project;
    expect(relu.meta.revisions).toEqual([]);
    expect(relu.ouvertures.items).toEqual([]);
  });

  it('refuse une diffusion mal formée plutôt que de dessiner un cartouche faux', () => {
    const casse = JSON.parse(serializeProject(AVEC)) as { meta: { revisions: unknown[] } };
    casse.meta.revisions[0] = { indice: 3, date: '2026-09-01', objet: '', auteur: '' };
    expect(() => deserializeProject(JSON.stringify(casse))).toThrow(/meta\.revisions\[0\]\.indice/);
  });
});

describe('cohérence du cartouche et des indices', () => {
  it('signale un cartouche dont l’indice n’est pas la dernière diffusion', () => {
    const p = {
      ...DEFAULT_PROJECT,
      meta: {
        ...DEFAULT_PROJECT.meta,
        indice: 'C',
        revisions: [{ indice: 'B', date: '2026-10-04', objet: '', auteur: '' }],
      },
    };
    const avert = validateProject(p).filter((i) => i.path === 'meta.indice');
    expect(avert).toHaveLength(1);
    expect(avert[0]?.level).toBe('avertissement');
    // Un écart de cartouche ne doit JAMAIS bloquer la génération du modèle.
    expect(isValid(validateProject(p))).toBe(true);
  });
});
