import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import { buildingLength, ridgeHeight, ridgeY } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import type { DrawEntity } from '../scene';
import type { Sheet } from '../sheet';
import { sheetFacade, type Face } from '../sheets/facades';

/**
 * LES QUATRE FAÇADES.
 *
 * ⚠ Sur un bâtiment SYMÉTRIQUE, une erreur de sens de regard ne se voit pas :
 * les deux pignons sont identiques, et un dessin en miroir ressemble au bon. Les
 * contrôles se font donc sur un bâtiment DISSYMÉTRIQUE, où le faîtage est
 * décalé — c'est le seul cas qui distingue une façade correcte d'une façade
 * retournée.
 */

const P = DEFAULT_PROJECT;
const planche = (p: ProjectParams, face: Face): Sheet =>
  sheetFacade(buildProject(p), p, face, { page: 1, total: 60, meta: p.meta });

const textes = (s: Sheet): string[] =>
  s.scene.entities.flatMap((e: DrawEntity) => (e.kind === 'texte' ? [e.texte] : []));

/**
 * Points appartenant à l'OUVRAGE, cadre et cartouche exclus.
 *
 * ⚠ Le cadre de la feuille est une polyligne comme une autre, et ses coins sont
 * les points les plus hauts de la planche. Une première version de ce contrôle
 * les prenait pour le faîtage : les deux pignons ressortaient au même endroit et
 * le test accusait le dessin d'une erreur qu'il n'avait pas.
 */
function pointsOuvrage(s: Sheet): { x: number; y: number }[] {
  const dessin = new Set(['contour', 'contour-fin', 'cachee']);
  return s.scene.entities.flatMap((e) => {
    if (!('layer' in e) || !dessin.has(e.layer)) return [];
    return e.kind === 'polyligne' ? [...e.points] : e.kind === 'ligne' ? [e.a, e.b] : [];
  });
}

/** Abscisse papier du point le plus haut de l'ouvrage : le faîtage. */
function xDuFaitage(s: Sheet): number {
  let meilleur = { x: 0, y: -Infinity };
  for (const q of pointsOuvrage(s)) if (q.y > meilleur.y) meilleur = q;
  return meilleur.x;
}

describe('les quatre faces existent', () => {
  it('édite une planche par face, chacune identifiée', () => {
    const ids = (['avant', 'arriere', 'ouest', 'est'] as Face[]).map((f) => planche(P, f).id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual(['facade-avant', 'facade-arriere', 'facade-ouest', 'facade-est']);
  });

  it('cote la trame sur les longs pans et la portée sur les pignons', () => {
    /*
     * Ce ne sont pas les mêmes cotes parce que ce ne sont pas les mêmes
     * questions : le bardeur d'un long pan cale son calepinage sur les travées,
     * celui d'un pignon sur la portée.
     */
    for (const face of ['avant', 'arriere'] as Face[]) {
      const t = textes(planche(P, face));
      expect(t, face).toContain(`${buildingLength(P.grid)}`);
      expect(t, face).toContain(`${P.grid.baySpacing}`);
    }
    for (const face of ['ouest', 'est'] as Face[]) {
      expect(textes(planche(P, face)), face).toContain(`${P.grid.span}`);
    }
  });

  it('porte les niveaux sol, égout et faîtage', () => {
    for (const face of ['avant', 'arriere', 'ouest', 'est'] as Face[]) {
      const t = textes(planche(P, face)).join(' ');
      expect(t, face).toContain('+0.000');
      expect(t, face).toContain('+6.000');
      expect(t, face).toContain('+7.000');
    }
  });

  it('NE HACHURE PAS : une façade n’est pas une coupe', () => {
    /*
     * ⚠ La hachure signifie « matière tranchée par le plan de coupe ». Sur une
     * façade, rien n'est tranché : on regarde le bâtiment de l'extérieur. En
     * mettre ferait passer la planche pour une coupe et tromperait le lecteur
     * sur ce qu'il voit.
     */
    for (const face of ['avant', 'arriere', 'ouest', 'est'] as Face[]) {
      const hachures = planche(P, face).scene.entities.filter((e) => e.kind === 'hachure');
      expect(hachures, face).toHaveLength(0);
    }
  });
});

describe('sens du regard', () => {
  /*
   * Toiture dissymétrique : versant gauche à 5 %, versant droit à 25 %. Le
   * faîtage se déplace vers la gauche, et c'est ce décalage qui rend les deux
   * pignons distinguables.
   */
  const dissymetrique: ProjectParams = {
    ...P,
    grid: { ...P.grid, asymmetric: true, slope: 5, slopeRight: 25 },
  };

  it('regarde chaque pignon DE L’EXTÉRIEUR, donc en miroir l’un de l’autre', () => {
    /*
     * ⚠ Le contrôle qui compte. Dessiner les deux pignons avec la même direction
     * de regard en donnerait un en miroir : les files se liraient de droite à
     * gauche et le bardeur poserait son calepinage à l'envers. Sur un bâtiment
     * symétrique, l'erreur est INVISIBLE — d'où la toiture dissymétrique.
     */
    const ouest = planche(dissymetrique, 'ouest');
    const est = planche(dissymetrique, 'est');

    const centre = (s: Sheet): number => {
      const xs = pointsOuvrage(s).map((q) => q.x);
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    };

    const decalageOuest = xDuFaitage(ouest) - centre(ouest);
    const decalageEst = xDuFaitage(est) - centre(est);

    // Le faîtage est décalé du même côté du bâtiment, donc de côtés OPPOSÉS sur
    // les deux façades vues chacune de son extérieur.
    expect(Math.abs(decalageOuest), 'faîtage centré : la toiture n’est pas dissymétrique').toBeGreaterThan(5);
    expect(
      Math.sign(decalageOuest),
      `ouest ${decalageOuest.toFixed(1)} · est ${decalageEst.toFixed(1)}`,
    ).toBe(-Math.sign(decalageEst));
  });

  it('place le faîtage du côté du versant court', () => {
    // Vérification de premier principe : avec un versant droit plus raide, le
    // faîtage est plus proche du long pan droit.
    expect(ridgeY(dissymetrique.grid)).toBeGreaterThan(dissymetrique.grid.span / 2);
    expect(ridgeHeight(dissymetrique.grid)).toBeGreaterThan(dissymetrique.grid.eaveHeight);
  });
});

describe('robustesse', () => {
  it('tient dans le cadre sur tous les gabarits, les quatre faces', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      for (const face of ['avant', 'arriere', 'ouest', 'est'] as Face[]) {
        const s = planche(p, face);
        expect(JSON.stringify(s.scene.entities), `${t.id} / ${face}`).not.toMatch(
          /null|NaN|Infinity/,
        );
        for (const e of s.scene.entities) {
          const pts =
            e.kind === 'ligne'
              ? [e.a, e.b]
              : e.kind === 'polyligne'
                ? e.points
                : e.kind === 'cercle' || e.kind === 'arc'
                  ? [e.c]
                  : e.kind === 'texte'
                    ? [e.at]
                    : [];
          for (const q of pts) {
            expect(q.x, `${t.id} / ${face} : x = ${q.x.toFixed(1)}`).toBeGreaterThan(-40);
            expect(q.x).toBeLessThan(460);
            expect(q.y, `${t.id} / ${face} : y = ${q.y.toFixed(1)}`).toBeGreaterThan(-40);
            expect(q.y).toBeLessThan(340);
          }
        }
      }
    }
  });
});

