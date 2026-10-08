import { describe, expect, it } from 'vitest';
import { buildProject } from '../../core/build/buildProject';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import { lotDxfToles, toleToDxf } from '../dxfTole';

const M = buildProject(DEFAULT_PROJECT);

/** Paires (code, valeur) d'un DXF. */
function paires(dxf: string): [string, string][] {
  const l = dxf.split('\r\n');
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < l.length; i += 2) out.push([(l[i] as string).trim(), l[i + 1] as string]);
  return out;
}

describe('DXF de découpe des tôles', () => {
  it('livre un fichier par repère de tôle, quantité dans le nom', () => {
    const lot = lotDxfToles(M);
    const reperes = new Set(M.plates.map((pl) => pl.mark));
    expect(lot).toHaveLength(reperes.size);
    for (const f of lot) expect(f.nom).toMatch(/^[A-Z]+\d+-ep\d+-S\d+-x\d+\.dxf$/);
  });

  it('trace la tôle à l’échelle 1 : un cercle par trou, au diamètre de perçage', () => {
    const pl = M.plates.find((x) => x.holes.length > 0)!;
    const p = paires(toleToDxf(pl, 1));
    // Rayons des cercles du calque PERCAGE.
    const rayons: number[] = [];
    for (let i = 0; i < p.length; i++) {
      if (p[i]?.[0] === '0' && p[i]?.[1] === 'CIRCLE') {
        let calque = '';
        let r = 0;
        for (let k = i + 1; k < p.length && p[k]?.[0] !== '0'; k++) {
          if (p[k]?.[0] === '8') calque = p[k]![1];
          if (p[k]?.[0] === '40') r = Number(p[k]![1]);
        }
        if (calque === 'PERCAGE') rayons.push(r);
      }
    }
    expect(rayons).toHaveLength(pl.holes.length);
    for (const [i, h] of pl.holes.entries()) expect(rayons[i]).toBeCloseTo(h.d / 2, 6);
  });

  it('pose le contour sur DECOUPE, sans cadre ni cartouche', () => {
    const dxf = toleToDxf(M.plates[0]!, 1);
    expect(dxf).toContain('DECOUPE');
    expect(dxf).not.toMatch(/\r\nCADRE\r\n/);
    expect(dxf).not.toMatch(/\r\nCARTOUCHE\r\n/);
    // Origine au coin de l'encombrement : aucune coordonnée négative.
    const xs = paires(dxf).filter(([c]) => c === '10' || c === '20').map(([, v]) => Number(v));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-6);
  });

  it('découpe un oblong suivant son contour, et non comme un trou rond', () => {
    /*
     * ⚠ Un oblong exporté en cercle partirait percé rond : la tête de potelet
     * serait bloquée sous la traverse. Le gousset de tête n'a que des oblongs —
     * aucun cercle, deux contours fermés en plus du sien.
     */
    const g = M.plates.find((x) => x.kind === 'gousset-tete')!;
    const p = paires(toleToDxf(g, 1));
    expect(p.filter(([c, v]) => c === '0' && v === 'CIRCLE')).toHaveLength(0);
    expect(p.filter(([c, v]) => c === '0' && v === 'POLYLINE').length).toBeGreaterThanOrEqual(3);
  });
});
