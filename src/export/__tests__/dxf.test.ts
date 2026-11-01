import { describe, expect, it } from 'vitest';
import { DrawScene, pt } from '../../core/drawing/scene';
import { dxfEnOctets, sheetToDxf } from '../dxf';

/** Valeur du code de groupe donné, à la première occurrence après `depuis`. */
function valeur(dxf: string, depuis: string, code: string): string {
  const l = dxf.split('\r\n');
  const i = l.indexOf(depuis);
  for (let k = i + 1; k + 1 < l.length; k += 2) if ((l[k] as string).trim() === code) return l[k + 1] as string;
  throw new Error(`code ${code} absent`);
}

describe('DXF R12', () => {
  it('écrit un arc horaire angles permutés, pour que la CAO trace le même arc', () => {
    // De 90° à 0° en sens horaire : le quart supérieur droit, pas les trois autres.
    const scene = new DrawScene().arc(pt(0, 0), 10, Math.PI / 2, 0);
    const dxf = sheetToDxf({ scene });
    expect(Number(valeur(dxf, 'ARC', '50'))).toBe(0);
    expect(Number(valeur(dxf, 'ARC', '51'))).toBe(90);
  });

  it('annonce Windows-1252 et en écrit réellement les octets', () => {
    const scene = new DrawScene().texte(pt(0, 0), 'Élévation');
    const dxf = sheetToDxf({ scene });
    expect(valeur(dxf, '$DWGCODEPAGE', '3')).toBe('ANSI_1252');
    const octets = dxfEnOctets(dxf);
    expect(octets.length).toBe(dxf.length); // un octet par caractère, pas d'UTF-8
    expect(octets[dxf.indexOf('Élévation')]).toBe(0xc9);
    expect(dxfEnOctets('€')[0]).toBe(0x80);
  });
});