/* ================================================================== */
/* Ouvertures                                                          */
/* ================================================================== */

describe('ouvertures sur la façade', () => {
  const AVEC: ProjectParams = {
    ...P,
    ouvertures: {
      enabled: true,
      profile: 'UPE 160',
      grade: 'S235',
      items: [
        {
          id: 'P1',
          face: 'long-pan-gauche',
          type: 'portail',
          position: 7000,
          largeur: 4000,
          hauteur: 4500,
          allege: 0,
        },
        {
          id: 'F9',
          face: 'pignon-ouest',
          type: 'chassis',
          position: 6000,
          largeur: 3000,
          hauteur: 1500,
          allege: 2500,
        },
      ],
    },
  };

  it('trace l’ouverture avec sa désignation et ses dimensions', () => {
    /*
     * ⚠ Les DIMENSIONS figurent sur la façade, pas seulement le repère.
     * Renvoyer à une nomenclature pour connaître la largeur d'un portail oblige
     * à changer de feuille au moment précis où l'on mesure — et c'est là que
     * naissent les ouvertures percées à la mauvaise cote.
     */
    const t = textes(planche(AVEC, 'avant'));
    expect(t).toContain('P1');
    expect(t).toContain('Portail 4000 × 4500');
  });

  it('ne montre une ouverture QUE sur sa propre façade', () => {
    // Un portail de long pan dessiné sur le pignon situerait le percement à
    // l'autre bout du bâtiment.
    expect(textes(planche(AVEC, 'avant'))).toContain('P1');
    expect(textes(planche(AVEC, 'arriere'))).not.toContain('P1');
    expect(textes(planche(AVEC, 'ouest'))).toContain('F9');
    expect(textes(planche(AVEC, 'est'))).not.toContain('F9');
  });

  it('pose le rectangle DANS le chevêtre qui le borde', () => {
    /*
     * ⚠ Le rectangle et les montants viennent de la même fonction de plan de
     * façade. Les recalculer séparément — demi-poteau plus demi-lisse, c'est
     * vite réécrit — donnerait deux plans qu'un changement de profil suffirait à
     * désaccorder : le rectangle glisserait devant son chevêtre, et le dessin
     * resterait plausible tout en étant faux.
     */
    const s = planche(AVEC, 'avant');
    const rect = s.scene.entities.find(
      (e): e is Extract<DrawEntity, { kind: 'polyligne' }> =>
        e.kind === 'polyligne' && e.points.length === 4 && e.layer === 'contour',
    );
    expect(rect).toBeDefined();
    const xs = rect!.points.map((q) => q.x);
    const montants = pointsOuvrage(s).map((q) => q.x);
    // Les deux jambages du rectangle retrouvent des points d'ossature à 1 mm près.
    for (const x of [Math.min(...xs), Math.max(...xs)]) {
      expect(montants.some((m) => Math.abs(m - x) < 1), `jambage à x=${x}`).toBe(true);
    }
  });

  it('n’ajoute rien quand aucune ouverture n’est posée', () => {
    const t = textes(planche(P, 'avant'));
    expect(t.some((x) => /Portail|Châssis|Porte \d/.test(x))).toBe(false);
  });
});
