import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { memberFrame, sectionPointAt } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import { listerBoulons } from '../bolts';
import { buildProject } from '../buildProject';

/**
 * IMPLANTATION DE LA BOULONNERIE.
 *
 * ⚠ Ces contrôles portent sur la propriété qui compte : la liste qui SERT À
 * DESSINER les boulons est celle qui les COMPTE. Le jour où l'une des deux
 * changerait sans l'autre, la vue 3D et la nomenclature se contrediraient, et
 * rien dans l'application ne permettrait de savoir laquelle croire.
 */

const P = DEFAULT_PROJECT;
const model = buildProject(P);
const boulons = listerBoulons(model.members, model.plates);

describe('liste unique', () => {
  it('donne exactement le nombre de boulons annoncé par le modèle', () => {
    expect(boulons).toHaveLength(model.stats.boltCount);
  });

  it('vaut pour tous les gabarits, treillis compris', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      const m = buildProject(p);
      expect(listerBoulons(m.members, m.plates).length, t.id).toBe(m.stats.boltCount);
    }
  });

  it('ne pose aucun boulon en double sur un même axe', () => {
    // Un boulon vu depuis ses deux pièces serait posé deux fois exactement au
    // même endroit : c'est l'erreur que la provenance des trous sert à éviter.
    const cles = boulons.map(
      (b) => `${b.at.x.toFixed(1)}|${b.at.y.toFixed(1)}|${b.at.z.toFixed(1)}`,
    );
    expect(new Set(cles).size).toBe(cles.length);
  });
});

describe('géométrie de chaque boulon', () => {
  it('a un axe unitaire et des dimensions plausibles', () => {
    for (const b of boulons) {
      const norme = Math.hypot(b.axis.x, b.axis.y, b.axis.z);
      expect(norme).toBeCloseTo(1, 6);
      expect(b.d).toBeGreaterThanOrEqual(13);
      expect(b.d).toBeLessThanOrEqual(33);
      expect(b.grip).toBeGreaterThan(0);
      // Un serrage supérieur à 300 mm ne correspondrait à aucun assemblage de
      // charpente : ce serait le signe d'une épaisseur mal reprise.
      expect(b.grip).toBeLessThan(300);
      for (const v of [b.at.x, b.at.y, b.at.z]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('reste dans l’emprise du bâtiment, marges d’assemblage comprises', () => {
    const marge = 500;
    for (const b of boulons) {
      expect(b.at.z).toBeGreaterThan(-marge);
      expect(b.at.z).toBeLessThan(P.grid.eaveHeight + 3000 + marge);
      expect(b.at.y).toBeGreaterThan(-marge);
      expect(b.at.y).toBeLessThan(P.grid.span + marge);
    }
  });

  it('sort la tête du métal, du côté extérieur de la pièce percée', () => {
    /*
     * ⚠ Le point de pose est la face extérieure de l'empilage, pas l'axe du trou.
     * Poser la tête au centre du perçage la noie dans l'acier : la boulonnerie
     * est alors calculée, comptée, commandée — et invisible, alors que c'est
     * précisément elle qui rend un assemblage lisible.
     */
    const barresPercees = model.members.filter((m) => m.holes.length > 0);
    expect(barresPercees.length).toBeGreaterThan(0);

    let verifies = 0;
    for (const m of barresPercees.slice(0, 40)) {
      const f = memberFrame(m);
      const profil = getProfile(m.profileId);
      for (const h of m.holes) {
        const centre = sectionPointAt(f, m.start, h.s, h.at);
        const proche = boulons.find(
          (b) => Math.hypot(b.at.x - centre.x, b.at.y - centre.y, b.at.z - centre.z) < 80,
        );
        if (!proche) continue;
        const ecart = Math.hypot(
          proche.at.x - centre.x,
          proche.at.y - centre.y,
          proche.at.z - centre.z,
        );
        const paroi = h.through === 'z' && profil.shape === 'I' ? profil.tf : 10;
        // Au moins la demi-paroi : la tête n'est jamais dans le plan du perçage.
        expect(ecart, `${m.id} @ ${h.s}`).toBeGreaterThan(paroi / 2 - 0.01);
        verifies += 1;
      }
    }
    expect(verifies).toBeGreaterThan(20);
  });
});

describe('tiges d’ancrage', () => {
  it('sont posées aux pieds de poteaux, et seulement là', () => {
    const ancrages = boulons.filter((b) => b.kind === 'ancrage');
    expect(ancrages.length).toBeGreaterThan(0);
    // Quatre par platine de pied, une platine par poteau.
    const poteaux = model.members.filter((m) => m.role === 'poteau').length;
    expect(ancrages.length % poteaux).toBe(0);
    for (const a of ancrages) expect(a.at.z).toBeLessThan(200);
  });
});
