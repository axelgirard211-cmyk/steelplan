import { describe, expect, it } from 'vitest';
import { plateMassKg, buildProject } from '../../build/buildProject';
import { groupByMark } from '../../build/marks';
import { getProfile } from '../../catalog/index';
import { buildSheets } from '../../drawing/buildSheets';
import { cutLengths, memberMassKg, type Member } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import {
  boltLength,
  boltMass,
  boulonnerieToCsv,
  buildBom,
  debitToCsv,
  totauxToCsv,
} from '../index';

const P = DEFAULT_PROJECT;
const M = buildProject(P);
const BOM = buildBom(P, M);

/* ================================================================== */
/* Liste de débit                                                      */
/* ================================================================== */

describe('liste de débit', () => {
  it('donne une ligne par repère, et pas une par pièce', () => {
    expect(BOM.debit).toHaveLength(groupByMark(M.members).size + new Set(M.haunches.map((h) => h.mark)).size);
    const total = BOM.debit.reduce((s, l) => s + l.quantity, 0);
    expect(total).toBe(M.members.length + M.haunches.length);
  });

  it('relit les longueurs du modèle sans les recalculer', () => {
    for (const l of BOM.debit) {
      if (l.designation === 'Jarret') continue;
      const piece = groupByMark(M.members).get(l.mark)?.[0] as Member;
      const attendu = cutLengths(piece);
      expect(l.length, l.mark).toBeCloseTo(attendu.axis, 9);
      expect(l.lengthMax, l.mark).toBeCloseTo(attendu.max, 9);
    }
  });

  it('boucle les masses : la somme des lignes fait la masse des barres', () => {
    /*
     * ⚠ On compare à `memberMassKg`, la fonction du MODÈLE, et non à la formule
     * G × longueur réécrite ici. Cette réécriture omettait la déduction des
     * grugeages : le test confirmait donc une nomenclature plus lourde que
     * l'ouvrage, et deux « masses à livrer » cohabitaient dans l'écran sans que
     * rien ne le signale. Un test qui refait le calcul qu'il vérifie ne vérifie
     * que lui-même.
     */
    const barres = BOM.debit.filter((l) => l.designation !== 'Jarret');
    const attendu = M.members.reduce((s, m) => s + memberMassKg(m), 0);
    expect(barres.reduce((s, l) => s + l.massTotal, 0)).toBeCloseTo(attendu, 6);
  });

  it('reporte perçages et grugeages, qui décident du temps d’atelier', () => {
    const poteau = BOM.debit.find((l) => l.mark === 'PO1');
    // 12 trous de platine de genou sur la semelle intérieure, 4 de console et
    // 16 de lisses — 4 niveaux × 2 lisses × 2 boulons — sur l'extérieure.
    expect(poteau?.holes).toBe(32);
    // Aucun grugeage sur ce hangar : les potelets, âme perpendiculaire au
    // pignon, se coupent simplement suivant le rampant.
    expect(BOM.debit.every((l) => l.notches === 0)).toBe(true);
  });

  it('quantifie chaque repère conformément au modèle', () => {
    for (const l of BOM.debit) {
      if (l.designation === 'Jarret') continue;
      expect(l.quantity, l.mark).toBe(groupByMark(M.members).get(l.mark)?.length);
    }
  });
});

/* ================================================================== */
/* Tôles                                                               */
/* ================================================================== */

describe('liste des tôles', () => {
  it('donne une ligne par repère de tôle', () => {
    expect(BOM.toles).toHaveLength(new Set(M.plates.map((pl) => pl.mark)).size);
    expect(BOM.toles.reduce((s, l) => s + l.quantity, 0)).toBe(M.plates.length);
  });

  it('reprend les dimensions et le perçage réels', () => {
    const pied = BOM.toles.find((l) => l.designation.includes('pied'));
    expect(pied?.width).toBeCloseTo(P.connections.columnBase.width, 6);
    expect(pied?.height).toBeCloseTo(P.connections.columnBase.length, 6);
    expect(pied?.thickness).toBe(P.connections.columnBase.thickness);
    expect(pied?.holes).toBe(P.connections.columnBase.anchorCount);
  });

  it('boucle les masses avec celles du modèle', () => {
    const attendu = M.plates.reduce((s, pl) => s + plateMassKg(pl), 0);
    expect(BOM.toles.reduce((s, l) => s + l.massTotal, 0)).toBeCloseTo(attendu, 6);
  });
});

