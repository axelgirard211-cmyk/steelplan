import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { groupByMark } from '../../build/marks';
import { elementsAFabriquer } from '../sheets/element';
import { cutAngleDeg, cutLengths, type Member } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { roundMm } from '../../math/tolerance';
import { buildSheets } from '../buildSheets';
import { coteLineaire, coteRepetee, formatNiveau } from '../dimension';
import { FORMATS, fenetreDe, formatDate, dessinerCadre } from '../layout';
import { choisirEchelle, ECHELLES, libelleEchelle } from '../scale';
import { DrawScene, pt, type DrawEntity } from '../scene';
import type { Sheet } from '../sheet';
import { appliquer, cadrer, project, VUE_PLAN, VUE_TRANSVERSALE } from '../view';
import { sheetToSvg } from '../../../render2d/svgString';

const P = DEFAULT_PROJECT;
const M = buildProject(P);
const SHEETS = buildSheets(M, P);

/** Tous les textes d'une planche, pour vérifier ce qui est réellement écrit. */
const textes = (s: Sheet): string[] =>
  s.scene.entities.filter((e): e is Extract<DrawEntity, { kind: 'texte' }> => e.kind === 'texte').map((e) => e.texte);

const compter = (s: Sheet, kind: DrawEntity['kind']): number =>
  s.scene.entities.filter((e) => e.kind === kind).length;

describe('échelles normalisées', () => {
  it('ne retient jamais une échelle hors de la série', () => {
    const fenetre = fenetreDe('A3');
    for (const taille of [500, 1200, 3400, 7800, 20000, 45000, 120000]) {
      const e = choisirEchelle({ min: pt(0, 0), max: pt(taille, taille / 2) }, fenetre);
      expect(ECHELLES, `emprise ${taille}`).toContain(e);
    }
  });

  it('retient la plus grande échelle à laquelle le dessin tient', () => {
    const fenetre = { min: pt(0, 0), max: pt(100, 100) };
    // 1 000 mm dans 100 mm : il faut 1:10, et 1:5 ne suffirait pas.
    expect(choisirEchelle({ min: pt(0, 0), max: pt(1000, 1000) }, fenetre)).toBe(10);
    expect(choisirEchelle({ min: pt(0, 0), max: pt(400, 400) }, fenetre)).toBe(5);
  });

  it('écrit l’échelle à la française', () => {
    expect(libelleEchelle(50)).toBe('1:50');
  });
});

describe('cadrage modèle → papier', () => {
  it('centre l’emprise dans la fenêtre', () => {
    const emprise = { min: pt(0, 0), max: pt(1000, 500) };
    const fenetre = { min: pt(0, 0), max: pt(100, 100) };
    const t = cadrer(emprise, fenetre, 20);
    const a = appliquer(t, emprise.min);
    const b = appliquer(t, emprise.max);
    expect(b.x - a.x).toBeCloseTo(50, 9); // 1 000 mm à 1:20
    expect(b.y - a.y).toBeCloseTo(25, 9);
    // Marges égales de part et d'autre.
    expect(a.x - fenetre.min.x).toBeCloseTo(fenetre.max.x - b.x, 9);
    expect(a.y - fenetre.min.y).toBeCloseTo(fenetre.max.y - b.y, 9);
  });

  it('conserve les rapports : le cadrage est une similitude', () => {
    const t = cadrer({ min: pt(0, 0), max: pt(1000, 500) }, { min: pt(0, 0), max: pt(100, 100) }, 20);
    // Même facteur en x et en y, donc les angles du dessin sont exacts.
    const dx = appliquer(t, pt(100, 0)).x - appliquer(t, pt(0, 0)).x;
    const dy = appliquer(t, pt(0, 100)).y - appliquer(t, pt(0, 0)).y;
    expect(dx).toBeCloseTo(dy, 12);
  });

  it('projette dans les vues normalisées', () => {
    const p = { x: 1000, y: 2000, z: 3000 };
    expect(project(p, VUE_PLAN)).toEqual(pt(1000, 2000));
    expect(project(p, VUE_TRANSVERSALE)).toEqual(pt(2000, 3000));
  });
});

