import { describe, expect, it } from 'vitest';
import { buildProject } from '../../core/build/buildProject';
import { getProfile } from '../../core/catalog/index';
import { piecesDeDebit } from '../../core/drawing/sheets/element';
import { cutLengths, squareCut } from '../../core/geometry/member';
import { normalize, scale, add, sub } from '../../core/math/vec3';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import { elementToDstv, exportable, lotDstv } from '../dstv';

const P = DEFAULT_PROJECT;
const M = buildProject(P);
const ELS = piecesDeDebit(M);
const OPTS = { meta: P.meta };
const LOT = lotDstv(ELS, OPTS);

/** Lignes utiles d'un fichier, sans indentation. */
const lignes = (s: string): string[] => s.trimEnd().split('\n').map((l) => l.trim());

/**
 * Le bloc de lignes qui suit un mot-clé, jusqu'au mot-clé suivant.
 *
 * ⚠ Les mots-clés sont ÉNUMÉRÉS, et non reconnus par leur forme. Un code de
 * forme de l'en-tête peut se lire comme un mot-clé — « RO » pour un tube rond —
 * et couperait l'en-tête en deux au huitième champ.
 */
const MOTS = new Set(['ST', 'BO', 'AK', 'EN']);

function bloc(contenu: string, mot: string): string[] {
  const l = lignes(contenu);
  const i = l.indexOf(mot);
  if (i < 0) return [];
  const out: string[] = [];
  for (let k = i + 1; k < l.length; k += 1) {
    if (MOTS.has(l[k] as string)) break;
    out.push(l[k] as string);
  }
  return out;
}

/* ================================================================== */
/* Structure du fichier                                                */
/* ================================================================== */

describe('structure NC1', () => {
  it('ouvre par ST et ferme par EN', () => {
    for (const f of LOT.fichiers) {
      const l = lignes(f.contenu);
      expect(l[0]).toBe('ST');
      expect(l[l.length - 1]).toBe('EN');
    }
  });

  it('donne à l’en-tête ST ses 24 champs, ni un de plus ni un de moins', () => {
    /*
     * ⚠ L'en-tête est POSITIONNEL : aucun champ n'est nommé, c'est le rang qui
     * fait le sens. Une ligne insérée ou omise décale tout ce qui suit, et la
     * machine lirait l'épaisseur d'âme comme une hauteur de profil. Ce test est
     * le seul garde-fou contre une modification de l'en-tête faite de bonne foi.
     */
    for (const f of LOT.fichiers) expect(bloc(f.contenu, 'ST')).toHaveLength(24);
  });

  it('porte le repère, la nuance, la quantité et le profil du modèle', () => {
    for (const e of ELS) {
      const f = LOT.fichiers.find((x) => x.nom === `${e.membre.mark}.nc1`);
      if (!f) continue;
      const h = bloc(f.contenu, 'ST');
      expect(h[3]).toBe(e.membre.mark);
      expect(h[4]).toBe(e.membre.grade);
      expect(h[5]).toBe(String(e.quantite));
      expect(h[6]).toBe(getProfile(e.membre.profileId).id);
    }
  });

  it('annonce la longueur de débit, pas la longueur d’épure', () => {
    for (const e of ELS) {
      const f = LOT.fichiers.find((x) => x.nom === `${e.membre.mark}.nc1`);
      if (!f) continue;
      const h = bloc(f.contenu, 'ST');
      expect(Number(h[8])).toBeCloseTo(cutLengths(e.membre).axis, 2);
    }
  });

  it('exprime la surface à peindre en m² par mètre', () => {
    /*
     * ⚠ Le catalogue porte un périmètre en MILLIMÈTRES. Le livrer tel quel
     * annonçait 1467 m² de peinture au mètre linéaire pour un IPE 400 — mille
     * fois trop.
     *
     * Les bornes encadrent le CATALOGUE, pas une section courante : un rond Ø16
     * développe 0,05 m²/m et le plus gros profil 1,47. Les serrer davantage
     * ferait échouer le test sur une petite cornière parfaitement décrite, sans
     * rien attraper de plus — l'erreur visée est d'un facteur mille.
     */
    for (const f of LOT.fichiers) {
      const v = Number(bloc(f.contenu, 'ST')[15]);
      expect(v).toBeGreaterThan(0.03);
      expect(v).toBeLessThan(5);
    }
  });
});

/* ================================================================== */
/* Perçages                                                            */
/* ================================================================== */

