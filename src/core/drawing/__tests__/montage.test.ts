import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { frameStations } from '../../model/grid';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import type { DrawEntity } from '../scene';
import type { Sheet } from '../sheet';
import { sheetsMontage } from '../sheets/montage';

/**
 * PLANS DE REPÉRAGE ET DE MONTAGE.
 *
 * ⚠ Ce que ces planches doivent au chantier, et que rien d'autre ne lui donne :
 * quelle pièce va à quelle file, et dans quel ordre lever. Deux exigences en
 * découlent, et elles sont contraires à celles d'un plan d'ensemble :
 *  - CHAQUE pièce porte son repère, pas un exemplaire par famille ;
 *  - AUCUN repère du modèle ne peut manquer au tableau de montage. Une pièce
 *    absente de la liste est une pièce qui reste sur le camion.
 */

const P = DEFAULT_PROJECT;
const MODEL = buildProject(P);
const META = P.meta;
const PLANCHES = sheetsMontage(MODEL, P, { page: 1, total: 60, meta: META });

const textes = (s: Sheet): string[] =>
  s.scene.entities.flatMap((e: DrawEntity) => (e.kind === 'texte' ? [e.texte] : []));

/**
 * Marques portées SUR LE DESSIN, à l'exclusion du tableau de montage.
 *
 * ⚠ Le tableau cite lui aussi tous les repères : les compter ensemble ferait
 * passer pour un repérage ce qui n'est qu'une ligne de nomenclature. Le calque
 * `reperage` les sépare exactement.
 */
const marquesDessinees = (s: Sheet): string[] =>
  s.scene.entities.flatMap((e: DrawEntity) =>
    e.kind === 'texte' && e.layer === 'reperage' ? [e.texte] : [],
  );

describe('repérage pièce par pièce', () => {
  it('édite une vue en plan ET une élévation', () => {
    expect(PLANCHES).toHaveLength(2);
    for (const s of PLANCHES) expect(s.kind).toBe('montage');
  });

  it('répète le repère sur CHAQUE file, et non une seule fois', () => {
    /*
     * ⚠ C'est toute la différence avec un plan d'ensemble. Celui-ci repère un
     * exemplaire pour identifier une famille ; le plan de montage repère chaque
     * pièce à sa position. Un seul « PO1 » sur la planche et le monteur ne sait
     * pas si les six files portent le même poteau.
     */
    const elevation = PLANCHES[1] as Sheet;
    // Un poteau par file, courant (PO1A) ou d'angle (PO1B…) : tous repérés.
    const marques = marquesDessinees(elevation).filter((t) => /^PO1[A-Z]?$/.test(t));
    expect(marques.length, `${marques.length} repère(s) PO1`).toBe(frameStations(P.grid).length);
  });

  it('numérote les files, seule façon de situer une pièce sur le chantier', () => {
    for (const s of PLANCHES) {
      const t = textes(s);
      for (let i = 1; i <= frameStations(P.grid).length; i++) {
        expect(t, `${s.titre} : file ${i}`).toContain(`${i}`);
      }
    }
  });
});

describe('ordre de montage', () => {
  const table = textes(PLANCHES[1] as Sheet).join('\n');

  it('lève les poteaux avant les traverses, et les contreventements avant les pannes', () => {
    /*
     * ⚠ Les contreventements AVANT l'ossature secondaire, et ce n'est pas de
     * l'ordonnancement : tant qu'une travée n'est pas contreventée, elle ne tient
     * que par la grue. Poser les pannes d'abord revient à charger une structure
     * qui n'est pas encore stable.
     */
    const rang = (t: string): number => table.indexOf(t);
    expect(rang('1 — Poteaux et potelets')).toBeGreaterThanOrEqual(0);
    expect(rang('1 — Poteaux et potelets')).toBeLessThan(rang('2 — Traverses et fermes'));
    expect(rang('2 — Traverses et fermes')).toBeLessThan(
      rang('3 — Contreventements (avant de libérer la grue)'),
    );
    expect(rang('3 — Contreventements (avant de libérer la grue)')).toBeLessThan(
      rang('4 — Pannes, lisses et liernes'),
    );
  });

  it('N’OUBLIE AUCUN REPÈRE du modèle', () => {
    /*
     * ⚠ L'invariant qui compte. Un rôle qu'aucune phase ne couvrirait ferait
     * disparaître ses pièces du tableau sans un mot — et une pièce absente de la
     * liste de montage est une pièce qui reste sur le camion. Le silence n'est
     * pas une réponse acceptable, ici comme ailleurs.
     */
    // Les repères d'ASSEMBLAGE des pièces qui se lèvent : une échantignolle
    // soudée arrive avec sa traverse, elle ne se monte pas seule.
    const attendus = new Set(MODEL.members.filter((m) => m.porteur === null).map((m) => m.assemblage));
    const listes = new Set(textes(PLANCHES[1] as Sheet));
    const manquants = [...attendus].filter((m) => !listes.has(m));
    expect(manquants, `absents du tableau de montage : ${manquants.join(', ')}`).toEqual([]);
  });

  it('donne la masse unitaire ET celle de la phase', () => {
    // L'une décide de l'engin, l'autre de la journée.
    expect(table).toContain('Masse de la phase');
    expect(table).toMatch(/Repère . Profil . Nb . kg\/pièce/);
  });
});

describe('robustesse', () => {
  it('tient dans le cadre sur tous les gabarits', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      const m = buildProject(p);
      for (const s of sheetsMontage(m, p, { page: 1, total: 60, meta: p.meta })) {
        expect(JSON.stringify(s.scene.entities), `${t.id} / ${s.titre}`).not.toMatch(
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
            expect(q.x, `${t.id} / ${s.titre} : x = ${q.x.toFixed(1)}`).toBeGreaterThan(-40);
            expect(q.x).toBeLessThan(460);
            expect(q.y, `${t.id} / ${s.titre} : y = ${q.y.toFixed(1)}`).toBeGreaterThan(-40);
            expect(q.y).toBeLessThan(340);
          }
        }
      }
    }
  });

  it('n’émet que des échelles normalisées', () => {
    const normalisees = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    for (const s of PLANCHES) expect(normalisees).toContain(s.echelle);
  });
});