describe('cotation — la valeur inscrite vient du modèle', () => {
  /**
   * Le test le plus important du module : une cote doit porter la valeur du
   * modèle, jamais une mesure du dessin. Autrement, toute erreur d'échelle
   * deviendrait une cote fausse sur un plan d'atelier.
   */
  it('inscrit la valeur modèle, indépendamment de l’échelle du dessin', () => {
    for (const echelle of [5, 20, 50, 100]) {
      const s = new DrawScene();
      const t = cadrer({ min: pt(0, 0), max: pt(1000, 100) }, fenetreDe('A4'), echelle);
      coteLineaire(s, appliquer(t, pt(0, 0)), appliquer(t, pt(1000, 0)), 10, 1000);
      const t2 = s.entities.filter((e) => e.kind === 'texte');
      expect(t2.map((e) => (e as { texte: string }).texte), `1:${echelle}`).toContain('1000');
    }
  });

  it('n’invente pas la valeur depuis la distance papier', () => {
    const s = new DrawScene();
    // Deux points distants de 40 mm papier, mais cotés 12 345 mm modèle.
    coteLineaire(s, pt(0, 0), pt(40, 0), 10, 12345);
    expect(textesDe(s)).toContain('12345');
    expect(textesDe(s)).not.toContain('40');
  });

  it('arrondit au millimètre, jamais en dessous', () => {
    const s = new DrawScene();
    coteLineaire(s, pt(0, 0), pt(50, 0), 10, 6180.998);
    expect(textesDe(s)).toContain('6181');
  });

  it('trace deux lignes d’attache, une ligne de cote et deux flèches', () => {
    const s = new DrawScene();
    coteLineaire(s, pt(0, 0), pt(50, 0), 10, 1000);
    expect(s.entities.filter((e) => e.kind === 'ligne')).toHaveLength(3);
    expect(s.entities.filter((e) => e.kind === 'remplissage')).toHaveLength(2);
  });

  it('note les entraxes répétés sous la forme n × e = total', () => {
    const s = new DrawScene();
    coteRepetee(s, pt(0, 0), pt(100, 0), 10, 5, 6000);
    expect(textesDe(s)).toContain('5 × 6000 = 30000');
  });

  it('écrit les niveaux en mètres, signés, à trois décimales', () => {
    expect(formatNiveau(7000)).toBe('+7.000');
    expect(formatNiveau(0)).toBe('+0.000');
    expect(formatNiveau(-1250)).toBe('−1.250');
  });

  it('redresse le texte des cotes pour qu’il reste lisible', () => {
    const s = new DrawScene();
    // Cote tracée de droite à gauche : le texte ne doit pas être à l'envers.
    coteLineaire(s, pt(100, 0), pt(0, 0), 10, 1000);
    const texte = s.entities.find((e) => e.kind === 'texte') as { rotation: number };
    expect(Math.abs(texte.rotation)).toBeLessThanOrEqual(90);
  });
});

describe('cartouche', () => {
  const s = new DrawScene();
  const fenetre = dessinerCadre(s, 'A3', {
    meta: { ...P.meta, nom: 'Hangar Dupont', client: 'SCI Dupont', dessinateur: 'A. Girard', indice: 'B', date: '2026-07-25', chantier: '', commentaire: '' },
    titre: 'Coupe transversale',
    echelle: 50,
    page: 3,
    total: 12,
  });

  it('porte toutes les mentions attendues d’un plan d’atelier', () => {
    const t = textesDe(s);
    expect(t).toContain('Hangar Dupont');
    expect(t).toContain('SCI Dupont');
    expect(t).toContain('Coupe transversale');
    expect(t).toContain('1:50');
    expect(t).toContain('25/07/2026');
    expect(t).toContain('B');
    expect(t).toContain('A. Girard');
    expect(t).toContain('3/12');
  });

  it('affiche en permanence la limite d’usage du logiciel', () => {
    expect(textesDe(s).some((x) => x.includes('ne remplace pas la note de calcul'))).toBe(true);
  });

  it('réserve la zone du cartouche : la fenêtre de dessin est au-dessus', () => {
    expect(fenetre.min.y).toBeGreaterThan(45);
    expect(fenetre.max.x).toBeLessThan(FORMATS.A3.largeur);
    expect(fenetre).toEqual(fenetreDe('A3'));
  });

  it('convertit la date au format français', () => {
    expect(formatDate('2026-01-09')).toBe('09/01/2026');
    expect(formatDate('pas une date')).toBe('pas une date');
  });
});