/* ================================================================== */
/* Boulonnerie                                                         */
/* ================================================================== */

describe('liste de boulonnerie', () => {
  it('choisit la longueur commerciale immédiatement suffisante', () => {
    // Serrage 33,5 mm + 1,5 × 20 = 63,5 ⇒ le M20 se commande en 65.
    expect(boltLength(33.5, 20)).toBe(65);
    expect(boltLength(15.4, 12)).toBe(35);
    // Jamais en dessous du serrage augmenté de l'écrou.
    for (const grip of [10, 25, 40, 60, 95]) {
      for (const d of [12, 16, 20, 24]) {
        expect(boltLength(grip, d), `serrage ${grip}, M${d}`).toBeGreaterThanOrEqual(
          grip + 1.5 * d,
        );
      }
    }
  });

  it('estime la masse d’un boulon à quelques pour cent près', () => {
    // Un M20×60 8.8 avec écrou et rondelles pèse environ 0,25 kg.
    expect(boltMass(60, 20)).toBeCloseTo(0.24, 2);
    // Un M12×35 pèse quelques dizaines de grammes.
    expect(boltMass(35, 12)).toBeGreaterThan(0.03);
    expect(boltMass(35, 12)).toBeLessThan(0.08);
  });

  it('déduit le serrage des pièces réellement traversées', () => {
    const genou = BOM.bolts.find((l) => l.usage.includes('platines d’about'));
    if (!genou) throw new Error('boulons de genou absents');
    // Semelle d'IPE 400 (13,5 mm) + platine de 20 mm.
    const profilPoteau = getProfile(P.frame.columnProfile);
    if (profilPoteau.shape !== 'I') throw new Error('profil en I attendu');
    const attendu = profilPoteau.tf + P.connections.rafterToColumn.thickness;
    expect(genou.grip).toBeCloseTo(attendu, 6);
    expect(genou.diameter).toBe(P.connections.rafterToColumn.bolt.d);
    expect(genou.cls).toBe(P.connections.rafterToColumn.bolt.cls);
  });

  it('compte la même boulonnerie que le modèle', () => {
    expect(BOM.totals.boltCount).toBe(M.stats.boltCount);
  });

  it('distingue les tiges d’ancrage des boulons de charpente', () => {
    const ancrages = BOM.bolts.filter((l) => l.piece === 'ancrage');
    expect(ancrages.every((l) => l.designation.includes('ancrage'))).toBe(true);
    const cb = P.connections.columnBase;
    // Même diamètre partout ; la longueur suit l'épaisseur de platine traversée :
    // 12 poteaux × 4 tiges sous 25 mm, 6 potelets × 2 tiges sous 15 mm.
    expect(new Set(ancrages.map((l) => l.diameter))).toEqual(new Set([cb.anchorDiameter]));
    expect(ancrages.map((l) => [l.grip, l.count]).sort()).toEqual([
      [15 + cb.groutThickness, 12],
      [cb.thickness + cb.groutThickness, 48],
    ]);
    // La tige traverse la platine, le mortier de calage, et se scelle.
    for (const l of ancrages) expect(l.length).toBeGreaterThan(cb.anchorEmbedment);
  });

  it('ne compte les boulons barre à barre qu’une seule fois', () => {
    const attaches = BOM.bolts.filter((l) => l.usage.includes('pannes'));
    // 75 pannes × 4 boulons, vus depuis la panne seulement.
    expect(attaches.reduce((s, l) => s + l.count, 0)).toBe(300);
  });

  it('regroupe par désignation exacte, longueur comprise, et par usage', () => {
    // Un même M12×40 sert aux pannes et aux lisses : deux lignes, une par
    // zone de montage — le monteur ne les pose pas le même jour.
    const cles = BOM.bolts.map((l) => `${l.designation}|${l.usage}`);
    expect(new Set(cles).size).toBe(cles.length);
    for (const l of BOM.bolts) expect(l.designation).toMatch(l.piece === 'ecrou' ? /^Écrou HM\d+/ : /M\d+×\d+/);
  });

  it('livre les écrous des liernes : deux par about, hors boulons posés', () => {
    const liernes = M.members.filter((m) => m.role === 'lierne').length;
    expect(liernes).toBeGreaterThan(0);
    const ecrous = BOM.bolts.filter((l) => l.piece === 'ecrou');
    expect(ecrous.reduce((s, l) => s + l.count, 0)).toBe(4 * liernes);
    // HM16 + rondelle : 1,4 × 16³ mm³ d'acier = 0,045 kg.
    expect(ecrous[0]?.massUnit).toBeCloseTo(0.045, 3);
    const boulons = BOM.bolts.filter((l) => l.piece !== 'ecrou').reduce((s, l) => s + l.count, 0);
    expect(BOM.totals.boltCount).toBe(boulons);
  });
});

