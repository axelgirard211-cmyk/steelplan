import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { ATELIER_PAR_DEFAUT } from '../../model/atelier';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { imbriquer, imbriquerEpaisseur } from '../imbrication';

const A = ATELIER_PAR_DEFAUT; // tôles 3 000 × 1 500, jeu 10 mm
const M = buildProject(DEFAULT_PROJECT);

describe('imbrication des tôles', () => {
  it('place chaque platine une fois et une seule', () => {
    const tout = imbriquer(M, A);
    const placees = tout.reduce(
      (t, e) => t + e.horsFormat.length + e.dispositions.reduce((u, d) => u + d.placements.length * d.nombre, 0),
      0,
    );
    expect(placees).toBe(M.plates.length);
  });

  it('ne fait jamais se chevaucher deux pièces, ni sortir une pièce de la tôle', () => {
    for (const e of imbriquer(M, A)) {
      for (const d of e.dispositions) {
        for (const [i, p] of d.placements.entries()) {
          expect(p.x, `${e.epaisseur} / ${p.mark}`).toBeGreaterThanOrEqual(A.jeuDecoupe - 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(A.jeuDecoupe - 1e-6);
          expect(p.x + p.largeur + A.jeuDecoupe).toBeLessThanOrEqual(e.longueur + 1e-6);
          expect(p.y + p.hauteur + A.jeuDecoupe).toBeLessThanOrEqual(e.largeur + 1e-6);
          for (const q of d.placements.slice(i + 1)) {
            const disjoints =
              p.x + p.largeur + A.jeuDecoupe <= q.x + 1e-6 ||
              q.x + q.largeur + A.jeuDecoupe <= p.x + 1e-6 ||
              p.y + p.hauteur + A.jeuDecoupe <= q.y + 1e-6 ||
              q.y + q.hauteur + A.jeuDecoupe <= p.y + 1e-6;
            expect(disjoints, `${p.mark} ∩ ${q.mark}`).toBe(true);
          }
        }
        expect(d.utilisation).toBeGreaterThan(0);
        expect(d.utilisation).toBeLessThanOrEqual(1);
      }
    }
  });

  it('range des pièces en étagères comme on le ferait à la main', () => {
    /*
     * Recalcul : douze pièces de 700 × 250 dans une tôle de 3 000 × 1 500, jeu
     * de 10. Sur la longueur, 10 + 4 × (700 + 10) = 2 850 ≤ 3 000 : quatre par
     * étagère. En hauteur, 10 + 5 × (250 + 10) = 1 310 ≤ 1 500 : cinq étagères.
     * Les douze tiennent sur une seule tôle, en trois étagères.
     */
    const pieces = Array.from({ length: 12 }, () => ({ mark: 'PL1', l: 700, h: 250, tournee: false }));
    const r = imbriquerEpaisseur(20, 'S235', pieces, A);
    expect(r.toles).toBe(1);
    expect(new Set(r.dispositions[0]!.placements.map((q) => q.y)).size).toBe(3);
  });

  it('écarte, en le disant, ce qui ne tient dans aucune tôle', () => {
    const r = imbriquerEpaisseur(30, 'S355', [{ mark: 'PP9', l: 3500, h: 800, tournee: false }], A);
    expect(r.horsFormat).toEqual(['PP9']);
    expect(r.toles).toBe(0);
  });
});
