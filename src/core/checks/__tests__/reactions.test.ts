import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import { frameStations } from '../../model/grid';
import { runChecks } from '../index';
import { souleve } from '../reactions';

/**
 * DESCENTE DE CHARGES.
 *
 * ⚠ Ces tests recalculent les efforts DEPUIS LES CHARGES SAISIES, et ne se
 * contentent pas de vérifier que le tableau est cohérent avec lui-même. Le signe
 * de la réaction a été lu à l'envers pendant tout le développement de ce module :
 * l'enveloppe était parfaitement cohérente, symétrique, plausible — et annonçait
 * 81 kN de SOULÈVEMENT sous « 1,35 G + 1,50 Q », le cas le plus gravitaire du
 * dossier. Rien d'interne ne pouvait le dire ; seul un ordre de grandeur calculé
 * à la main l'a montré.
 */

const P = DEFAULT_PROJECT;
const R = runChecks(P, buildProject(P));

describe('couverture des appuis', () => {
  it('donne un appui par pied de poteau du bâtiment', () => {
    // Deux pieds par file, autant de files que de portiques.
    expect(R.reactions).toHaveLength(2 * frameStations(P.grid).length);
  });

  it('repère les appuis comme un plan : une lettre, un numéro de file', () => {
    const reperes = R.reactions.map((a) => a.repere);
    expect(new Set(reperes).size, 'repères en double').toBe(reperes.length);
    for (const r of reperes) expect(r).toMatch(/^[A-Z]\d+$/);
    expect(reperes).toContain('A1');
    expect(reperes).toContain(`B${frameStations(P.grid).length}`);
  });
});

describe('sens et ordre de grandeur', () => {
  it('COMPRIME sous la combinaison gravitaire, et pas l’inverse', () => {
    /*
     * ⚠ Le test décisif. La compression maximale doit venir d'une combinaison
     * qui ne contient PAS de vent : sous 1,35 G + 1,50 Q, un poteau appuie sur
     * sa semelle. Si la compression maximale sortait d'un cas de vent, c'est que
     * le signe est inversé.
     */
    for (const a of R.reactions) {
      expect(a.compression.fz, `${a.repere} : compression négative`).toBeGreaterThan(0);
      expect(a.compression.combinaison, `${a.repere} : ${a.compression.combinaison}`).not.toMatch(
        /W/,
      );
    }
  });

  it('reste dans l’ordre de grandeur de la charge appliquée', () => {
    // Charge ELU gravitaire sur un portique courant, calculée à la main ici.
    const l = P.loads.loads;
    const k = P.loads.factors;
    const aire = (P.grid.span / 1000) * (P.grid.baySpacing / 1000);
    const qElu = k.gammaG * l.permanent + k.gammaQ * Math.max(l.exploitation, l.neige);
    const applique = aire * qElu;

    const courant = R.reactions.find((a) => a.repere === 'A3');
    expect(courant).toBeDefined();
    const total = 2 * (courant as { compression: { fz: number } }).compression.fz;

    /*
     * Le total repris par les deux pieds doit dépasser la charge de toiture
     * saisie — il s'y ajoute le poids propre de l'ossature — sans en faire le
     * double. Une fourchette large, mais qui attrape toute erreur de facteur.
     */
    expect(total, `${total.toFixed(0)} kN pour ${applique.toFixed(0)} kN appliqués`).toBeGreaterThan(
      applique,
    );
    expect(total).toBeLessThan(applique * 2);
  });

  it('charge deux fois moins les files de rive que les files courantes', () => {
    // Une file de rive ne reprend qu'une demi-travée.
    const rive = R.reactions.find((a) => a.repere === 'A1');
    const courant = R.reactions.find((a) => a.repere === 'A3');
    expect(rive && courant).toBeTruthy();
    const rapport = (courant as { compression: { fz: number } }).compression.fz /
      (rive as { compression: { fz: number } }).compression.fz;
    expect(rapport, `rapport courant/rive = ${rapport.toFixed(2)}`).toBeGreaterThan(1.4);
    expect(rapport).toBeLessThan(2.2);
  });

  it('n’annonce un moment que sur un pied ENCASTRÉ', () => {
    // Un pied articulé ne transmet pas de moment : en annoncer un ferait
    // ferrailler une semelle pour rien.
    for (const a of R.reactions) {
      expect(Math.abs(a.moment.m), `${a.repere}`).toBeLessThan(0.5);
    }
    const encastre = runChecks(
      { ...P, frame: { ...P.frame, baseFixity: 'encastre' } },
      buildProject({ ...P, frame: { ...P.frame, baseFixity: 'encastre' } }),
    );
    expect(Math.max(...encastre.reactions.map((a) => Math.abs(a.moment.m)))).toBeGreaterThan(1);
  });

  it('détecte le soulèvement quand le vent arrache', () => {
    // Le projet par défaut a une dépression de vent forte : au moins un pied
    // doit passer en traction, sans quoi l'ancrage n'aurait pas à être vérifié.
    expect(R.reactions.some(souleve)).toBe(true);
  });
});

describe('robustesse', () => {
  it('sort une descente de charges sur tous les gabarits', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      const r = runChecks(p, buildProject(p));
      expect(r.reactions.length, t.id).toBe(2 * frameStations(p.grid).length);
      for (const a of r.reactions) {
        for (const v of [a.compression.fz, a.soulevement.fz, a.horizontal.fy, a.moment.m]) {
          expect(Number.isFinite(v), `${t.id} / ${a.repere}`).toBe(true);
        }
        expect(a.compression.fz, `${t.id} / ${a.repere}`).toBeGreaterThanOrEqual(a.soulevement.fz);
      }
    }
  });
});

describe('pieds de potelets', () => {
  it('rendent la moitié du vent de pignon, recalculée depuis la pression saisie', () => {
    /*
     * 3 potelets sur 20 m : entraxe 5 m. Sous 1,50 W, un potelet de longueur L
     * rend à son pied 1,5 × 0,60 kN/m² × 5 m × L / 2 — 14,2 kN pour les potelets
     * de rive (6,32 m), 15,3 kN pour celui du faîtage (6,82 m).
     * ⚠ La ligne de vérification de PT1 est gouvernée par l'élancement et garde
     * « 1,35 G + 1,50 Q » : y lire la réaction annonçait un pied sans vent.
     */
    const M = buildProject(P);
    expect(R.piedsPotelets.map((a) => a.mark).sort()).toEqual(['PT1', 'PT2']);
    for (const a of R.piedsPotelets) {
      const po = M.members.find((m) => m.role === 'potelet' && m.mark === a.mark);
      const L = po ? po.end.z - po.start.z : 0;
      expect(a.v).toBeCloseTo((1.5 * P.loads.loads.ventPression * 5 * (L / 1000)) / 2, 1);
      expect(a.combinaison).toContain('1,50 W');
    }
  });
});
