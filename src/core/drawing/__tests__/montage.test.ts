import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { frameStations } from '../../model/grid';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import { FORMATS } from '../layout';
import type { DrawEntity } from '../scene';
import type { Sheet } from '../sheet';
import { sheetsMontage } from '../sheets/montage';
import { H_REPERE } from '../sheets/reperageVues';

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
const planche = (id: string): Sheet => {
  const s = PLANCHES.find((x) => x.id === id);
  if (!s) throw new Error(`planche ${id} absente`);
  return s;
};
const VUES = ['montage-plan', 'montage-avant', 'montage-arriere', 'montage-pignons'];

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
  it('édite la toiture, chaque long pan, les pignons et l’ordre de montage', () => {
    /*
     * ⚠ Une seule élévation superposait les deux long-pans : le monteur ne
     * savait pas de quel côté était la palée qu'il lisait. Une vue par façade.
     */
    expect(PLANCHES.map((s) => s.id)).toEqual([...VUES, 'montage-ordre']);
    for (const s of PLANCHES) expect(s.kind).toBe('montage');
  });

  it('répète le repère sur CHAQUE file, et non une seule fois', () => {
    /*
     * ⚠ C'est toute la différence avec un plan d'ensemble. Celui-ci repère un
     * exemplaire pour identifier une famille ; le plan de montage repère chaque
     * pièce à sa position. Un seul « PO1 » sur la planche et le monteur ne sait
     * pas si les six files portent le même poteau.
     */
    for (const id of ['montage-avant', 'montage-arriere']) {
      // Un poteau par file, courant (PO1A) ou d'angle (PO1B…) : tous repérés.
      const marques = marquesDessinees(planche(id)).filter((t) => /^PO1[A-Z]?$/.test(t));
      expect(marques.length, `${id} : ${marques.length} repère(s) PO1`).toBe(frameStations(P.grid).length);
    }
  });

  it('numérote les files sur le plan et les long-pans, les long-pans sur les pignons', () => {
    // Seule façon de situer une pièce sur le chantier.
    for (const id of ['montage-plan', 'montage-avant', 'montage-arriere']) {
      const t = marquesDessinees(planche(id));
      for (let i = 1; i <= frameStations(P.grid).length; i++) expect(t, `${id} : file ${i}`).toContain(`${i}`);
    }
    const pignons = marquesDessinees(planche('montage-pignons'));
    expect(pignons).toContain('A');
    expect(pignons).toContain('B');
  });

  it('ne pose aucun repère sur un autre', () => {
    /*
     * ⚠ Les repères s'écrivaient sur les barres et les uns sur les autres :
     * « TR1B » se lisait barré par l'âme de la traverse. Chacun a désormais sa
     * place, sur un masque qui coupe les traits sous lui.
     */
    for (const id of VUES) {
      const boites = planche(id).scene.entities.flatMap((e: DrawEntity) => {
        if (e.kind !== 'texte' || e.layer !== 'reperage' || e.hauteur !== H_REPERE) return [];
        const l = (e.texte.length * 0.62 * H_REPERE) / 2;
        return [{ texte: e.texte, x0: e.at.x - l, x1: e.at.x + l, y0: e.at.y - H_REPERE / 2, y1: e.at.y + H_REPERE / 2 }];
      });
      expect(boites.length, id).toBeGreaterThan(0);
      for (let i = 0; i < boites.length; i++) {
        for (let j = i + 1; j < boites.length; j++) {
          const a = boites[i]!;
          const b = boites[j]!;
          const recouvre = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
          expect(recouvre, `${id} : ${a.texte} sur ${b.texte}`).toBe(false);
        }
      }
      // Et chacun sur son masque blanc.
      const masques = planche(id).scene.entities.filter((e) => e.kind === 'remplissage' && e.gris === 1);
      expect(masques.length, id).toBe(boites.length);
    }
  });
});

describe('ordre de montage', () => {
  const table = textes(planche('montage-ordre')).join('\n');

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
    const listes = new Set(textes(planche('montage-ordre')));
    const manquants = [...attendus].filter((m) => !listes.has(m));
    expect(manquants, `absents du tableau de montage : ${manquants.join(', ')}`).toEqual([]);
  });

  it('porte aussi les chevêtres d’ouverture', () => {
    // Le projet par défaut n'en a pas : sans ouverture, leur oubli ne se voyait pas.
    const p = {
      ...P,
      ouvertures: {
        enabled: true,
        profile: 'UPE 160',
        grade: 'S235',
        items: [{ id: 'P1', face: 'long-pan-gauche', type: 'portail', position: 7000, largeur: 4000, hauteur: 4500, allege: 0 }],
      },
    } as const;
    const m = buildProject(p);
    const ordre = sheetsMontage(m, p, { page: 1, total: 60, meta: META }).find((s) => s.id === 'montage-ordre');
    const listes = new Set(ordre ? textes(ordre) : []);
    const chevetres = new Set(m.members.filter((x) => x.role === 'chevetre' && x.porteur === null).map((x) => x.assemblage));
    expect(chevetres.size).toBeGreaterThan(0);
    expect([...chevetres].filter((c) => !listes.has(c))).toEqual([]);
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
        const f = FORMATS[s.format];
        expect(JSON.stringify(s.scene.entities), `${t.id} / ${s.titre}`).not.toMatch(
          /null|NaN|Infinity/,
        );
        // Aucun repère laissé sans place sur les gabarits livrés.
        expect(textes(s).filter((x) => x.startsWith('Repères sans place')), `${t.id} / ${s.titre}`).toEqual([]);
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
            expect(q.x, `${t.id} / ${s.titre} : x = ${q.x.toFixed(1)}`).toBeGreaterThan(0);
            expect(q.x, `${t.id} / ${s.titre} : x = ${q.x.toFixed(1)}`).toBeLessThan(f.largeur);
            expect(q.y, `${t.id} / ${s.titre} : y = ${q.y.toFixed(1)}`).toBeGreaterThan(-10);
            expect(q.y, `${t.id} / ${s.titre} : y = ${q.y.toFixed(1)}`).toBeLessThan(f.hauteur);
          }
        }
      }
    }
  });

  it('n’émet que des échelles normalisées', () => {
    const normalisees = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    for (const s of PLANCHES) expect(normalisees).toContain(s.echelle);
    // Le plan de toiture d'une halle courante se lit au 1:100, quitte à passer en A2.
    expect(planche('montage-plan').echelle).toBeLessThanOrEqual(100);
  });
});