/* ================================================================== */
/* Synthèse                                                            */
/* ================================================================== */

describe('synthèse du projet', () => {
  it('additionne sans rien perdre ni compter deux fois', () => {
    const t = BOM.totals;
    expect(t.massSteel).toBeCloseTo(t.massMembers + t.massPlates, 6);
    expect(t.massTotal).toBeCloseTo(t.massSteel + t.massBolts, 6);
    const parNuance = Object.values(t.massByGrade).reduce((s, m) => s + (m ?? 0), 0);
    expect(parNuance).toBeCloseTo(t.massSteel, 6);
  });

  it('donne un ratio de charpente plausible pour un hangar', () => {
    expect(BOM.totals.kgPerM2).toBeGreaterThan(20);
    expect(BOM.totals.kgPerM2).toBeLessThan(70);
    expect(BOM.totals.footprintM2).toBeCloseTo(600, 1);
  });

  it('chiffre la boulonnerie sans qu’elle pèse plus que la charpente', () => {
    expect(BOM.totals.massBolts).toBeGreaterThan(0);
    expect(BOM.totals.massBolts).toBeLessThan(BOM.totals.massSteel * 0.1);
  });

  it('reprend la surface à peindre du modèle, tôles comprises', () => {
    const toles = BOM.toles.reduce((s, l) => s + l.paintM2, 0);
    expect(toles).toBeGreaterThan(0);
    expect(BOM.totals.paintM2).toBeCloseTo(M.stats.paintM2, 6);
  });

  it('liste les soudures par désignation', () => {
    expect(BOM.welds.length).toBeGreaterThan(0);
    expect(BOM.welds.reduce((s, l) => s + l.count, 0)).toBe(M.welds.length);
    expect(BOM.totals.weldMetres).toBeCloseTo(M.stats.weldMetres, 6);
  });
});

/* ================================================================== */
/* Export CSV                                                          */
/* ================================================================== */