describe('dossier de plans', () => {
  it('produit les plans d’ensemble, puis un plan de débit par repère', () => {
    const reperes = groupByMark(M.members).size;
    /*
     * Vue en plan, PLANCHE D'ÉLÉVATION réunissant les quatre faces, puis les
     * quatre façades détaillées, 2 coupes, 3 détails d'assemblage, puis les
     * débits. La planche d'élévation ne remplace pas les façades : elle sert à
     * comprendre l'ouvrage d'un coup d'œil, elles servent à le barder.
     */
    expect(SHEETS.slice(0, 11).map((s) => s.kind)).toEqual([
      'ensemble',
      'elevation',
      'elevation',
      'elevation',
      'elevation',
      'elevation',
      'coupe',
      'coupe',
      'detail',
      'detail',
      'detail',
    ]);
    expect(SHEETS[1]?.id).toBe('elevations');
    expect(SHEETS.filter((s) => s.kind === 'debit')).toHaveLength(reperes);
  });

  it('donne à chaque pièce son plan, et un plan d’assemblage à ce qui s’assemble', () => {
    /*
     * ⚠ Chaque repère de DÉBIT a son plan de pièce — la scie et la perceuse en
     * ont besoin pour toutes les barres, échantignolles comprises. Chaque
     * élément qui porte quelque chose de soudé a EN PLUS son plan d'assemblage.
     * Une pièce nue n'en a pas : le dossier éditait pour elle deux planches
     * identiques, la même barre avec les mêmes trous.
     */
    const reperesDeDebit = new Set(M.members.map((m) => m.mark));
    const pieces = SHEETS.filter((s) => s.kind === 'debit');
    expect(new Set(pieces.map((s) => s.id))).toEqual(new Set([...reperesDeDebit].map((r) => `debit-${r}`)));
    const soudes = elementsAFabriquer(M).filter((e) => e.toles.length + e.jarrets.length + e.pieces.length > 0);
    expect(soudes.length).toBeGreaterThan(0);
    expect(new Set(SHEETS.filter((s) => s.kind === 'fabrication').map((s) => s.id))).toEqual(
      new Set(soudes.map((e) => `fabrication-${e.repere}`)),
    );
    // Les assemblages viennent après les pièces : on débite avant de souder.
    const dernierDebit = SHEETS.map((s) => s.kind).lastIndexOf('debit');
    const premiereFab = SHEETS.map((s) => s.kind).indexOf('fabrication');
    expect(premiereFab).toBeGreaterThan(dernierDebit);
  });

  it('numérote chaque planche de son rang dans le dossier complet', () => {
    // Le numéro est écrit APRÈS constitution du dossier : il ne peut pas
    // diverger du nombre de planches qu'il annonce.
    for (const [i, s] of SHEETS.entries()) {
      const t = s.scene.entities.flatMap((e) => (e.kind === 'texte' ? [e.texte] : []));
      expect(t, s.titre).toContain(`${i + 1}/${SHEETS.length}`);
      expect(t.some((x) => x.includes('§')), s.titre).toBe(false);
    }
  });

  it('coupe une file courante, et le pignon séparément', () => {
    const coupes = SHEETS.filter((s) => s.kind === 'coupe');
    expect(coupes).toHaveLength(2);
    // La première coupe ne doit pas être un pignon : c'est le cas général.
    expect(coupes[0]?.titre).toBe('Coupe A-A — file 3');
    expect(coupes[1]?.titre).toBe('Coupe B-B — file 1 (pignon)');
  });

  it('DONNE UNE VUE DE CHAQUE FACE', () => {
    /*
     * ⚠ Le dossier n'en portait qu'une, celle du long pan avant. Une « coupe de
     * pignon » n'en tient pas lieu : une coupe montre ce qu'il y a dedans, une
     * façade ce qu'on voit du dehors — le bardage, ses lisses, ses potelets.
     * C'est le document du bardeur, et celui sur lequel se repère une ouverture.
     */
    const facades = SHEETS.filter((s) => s.id.startsWith('facade-')).map((s) => s.id);
    expect(facades.sort()).toEqual([
      'facade-arriere',
      'facade-avant',
      'facade-est',
      'facade-ouest',
    ]);
  });

  it('REPÈRE chaque coupe sur la vue en plan, par sa lettre', () => {
    /*
     * ⚠ Sans trait de coupe, une planche « Coupe — file 3 » oblige à compter les
     * files sur la vue en plan pour savoir ce qu'on regarde. Le trait et le titre
     * portent la même lettre : le lien se lit sans compter.
     */
    const plan = SHEETS.find((s) => s.kind === 'ensemble') as Sheet;
    const surLePlan = plan.scene.entities.flatMap((e) =>
      e.kind === 'texte' && e.layer === 'reperage' ? [e.texte] : [],
    );
    for (const c of SHEETS.filter((s) => s.kind === 'coupe')) {
      const lettre = /Coupe ([A-Z])-/.exec(c.titre)?.[1];
      expect(lettre, c.titre).toBeDefined();
      expect(surLePlan, `${c.titre} : aucun trait de coupe sur la vue en plan`).toContain(lettre);
    }
  });

  it('numérote les pages de 1 à n sur toutes les planches', () => {
    const pages = SHEETS.flatMap((s) => textesDe(s.scene).filter((t) => /^\d+\/\d+$/.test(t)));
    expect(pages).toHaveLength(SHEETS.length);
    expect(pages[0]).toBe(`1/${SHEETS.length}`);
    expect(pages[pages.length - 1]).toBe(`${SHEETS.length}/${SHEETS.length}`);
  });

  it('n’émet que des échelles normalisées, planche par planche', () => {
    for (const s of SHEETS) expect(ECHELLES, s.titre).toContain(s.echelle);
  });

  it('est reconstruit à l’identique : le dossier est une fonction du modèle', () => {
    const a = buildSheets(M, P);
    const b = buildSheets(M, P);
    expect(JSON.stringify(a.map((s) => s.scene.entities))).toBe(
      JSON.stringify(b.map((s) => s.scene.entities)),
    );
  });
});

