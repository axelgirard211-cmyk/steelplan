import { describe, expect, it } from 'vitest';
import { dessinerCadre, FORMATS } from '../../core/drawing/layout';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import { DrawScene, pt } from '../../core/drawing/scene';
import type { Sheet } from '../../core/drawing/sheet';
import { sheetToPdf } from '../pdf';

/**
 * Relecture du FLUX DE CONTENU du PDF produit.
 *
 * Vérifier que le fichier « s'ouvre » ne prouve rien : un PDF peut être valide et
 * montrer le dessin à l'envers, décalé, ou à la mauvaise échelle. On relit donc
 * les opérateurs de tracé et on compare aux coordonnées attendues, converties en
 * points typographiques comme le veut le format.
 */
const PT = 72 / 25.4;
const planche = (scene: DrawScene, format: 'A4' | 'A3' = 'A4'): Sheet => ({
  id: 't',
  kind: 'debit',
  titre: 'Contrôle',
  format,
  echelle: 1,
  scene,
});

async function contenu(scene: DrawScene, format: 'A4' | 'A3' = 'A4'): Promise<string> {
  return sheetToPdf(planche(scene, format), { compresser: false }).text();
}

/** Extrait les nombres d'un opérateur, ex. « 85.04 481.89 m ». */
function operandes(flux: string, operateur: string): number[][] {
  const re = new RegExp(`([-\\d. ]+)${operateur}(?![a-zA-Z])`, 'g');
  const out: number[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(flux)) !== null) {
    const vals = (m[1] ?? '').trim().split(/\s+/).map(Number).filter((v) => !Number.isNaN(v));
    if (vals.length > 0) out.push(vals);
  }
  return out;
}

/** Position du point d'écriture d'un texte donné, dans le flux. */
function positionDuTexte(flux: string, texte: string): { x: number; y: number } | null {
  const i = flux.indexOf(`(${texte})`);
  if (i < 0) return null;
  // Le positionnement précède l'écriture : on remonte au dernier « Td ».
  const avant = flux.slice(Math.max(0, i - 400), i);
  const td = [...avant.matchAll(/([-\d.]+)\s+([-\d.]+)\s+Td/g)].pop();
  if (!td) return null;
  return { x: Number(td[1]), y: Number(td[2]) };
}