describe('perçages', () => {
  it('émet une ligne BO par trou du modèle', () => {
    for (const e of ELS) {
      const f = LOT.fichiers.find((x) => x.nom === `${e.membre.mark}.nc1`);
      if (!f) continue;
      expect(bloc(f.contenu, 'BO')).toHaveLength(e.membre.holes.length);
    }
  });

  it('place chaque trou DANS la pièce, jamais au-delà de ses abouts', () => {
    /*
     * ⚠ C'est le contrôle qui aurait attrapé les « trous à −14 mm de l'about »
     * découverts sur les plans d'atelier. Un trou d'abscisse négative sort de la
     * machine à côté de la barre ; celle-ci part malgré tout en peinture, et le
     * défaut se voit au montage.
     */
    for (const e of ELS) {
      const f = LOT.fichiers.find((x) => x.nom === `${e.membre.mark}.nc1`);
      if (!f) continue;
      const l = cutLengths(e.membre);
      for (const t of bloc(f.contenu, 'BO')) {
        const [, x] = t.split(/\s+/);
        expect(Number(x)).toBeGreaterThanOrEqual(0);
        expect(Number(x)).toBeLessThanOrEqual(l.max);
      }
    }
  });

  it('place chaque trou dans la section, jamais hors du profil', () => {
    for (const e of ELS) {
      const f = LOT.fichiers.find((x) => x.nom === `${e.membre.mark}.nc1`);
      if (!f) continue;
      const p = getProfile(e.membre.profileId);
      for (const t of bloc(f.contenu, 'BO')) {
        const [face, , y] = t.split(/\s+/);
        const limite = face === 'v' ? p.h : p.b;
        expect(Number(y)).toBeGreaterThanOrEqual(0);
        expect(Number(y)).toBeLessThanOrEqual(limite);
      }
    }
  });

  it('mesure les abscisses depuis la FACE DE COUPE, pas depuis le point de travail', () => {
    /*
     * ⚠ Le piège le plus coûteux du format. Sur une barre éboutée, le point de
     * travail et la face de coupe diffèrent de plusieurs centimètres : percer
     * depuis le mauvais repère sort une barre inutilisable, dont les trous ne
     * tombent en face de rien.
     *
     * Le projet par défaut n'ébute pas : l'écart y est nul, donc invisible. On
     * fabrique ici l'ébout que le modèle n'a pas, en reculant l'about d'origine
     * de 100 mm — et l'abscisse doit reculer d'autant.
     */
    const e = ELS.find((x) => x.membre.holes.length > 0);
    expect(e).toBeDefined();
    const m = e!.membre;
    const avant = Number(bloc(elementToDstv(e!, OPTS) as string, 'BO')[0]?.split(/\s+/)[1]);

    const dir = normalize(sub(m.end, m.start));
    const recule = { ...e!, membre: { ...m, cutStart: squareCut(add(m.start, scale(dir, 100)), dir, -1) } };
    const apres = Number(bloc(elementToDstv(recule, OPTS) as string, 'BO')[0]?.split(/\s+/)[1]);

    expect(avant - apres).toBeCloseTo(100, 1);
  });
});

/* ================================================================== */
/* Contours de grugeage                                                */
/* ================================================================== */

describe('grugeages', () => {
  it('referme le contour AK sur son point de départ', () => {
    /*
     * Un contour ouvert n'est pas une silhouette : la machine ne saurait pas
     * quelle matière enlever. Le format exige le retour au point initial.
     */
    for (const f of LOT.fichiers) {
      const ak = bloc(f.contenu, 'AK');
      if (ak.length === 0) continue;
      const pt = (s: string): string => s.split(/\s+/).slice(1, 3).join(' ');
      expect(pt(ak[0] as string)).toBe(pt(ak[ak.length - 1] as string));
    }
  });
});

/* ================================================================== */
/* Ce que le format ne sait pas décrire                                */
/* ================================================================== */

describe('pièces écartées', () => {
  it('nomme tout repère écarté au lieu de le taire', () => {
    /*
     * ⚠ Un repère absent du lot sans explication est un repère que l'atelier
     * croit programmé et qui n'arrivera jamais à la machine. Le total doit
     * couvrir tous les éléments : fichiers plus écartés.
     */
    expect(LOT.fichiers.length + LOT.ecartes.length).toBe(ELS.length);
    for (const x of LOT.ecartes) expect(x.raison).toMatch(/\S/);
  });

  it('refuse les formes qu’il traduirait de travers plutôt que d’approximer', () => {
    expect(exportable('IPE 300')).toBe(true);
    expect(exportable('L 60x60x6')).toBe(true);
    // Les ronds pleins n'ont ni âme ni semelle : les déclarer « I » percerait
    // dans une matière qui n'existe pas.
    const rond = ELS.find((e) => getProfile(e.membre.profileId).shape === 'ROND');
    if (rond) expect(elementToDstv(rond, OPTS)).toBeNull();
  });
});

describe('cornières — ordonnées depuis le bord de la face', () => {
  it('cote les trous d’échantignolle depuis le dos de l’aile, pas depuis le centre de gravité', () => {
    /*
     * ⚠ Recalcul indépendant : sur une cornière, l'ordonnée DSTV d'un trou de
     * l'aile couchée est sa cote dans la section PLUS la distance du dos au
     * centre de gravité (cy). L'export ajoutait la demi-largeur b/2, et le trou
     * d'une échantignolle L 100 sortait à 102 mm du dos — hors de l'aile.
     */
    const at = ELS.find((e) => e.membre.role === 'attache');
    expect(at).toBeDefined();
    const profil = getProfile(at!.membre.profileId) as { cy: number; a2: number };
    const contenu = elementToDstv(at!, OPTS) as string;
    const ys = bloc(contenu, 'BO').map((l) => Number(l.split(/\s+/)[2]));
    const attendus = at!.membre.holes.map((h) => h.at.y + profil.cy);
    expect(ys.sort((a, b) => a - b)).toEqual(attendus.map((y) => Number(y.toFixed(2))).sort((a, b) => a - b));
    for (const y of ys) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(profil.a2);
    }
  });
});