describe('plan de débit', () => {
  const parRepere = (mark: string): Sheet => {
    const s = SHEETS.find((x) => x.id === `debit-${mark}`);
    if (!s) throw new Error(`planche ${mark} absente`);
    return s;
  };

  it('porte la longueur de coupe et les fibres extrêmes du poteau', () => {
    const poteau = groupByMark(M.members).get('PO1')?.[0] as Member;
    const l = cutLengths(poteau);
    const t = textes(parRepere('PO1'));
    expect(t).toContain(`${roundMm(l.axis)}`);
    expect(t).toContain(`maxi ${roundMm(l.max)} — mini ${roundMm(l.min)}`);
    // ⚠ Le poteau ne fait PAS la hauteur d'égout : il monte jusqu'au plan du
    // dessus de traverse, 6000 + 180 / cos α. C'est cette longueur-là qu'on
    // débite, et donc celle que porte le plan.
    expect(roundMm(l.axis)).toBe(6181);
  });

  it('porte l’angle de coupe tel qu’il se règle sur la scie', () => {
    const poteau = groupByMark(M.members).get('PO1')?.[0] as Member;
    const surLaScie = 90 - cutAngleDeg(poteau, 'end');
    const t = textes(parRepere('PO1'));
    expect(t).toContain('90°'); // pied scié droit
    expect(t).toContain(`${surLaScie.toFixed(1)}°`); // 47.9° au genou
  });

  it('note 90° aux deux abouts d’une pièce coupée droite', () => {
    const t = textes(parRepere('PA1'));
    expect(t.filter((x) => x === '90°')).toHaveLength(2);
  });

  it('dessine un cercle par perçage, dans la vue qui le montre en vraie forme', () => {
    const panne = groupByMark(M.members).get('PA1')?.[0] as Member;
    // 4 trous d'échantignole dans la semelle, 2 passages de lierne dans l'âme.
    expect(panne.holes).toHaveLength(6);
    expect(compter(parRepere('PA1'), 'cercle')).toBeGreaterThanOrEqual(6);
  });

  it('cote les perçages depuis l’about d’origine', () => {
    const poteau = groupByMark(M.members).get('PO1')?.[0] as Member;
    const t = textes(parRepere('PO1'));
    const premier = Math.min(...poteau.holes.map((h) => h.s));
    expect(t).toContain(`${roundMm(premier)}`);
  });

  it('récapitule profil, nuance, quantité et masse', () => {
    const t = textes(parRepere('PO1'));
    expect(t).toContain('IPE 400');
    expect(t).toContain('S235');
    expect(t).toContain('12'); // 12 poteaux identiques
    expect(t.some((x) => x.endsWith(' kg'))).toBe(true);
  });

  it('trace la section hachurée de la pièce', () => {
    expect(compter(parRepere('PO1'), 'hachure')).toBeGreaterThanOrEqual(1);
  });
});