describe('flux de contenu du PDF', () => {
  /**
   * ⚠ DEUX conversions se succèdent, et il faut les tenir toutes les deux en
   * tête : notre dessin a son Y vers le HAUT, l'interface de jsPDF l'a vers le
   * BAS, et le PDF lui-même le remet vers le haut. On retourne donc l'axe une
   * fois pour jsPDF, qui le retourne une seconde fois pour le fichier — et un
   * point à 40 mm du bas du dessin se retrouve bien à 40 mm du bas de la page.
   */
  it('place une ligne aux coordonnées exactes du fichier', async () => {
    const s = new DrawScene();
    s.ligne(pt(30, 40), pt(80, 40));
    const flux = await contenu(s);

    const depart = operandes(flux, 'm').find((v) => Math.abs(v[0]! - 30 * PT) < 0.1);
    expect(depart, 'aucun déplacement au point de départ attendu').toBeDefined();
    expect(depart?.[1]).toBeCloseTo(40 * PT, 1);

    const arrivee = operandes(flux, 'l').find((v) => Math.abs(v[0]! - 80 * PT) < 0.1);
    expect(arrivee, 'aucun tracé jusqu’au point d’arrivée').toBeDefined();
    expect(arrivee?.[1]).toBeCloseTo(40 * PT, 1);
  });

  /**
   * Contrôle SÉMANTIQUE du sens de la page, qu'aucune convention de signe ne peut
   * tromper : le cartouche est en bas de la feuille, le haut du cadre en haut.
   * Si l'axe était retourné une fois de trop, le cartouche sortirait en haut de
   * la page et personne ne s'en apercevrait avant l'impression.
   */
  it('imprime la feuille à l’endroit : cartouche en bas, cadre en haut', async () => {
    const scene = new DrawScene();
    const fenetre = dessinerCadre(scene, 'A3', {
      meta: DEFAULT_PROJECT.meta,
      titre: 'Controle du sens',
      echelle: 50,
      page: 1,
      total: 1,
    });
    expect(fenetre.min.y).toBeGreaterThan(0);

    const flux = await contenu(scene, 'A3');
    const hauteurPage = FORMATS.A3.hauteur * PT;

    // Le titre de la planche et l'échelle appartiennent au cartouche : ils sont
    // écrits dans le tiers bas de la page. On cherche des chaînes sans accent,
    // que jsPDF n'échappe pas en octal.
    for (const attendu of ['Controle du sens', '1:50', 'PROJET']) {
      const pos = positionDuTexte(flux, attendu);
      expect(pos, `« ${attendu} » introuvable dans le flux`).not.toBeNull();
      expect(pos?.y, `« ${attendu} » n’est pas dans le cartouche`).toBeLessThan(hauteurPage / 3);
    }

    // Le cadre monte, lui, jusqu'à quelques millimètres du bord supérieur.
    const yMax = Math.max(...operandes(flux, 'l').map((v) => v[1] ?? 0));
    expect(yMax).toBeGreaterThan(hauteurPage * 0.9);
  });

  it('respecte les épaisseurs de trait normalisées', async () => {
    const s = new DrawScene();
    s.ligne(pt(0, 0), pt(10, 0), 'contour'); // 0,50 mm
    s.ligne(pt(0, 5), pt(10, 5), 'cotation'); // 0,18 mm
    const flux = await contenu(s);
    const largeurs = operandes(flux, 'w').map((v) => v[0] as number);
    expect(largeurs.some((v) => Math.abs(v - 0.5 * PT) < 0.02)).toBe(true);
    expect(largeurs.some((v) => Math.abs(v - 0.18 * PT) < 0.02)).toBe(true);
  });

  it('applique le tireté des calques qui en ont un', async () => {
    const s = new DrawScene();
    s.ligne(pt(0, 0), pt(10, 0), 'axe'); // 12-2-2-2
    const flux = await contenu(s);
    // jsPDF écrit ses nombres avec un point final : « 0. d » et non « 0 d ».
    expect(flux).toMatch(/\[[\d.\s]+\]\s*0\.?\s*d/);
  });

  it('écrit le texte et le positionne', async () => {
    const s = new DrawScene();
    s.texte(pt(50, 60), 'PO1', { hauteur: 2.5 });
    const flux = await contenu(s);
    expect(flux).toContain('(PO1)');
    // Taille de police : hauteur nominale × 1,35, exprimée en points.
    expect(flux).toMatch(/\/F\d+ [\d.]+ Tf/);
    const taille = /\/F\d+ ([\d.]+) Tf/.exec(flux);
    expect(Number(taille?.[1])).toBeCloseTo(2.5 * 1.35 * PT, 1);
  });

  it('remplit les flèches de cotation en noir', async () => {
    const s = new DrawScene();
    s.remplissage([pt(0, 0), pt(3, 1), pt(3, -1)], [], 0, 'cotation');
    const flux = await contenu(s);
    // Opérateur de remplissage présent, en niveau de gris nul.
    expect(flux).toMatch(/\bf\b/);
    expect(flux).toMatch(/0\.?\s+g/);
  });

  it('évide les trous d’un remplissage : un seul chemin, règle pair-impair', async () => {
    const s = new DrawScene();
    s.remplissage(
      [pt(0, 0), pt(40, 0), pt(40, 40), pt(0, 40)],
      [[pt(10, 10), pt(10, 30), pt(30, 30), pt(30, 10)]],
      0.5,
    );
    const flux = await contenu(s);
    // Deux sous-chemins (deux « m »), puis UN remplissage pair-impair.
    expect(operandes(flux, 'm')).toHaveLength(2);
    expect(flux.match(/\bf\*/g)).toHaveLength(1);
  });

  it('trace chaque hachure en traits, comme les autres formats', async () => {
    const s = new DrawScene();
    s.hachure([pt(0, 0), pt(20, 0), pt(20, 20), pt(0, 20)], [], 2, 0);
    const flux = await contenu(s);
    // 10 lignes de balayage attendues sur 20 mm au pas de 2 mm.
    expect(operandes(flux, 'm').length).toBeGreaterThanOrEqual(9);
  });

  /**
   * Un plan français est plein d'accents : « Détail », « Repère », « Ø », « × ».
   * Si l'encodage était mal déclaré, le tirage papier sortirait illisible sans
   * qu'aucun test structurel ne s'en aperçoive — le fichier resterait valide.
   */
  it('encode correctement les accents et les symboles techniques', async () => {
    const scene = new DrawScene();
    scene.texte(pt(10, 10), 'Détail — Repère n°1 : 12 × Ø22');
    const octets = new Uint8Array(
      await sheetToPdf(planche(scene), { compresser: false }).arrayBuffer(),
    );

    // La police standard d'un PDF se lit en Windows-1252 : chaque caractère
    // accentué occupe UN octet, à sa valeur cp1252.
    const attendus: [string, number][] = [
      ['é', 0xe9],
      ['è', 0xe8],
      ['—', 0x97],
      ['°', 0xb0],
      ['×', 0xd7],
      ['Ø', 0xd8],
    ];
    for (const [caractere, code] of attendus) {
      expect(octets.includes(code), `« ${caractere} » (0x${code.toString(16)}) absent du fichier`).toBe(
        true,
      );
    }

    // …et l'encodage doit être DÉCLARÉ, sinon le lecteur affichera autre chose.
    const entete = new TextDecoder('latin1').decode(octets);
    expect(entete).toContain('/WinAnsiEncoding');
    expect(entete).toContain('/Helvetica');
  });

  it('n’écrit aucune coordonnée non finie', async () => {
    const s = new DrawScene();
    s.arc(pt(50, 50), 10, 0, Math.PI / 2, 'cotation');
    s.cercle(pt(20, 20), 5);
    const flux = await contenu(s);
    expect(flux).not.toContain('NaN');
    expect(flux).not.toContain('Infinity');
  });
});
