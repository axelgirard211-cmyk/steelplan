import { describe, expect, it } from 'vitest';
import { buildProject } from '../../core/build/buildProject';
import { getProfile } from '../../core/catalog/index';
import { cutLengths } from '../../core/geometry/member';
import { polygonArea, sectionOutline } from '../../core/geometry/section';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import { TEMPLATES } from '../../core/model/templates';
import { memberGeometry } from '../meshFactory';

/**
 * MAILLAGE DES BARRES : un solide fermé, faces tournées hors du métal.
 *
 * ⚠ Le volume algébrique d'un maillage (théorème de flux) ne vaut le volume de
 * la pièce que si TOUTES ses faces regardent vers l'extérieur de la matière. Une
 * face retournée le fausse aussitôt : c'est ce contrôle qui a trouvé l'intérieur
 * des tubes tourné à l'envers.
 */
describe('maillage des barres', () => {
  it('a le volume de la pièce — aire de section × longueur à l’axe — sur tous les gabarits', () => {
    const barres = [DEFAULT_PROJECT, ...TEMPLATES.map((t) => t.build())].flatMap((p) => buildProject(p).members);
    expect(barres.some((b) => getProfile(b.profileId).shape === 'CHS')).toBe(true);
    expect(barres.some((b) => b.mirrored)).toBe(true);
    for (const b of barres) {
      const sec = sectionOutline(getProfile(b.profileId), 6);
      const aire = Math.abs(polygonArea(sec.outer)) - sec.holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0);
      const p = memberGeometry(b, 6).getAttribute('position');
      let v = 0;
      for (let k = 0; k < p.count; k += 3) {
        const [ax, ay, az] = [p.getX(k), p.getY(k), p.getZ(k)];
        const [bx, by, bz] = [p.getX(k + 1), p.getY(k + 1), p.getZ(k + 1)];
        const [cx, cy, cz] = [p.getX(k + 2), p.getY(k + 2), p.getZ(k + 2)];
        v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      }
      // Positif : les faces regardent dehors ; égal au volume : aucune n'est retournée.
      expect(v / (aire * cutLengths(b).axis), `${b.id} ${b.profileId}`).toBeCloseTo(1, 2);
    }
  });
});