describe('plans d’ensemble', () => {
  /*
   * ⚠ Les planches sont retrouvées par leur NATURE, jamais par leur rang. Le jour
   * où le dossier est passé d'une élévation à quatre, tous les index ont glissé
   * d'un cran et quatre contrôles se sont mis à examiner la mauvaise planche —
   * en échouant, heureusement, mais ils auraient aussi bien pu passer.
   */
  const plan = SHEETS.find((s) => s.kind === 'ensemble') as Sheet;
  const elevation = SHEETS.find((s) => s.id === 'facade-avant') as Sheet;
  const coupe = SHEETS.find((s) => s.kind === 'coupe') as Sheet;

  it('cote la trame en plan : entraxes répétés et portée', () => {
    const t = textes(plan);
    expect(t).toContain(`${P.grid.nBays} × ${P.grid.baySpacing} = ${P.grid.nBays * P.grid.baySpacing}`);
    expect(t).toContain(`${P.grid.span}`);
  });

  it('repère les files de portiques en plan', () => {
    const t = textes(plan);
    for (let i = 1; i <= P.grid.nBays + 1; i++) expect(t).toContain(`${i}`);
  });

  it('cote hauteur d’égout et niveaux en élévation', () => {
    const t = textes(elevation);
    expect(t).toContain(`${P.grid.eaveHeight}`);
    expect(t).toContain('+0.000');
    expect(t).toContain('+6.000');
  });

  it('cote portée, hauteurs, pente et niveaux en coupe', () => {
    const t = textes(coupe);
    expect(t).toContain(`${P.grid.span}`);
    expect(t).toContain(`${P.grid.eaveHeight}`);
    expect(t).toContain('+7.000'); // faîtage
    expect(t).toContain('pente 10 %');
    expect(t.some((x) => x === '5.7°')).toBe(true);
  });

  it('hachure les pannes coupées par le plan de coupe', () => {
    expect(compter(coupe, 'hachure')).toBeGreaterThan(5);
  });

  it('ne dessine qu’une façade en élévation, pour ne pas superposer les long pans', () => {
    // Les lisses de la façade y = span ne doivent pas s'y retrouver.
    const ySpan = M.members.filter((m) => m.role === 'lisse' && m.start.y > P.grid.span / 2);
    expect(ySpan.length).toBeGreaterThan(0);
    // Comptage indirect : la planche contient moins de polylignes que le modèle
    // n'a de barres au total.
    expect(compter(elevation, 'polyligne')).toBeLessThan(M.members.length);
  });
});

describe('rendu SVG', () => {
  const svg = sheetToSvg(SHEETS.find((s) => s.kind === 'coupe') as Sheet);

  it('produit une feuille aux dimensions physiques exactes', () => {
    expect(svg).toContain('width="420mm"');
    expect(svg).toContain('height="297mm"');
    expect(svg).toContain('viewBox="0 0 420 297"');
  });

  it('retourne l’axe vertical : le dessin monte, le SVG descend', () => {
    const s = new DrawScene();
    s.ligne(pt(0, 0), pt(10, 0));
    const out = sheetToSvg({ id: 't', kind: 'debit', titre: 't', format: 'A4', echelle: 1, scene: s });
    // y = 0 dans le dessin ⇒ y = 210 en SVG sur un A4 paysage.
    expect(out).toContain('y1="210"');
  });

  it('applique les épaisseurs normalisées par calque', () => {
    expect(svg).toContain('stroke-width="0.5"'); // contour
    expect(svg).toContain('stroke-width="0.18"'); // cotation
    // Les axes en trait mixte : présents sur toutes les planches d'ensemble.
    expect(sheetToSvg(SHEETS.find((s) => s.kind === 'ensemble') as Sheet)).toContain(
      'stroke-dasharray="12 2 2 2"',
    );
    expect(svg).toContain('stroke-dasharray="12 2 2 2"');
  });

  it('échappe le texte et n’émet pas de balise ouverte', () => {
    const s = new DrawScene();
    s.texte(pt(0, 0), 'a < b & "c"');
    const out = sheetToSvg({ id: 't', kind: 'debit', titre: 't', format: 'A4', echelle: 1, scene: s });
    expect(out).toContain('a &lt; b &amp; &quot;c&quot;');
    expect(out.match(/</g)?.length).toBe(out.match(/>/g)?.length);
  });

  it('rend chaque planche du dossier sans exception', () => {
    for (const s of SHEETS) {
      const out = sheetToSvg(s);
      expect(out.startsWith('<svg'), s.titre).toBe(true);
      expect(out.endsWith('</svg>'), s.titre).toBe(true);
      expect(out.includes('NaN'), `${s.titre} contient un NaN`).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */

function textesDe(s: DrawScene): string[] {
  return s.entities
    .filter((e): e is Extract<DrawEntity, { kind: 'texte' }> => e.kind === 'texte')
    .map((e) => e.texte);
}
