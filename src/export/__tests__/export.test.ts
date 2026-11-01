import { describe, expect, it } from 'vitest';
import { buildProject } from '../../core/build/buildProject';
import { buildSheets } from '../../core/drawing/buildSheets';
import { flattenArc, flattenCircle, hatchLines } from '../../core/drawing/hatch';
import { FORMATS } from '../../core/drawing/layout';
import { DrawScene, pt, type DrawEntity } from '../../core/drawing/scene';
import type { Sheet } from '../../core/drawing/sheet';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import { sheetToSvg } from '../../render2d/svgString';
import { sheetToDxf } from '../dxf';
import { sheetsToPdf, sheetToPdf } from '../pdf';

const P = DEFAULT_PROJECT;
const SHEETS = buildSheets(buildProject(P), P);
const feuille = (id: string): Sheet => {
  const s = SHEETS.find((x) => x.id === id);
  if (!s) throw new Error(`planche ${id} absente`);
  return s;
};

/* ================================================================== */
/* Hachures : un seul calcul pour les trois formats                    */
/* ================================================================== */

describe('développement des hachures', () => {
  const carre = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];

  it('remplit un carré de traits régulièrement espacés', () => {
    const traits = hatchLines(carre, [], 2, 0);
    expect(traits.length).toBeGreaterThan(3);
    // Hachures horizontales : chaque trait traverse le carré de bord à bord.
    for (const s of traits) {
      expect(s.a.y).toBeCloseTo(s.b.y, 9);
      expect(Math.min(s.a.x, s.b.x)).toBeCloseTo(0, 9);
      expect(Math.max(s.a.x, s.b.x)).toBeCloseTo(10, 9);
    }
  });

  it('cale les traits sur une grille absolue, pour que deux zones s’alignent', () => {
    const a = hatchLines(carre, [], 2, 0).map((s) => s.a.y);
    const decale = carre.map((q) => pt(q.x + 30, q.y));
    const b = hatchLines(decale, [], 2, 0).map((s) => s.a.y);
    // Deux zones voisines hachurées au même pas doivent partager les mêmes
    // altitudes de trait, sinon le raccord se voit à l'œil.
    expect(a).toEqual(b);
  });

  it('évide les trous : rien ne traverse un perçage', () => {
    // Trou carré au centre, parcouru en sens inverse.
    const trou = [pt(4, 4), pt(4, 6), pt(6, 6), pt(6, 4)];
    const traits = hatchLines(carre, [trou], 1, 0);
    const auTravers = traits.filter(
      (s) => Math.abs(s.a.y - 5) < 1e-9 && Math.min(s.a.x, s.b.x) < 4 && Math.max(s.a.x, s.b.x) > 6,
    );
    expect(auTravers).toHaveLength(0);
    // Et à cette altitude, deux tronçons subsistent de part et d'autre du trou.
    const surLaLigne = traits.filter((s) => Math.abs(s.a.y - 5) < 1e-9);
    expect(surLaLigne).toHaveLength(2);
  });

  it('ne laisse rien fuir hors du contour, même sur un sommet', () => {
    // Triangle dont un sommet tombe pile sur une ligne de balayage.
    const triangle = [pt(0, 0), pt(10, 0), pt(5, 10)];
    for (const s of hatchLines(triangle, [], 1, 0)) {
      expect(Math.min(s.a.x, s.b.x)).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.max(s.a.x, s.b.x)).toBeLessThanOrEqual(10 + 1e-9);
      expect(s.a.y).toBeGreaterThanOrEqual(-1e-9);
      expect(s.a.y).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('incline les hachures à l’angle demandé', () => {
    const traits = hatchLines(carre, [], 2, 45);
    expect(traits.length).toBeGreaterThan(2);
    for (const s of traits) {
      const angle = (Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI;
      expect(Math.abs(((angle % 180) + 180) % 180)).toBeCloseTo(45, 6);
    }
  });

  it('refuse un contour dégénéré sans planter', () => {
    expect(hatchLines([pt(0, 0), pt(1, 1)], [], 2, 0)).toEqual([]);
    expect(hatchLines(carre, [], 0, 0)).toEqual([]);
  });
});

describe('aplatissement des arcs', () => {
  it('respecte la flèche de corde demandée', () => {
    const r = 50;
    const pts = flattenArc(pt(0, 0), r, 0, Math.PI / 2, 0.05);
    expect(pts.length).toBeGreaterThan(4);
    // Tous les points sont sur le cercle…
    for (const q of pts) expect(Math.hypot(q.x, q.y)).toBeCloseTo(r, 9);
    // …et le milieu de chaque corde ne s'en écarte pas de plus que la flèche.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as { x: number; y: number };
      const b = pts[i] as { x: number; y: number };
      const fleche = r - Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2);
      expect(fleche).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it('ferme le cercle sans doubler son premier point', () => {
    const pts = flattenCircle(pt(1, 2), 10);
    expect(pts.length).toBeGreaterThan(8);
    const premier = pts[0] as { x: number; y: number };
    const dernier = pts[pts.length - 1] as { x: number; y: number };
    expect(Math.hypot(dernier.x - premier.x, dernier.y - premier.y)).toBeGreaterThan(1e-6);
  });
});

/* ================================================================== */
/* Export PDF                                                          */
/* ================================================================== */

describe('export PDF', () => {
  it('produit un document PDF valide', async () => {
    const blob = sheetToPdf(feuille('debit-PO1'));
    expect(blob.type).toBe('application/pdf');
    const tete = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    expect(String.fromCharCode(...tete)).toBe('%PDF-');
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('écrit une page par planche du dossier', async () => {
    const blob = sheetsToPdf(SHEETS.slice(0, 4));
    const texte = await blob.text();
    // Le PDF déclare le nombre de pages dans son arbre de pages.
    const m = /\/Count (\d+)/.exec(texte);
    expect(m?.[1]).toBe('4');
  });

  it('produit des pages aux dimensions physiques du format', async () => {
    const blob = sheetToPdf(feuille('plan')); // A3 paysage
    const texte = await blob.text();
    // 420 × 297 mm, exprimés en points : 1190,55 × 841,89.
    const boite = /\/MediaBox \[([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)\]/.exec(texte);
    expect(boite).not.toBeNull();
    const largeur = Number(boite?.[3]);
    const hauteur = Number(boite?.[4]);
    expect((largeur / 72) * 25.4).toBeCloseTo(FORMATS.A3.largeur, 0);
    expect((hauteur / 72) * 25.4).toBeCloseTo(FORMATS.A3.hauteur, 0);
  });

  it('inscrit les propriétés du document', async () => {
    const texte = await sheetsToPdf(SHEETS.slice(0, 2), {
      titre: 'Hangar Dupont',
      auteur: 'A. Girard',
    }).text();
    expect(texte).toContain('SteelPlan');
  });

  it('exporte le dossier complet sans exception', () => {
    expect(() => sheetsToPdf(SHEETS)).not.toThrow();
    expect(sheetsToPdf(SHEETS).size).toBeGreaterThan(10_000);
  });

  it('refuse un dossier vide plutôt que d’écrire une page blanche', () => {
    expect(() => sheetsToPdf([])).toThrow(/Aucune planche/);
  });
});

/* ================================================================== */
/* Export DXF                                                          */
/* ================================================================== */

describe('export DXF', () => {
  const dxf = sheetToDxf(feuille('debit-PO1'));

  it('produit un fichier DXF structuré et terminé', () => {
    for (const section of ['HEADER', 'TABLES', 'ENTITIES']) {
      expect(dxf).toContain(`SECTION\r\n  2\r\n${section}`.replace('  2', '2'));
    }
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    // Autant d'ouvertures que de fermetures de section.
    expect(dxf.split('\r\nSECTION\r\n').length - 1).toBe(3);
    expect(dxf.split('\r\nENDSEC\r\n').length - 1).toBe(3);
  });

  it('déclare les unités en millimètres', () => {
    expect(dxf).toContain('$INSUNITS');
    expect(dxf).toContain('$MEASUREMENT');
  });

  it('déclare un calque par calque du dessin, avec son épaisseur normalisée', () => {
    for (const nom of ['CONTOUR', 'COTATION', 'AXE', 'TEXTE', 'CARTOUCHE', 'HACHURE']) {
      expect(dxf, `calque ${nom}`).toContain(`\r\n${nom}\r\n`);
    }
    // Épaisseurs en centièmes de millimètre : 0,5 mm ⇒ 50.
    expect(dxf).toContain('\r\n370\r\n50\r\n');
    expect(dxf).toContain('\r\n370\r\n18\r\n');
  });

  it('déclare les types de ligne interrompu et mixte', () => {
    expect(dxf).toContain('TIRETE');
    expect(dxf).toContain('AXE');
    expect(dxf).toContain('CONTINUOUS');
  });

  it('écrit les entités attendues', () => {
    for (const type of ['LINE', 'POLYLINE', 'VERTEX', 'SEQEND', 'CIRCLE', 'TEXT']) {
      expect(dxf, `entité ${type}`).toContain(`\r\n${type}\r\n`);
    }
  });

  it('conserve le repère du dessin : le DXF a lui aussi son Y vers le haut', () => {
    // Le cadre part de (20, 10) : on doit retrouver ces coordonnées telles quelles.
    expect(dxf).toContain('\r\n10\r\n20\r\n');
    expect(dxf).toContain('\r\n20\r\n10\r\n');
  });

  it('ne contient ni NaN ni valeur non finie', () => {
    expect(dxf).not.toContain('NaN');
    expect(dxf).not.toContain('Infinity');
    expect(dxf).not.toContain('undefined');
  });

  it('exporte chaque planche du dossier sans exception', () => {
    for (const s of SHEETS) {
      const out = sheetToDxf(s);
      expect(out.includes('NaN'), s.titre).toBe(false);
      expect(out.trimEnd().endsWith('EOF'), s.titre).toBe(true);
    }
  });

  it('éclate les hachures en traits, faute d’entité de hachure en R12', () => {
    const coupe = SHEETS.find((s) => s.kind === 'coupe') as Sheet;
    const nbHachures = coupe.scene.entities.filter((e) => e.kind === 'hachure').length;
    expect(nbHachures).toBeGreaterThan(0);
    const traitsAttendus = coupe.scene.entities
      .filter((e): e is Extract<DrawEntity, { kind: 'hachure' }> => e.kind === 'hachure')
      .reduce((s, e) => s + hatchLines(e.contour, e.trous, e.pas, e.angle).length, 0);
    expect(traitsAttendus).toBeGreaterThan(0);
    // Toutes ces lignes atterrissent sur le calque HACHURE.
    const out = sheetToDxf(coupe);
    const surHachure = out.split('\r\nHACHURE\r\n').length - 1;
    expect(surHachure).toBeGreaterThanOrEqual(traitsAttendus);
  });
});

/* ================================================================== */
/* Concordance des trois formats                                       */
/* ================================================================== */

describe('les trois formats montrent le même dessin', () => {
  it('hachurent tous les trois avec les mêmes traits', () => {
    const s = new DrawScene();
    const carre = [pt(0, 0), pt(20, 0), pt(20, 20), pt(0, 20)];
    s.hachure(carre, [], 2, 45);
    const planche: Sheet = { id: 't', kind: 'debit', titre: 't', format: 'A4', echelle: 1, scene: s };

    const attendus = hatchLines(carre, [], 2, 45);
    expect(attendus.length).toBeGreaterThan(5);

    // SVG : autant de sous-chemins « M … L … » que de traits calculés.
    const svg = sheetToSvg(planche);
    expect((svg.match(/M /g) ?? []).length).toBe(attendus.length);

    // DXF : autant d'entités LINE sur le calque HACHURE.
    const dxf = sheetToDxf(planche);
    expect((dxf.match(/\r\nLINE\r\n/g) ?? []).length).toBe(attendus.length);
  });

  it('écrivent le même texte, avec la même hauteur nominale', () => {
    const s = new DrawScene();
    s.texte(pt(50, 50), 'Repère PO1', { hauteur: 2.5 });
    const planche: Sheet = { id: 't', kind: 'debit', titre: 't', format: 'A4', echelle: 1, scene: s };

    expect(sheetToSvg(planche)).toContain('Repère PO1');
    const dxf = sheetToDxf(planche);
    expect(dxf).toContain('Repère PO1');
    // La hauteur de caractère du DXF est la hauteur nominale du dessin.
    expect(dxf).toContain('\r\n40\r\n2.5\r\n');
  });

  it('placent les entités aux mêmes coordonnées de feuille', () => {
    const s = new DrawScene();
    s.ligne(pt(30, 40), pt(80, 40));
    const planche: Sheet = { id: 't', kind: 'debit', titre: 't', format: 'A4', echelle: 1, scene: s };

    // Le SVG retourne l'axe Y (feuille A4 : 210 mm de haut), pas le DXF.
    expect(sheetToSvg(planche)).toContain('y1="170"');
    const dxf = sheetToDxf(planche);
    expect(dxf).toContain('\r\n10\r\n30\r\n');
    expect(dxf).toContain('\r\n20\r\n40\r\n');
  });
});

describe('garde-fous du développement', () => {
  const carre = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)];

  it('n’alloue ni hachure de pas infime ni arc de balayage démesuré', () => {
    expect(hatchLines(carre, [], 1e-9, 45)).toEqual([]);
    expect(hatchLines(carre, [], Number.NaN, 45)).toEqual([]);
    expect(hatchLines(carre, [], 2, 45).length).toBeGreaterThan(0);
    expect(flattenArc(pt(0, 0), 10, 0, 1e12).length).toBeLessThanOrEqual(4097);
  });
});
