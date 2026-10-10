import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { buildBom } from '../../bom/index';
import { runChecks } from '../../checks/index';
import { DEFAULT_PROJECT as P } from '../../model/defaults';
import { buildSheets } from '../buildSheets';
import { indexDesTextes, planchesDeLaPiece } from '../planchesDeLaPiece';

/**
 * DE LA PIÈCE CLIQUÉE EN 3D À SES PLANCHES.
 */

const M = buildProject(P);
const DOSSIER = buildSheets(M, P, buildBom(P, M), runChecks(P, M));
const INDEX = indexDesTextes(DOSSIER);
const poteau = M.members.find((m) => m.role === 'poteau' && m.assemblage !== m.mark);
if (!poteau) throw new Error('aucun poteau repéré');
const PL = planchesDeLaPiece(DOSSIER, INDEX, { debit: poteau.mark, assemblage: poteau.assemblage });
const ids = PL.map((p) => p.sheet.id);

describe('planches d’une pièce', () => {
  it('ouvre d’abord SON plan d’assemblage, puis son plan de pièce', () => {
    expect(ids[0]).toBe(`fabrication-${poteau.assemblage}`);
    expect(ids[1]).toBe(`debit-${poteau.mark}`);
  });

  it('montre sa place sur l’ouvrage : repérage et élévations', () => {
    expect(ids.some((i) => i.startsWith('montage-'))).toBe(true);
    expect(ids.some((i) => i.startsWith('facade-') || i === 'elevations')).toBe(true);
  });

  it('écarte les tableaux, qui citent la pièce sans la dessiner', () => {
    const kinds = new Set(PL.map((p) => p.sheet.kind));
    expect(kinds.has('nomenclature')).toBe(false);
    expect(ids).not.toContain('montage-ordre');
  });

  it('range en dernier les AUTRES assemblages qui emploient la même pièce de débit', () => {
    const autres = ids.filter((i) => i.startsWith('fabrication-') && i !== `fabrication-${poteau.assemblage}`);
    const premierAutre = Math.min(...autres.map((i) => ids.indexOf(i)));
    const dernierRepérage = Math.max(...ids.filter((i) => i.startsWith('montage-')).map((i) => ids.indexOf(i)));
    expect(premierAutre).toBeGreaterThan(dernierRepérage);
  });

  it('donne, pour chaque planche, les repères à y cadrer', () => {
    for (const p of PL) {
      expect(p.reperes.length).toBeGreaterThan(0);
      for (const r of p.reperes) expect([poteau.mark, poteau.assemblage]).toContain(r);
    }
  });

  it('trouve aussi les planches d’une tôle', () => {
    const t = M.plates[0];
    if (!t) throw new Error('aucune tôle');
    expect(planchesDeLaPiece(DOSSIER, INDEX, { debit: t.mark, assemblage: '' }).length).toBeGreaterThan(0);
  });
});