describe('export CSV', () => {
  const csv = debitToCsv(BOM.debit);

  it('utilise les conventions françaises : point-virgule et virgule décimale', () => {
    const lignes = csv.split('\r\n');
    const entete = lignes[0] ?? '';
    expect(entete).toContain(';');
    expect(entete).not.toContain(',');
    // Une masse comme 397,8 doit s'écrire avec une virgule.
    expect(csv).toMatch(/;\d+,\d+;/);
  });

  it('préfixe le marqueur d’ordre des octets, sans quoi les accents se perdent', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Repère');
    expect(csv).toContain('Désignation');
  });

  it('écrit autant de lignes que la nomenclature en compte', () => {
    const lignes = csv.trimEnd().split('\r\n');
    expect(lignes).toHaveLength(BOM.debit.length + 1); // + l'en-tête
  });

  it('échappe une cellule contenant un point-virgule', () => {
    const bricole = totauxToCsv({ ...BOM.totals, kgPerM2: 0 });
    expect(bricole).not.toContain(';;;');
    const avecSep = debitToCsv([
      { ...(BOM.debit[0] as (typeof BOM.debit)[number]), designation: 'Poteau; renforcé' },
    ]);
    expect(avecSep).toContain('"Poteau; renforcé"');
  });

  it('exporte la boulonnerie avec sa longueur et son serrage', () => {
    const b = boulonnerieToCsv(BOM.bolts);
    expect(b).toContain('Longueur (mm)');
    expect(b).toContain('Serrage (mm)');
    expect(b.trimEnd().split('\r\n')).toHaveLength(BOM.bolts.length + 1);
  });

  it('n’écrit aucun NaN ni undefined', () => {
    for (const contenu of [csv, boulonnerieToCsv(BOM.bolts), totauxToCsv(BOM.totals)]) {
      expect(contenu).not.toContain('NaN');
      expect(contenu).not.toContain('undefined');
    }
  });
});

/* ================================================================== */
/* Intégration au dossier de plans                                     */
/* ================================================================== */

describe('nomenclatures dans le dossier de plans', () => {
  const sheets = buildSheets(M, P, BOM);
  const nomenclatures = sheets.filter((s) => s.kind === 'nomenclature');

  it('ajoute les planches de nomenclature en fin de dossier', () => {
    expect(nomenclatures.length).toBeGreaterThanOrEqual(4);
    expect(sheets.slice(-nomenclatures.length).every((s) => s.kind === 'nomenclature')).toBe(true);
    expect(nomenclatures.map((s) => s.id)).toContain('nomenclature-synthese');
  });

  it('numérote correctement les pages, nomenclatures comprises', () => {
    const pages = sheets.flatMap((s) =>
      s.scene.entities
        .filter((e) => e.kind === 'texte')
        .map((e) => (e as { texte: string }).texte)
        .filter((t) => /^\d+\/\d+$/.test(t)),
    );
    expect(pages).toHaveLength(sheets.length);
    expect(pages[pages.length - 1]).toBe(`${sheets.length}/${sheets.length}`);
    // Aucune page n'annonce un total différent des autres.
    expect(new Set(pages.map((p) => p.split('/')[1])).size).toBe(1);
  });

  it('pagine les longs tableaux plutôt que de les écraser', () => {
    const grand: ProjectParams = { ...P, grid: { ...P.grid, nBays: 12 } };
    const mGrand = buildProject(grand);
    const bomGrand = buildBom(grand, mGrand);
    const s = buildSheets(mGrand, grand, bomGrand).filter((x) => x.kind === 'nomenclature');
    // Chaque planche reste raisonnablement remplie.
    for (const planche of s) {
      expect(planche.scene.length, planche.titre).toBeLessThan(1200);
    }
  });

  it('porte l’en-tête du tableau et les valeurs sur chaque planche', () => {
    const debit = nomenclatures.find((s) => s.id.startsWith('nomenclature-debit'));
    const textes = debit?.scene.entities
      .filter((e) => e.kind === 'texte')
      .map((e) => (e as { texte: string }).texte);
    expect(textes).toContain('Rep.');
    expect(textes).toContain('Profil');
    expect(textes).toContain('PO1');
    expect(textes).toContain('IPE 400');
  });

  it('affiche la synthèse avec le tonnage et le ratio', () => {
    const synthese = nomenclatures.find((s) => s.id === 'nomenclature-synthese');
    const textes = (synthese?.scene.entities ?? [])
      .filter((e) => e.kind === 'texte')
      .map((e) => (e as { texte: string }).texte);
    expect(textes).toContain('MASSES');
    expect(textes).toContain('TOTAL À LIVRER');
    expect(textes.some((t) => t.endsWith('kg/m²'))).toBe(true);
  });

  it('reste compatible avec un dossier sans nomenclature', () => {
    expect(buildSheets(M, P).some((s) => s.kind === 'nomenclature')).toBe(false);
  });
});
