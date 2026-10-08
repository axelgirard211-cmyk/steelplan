import { describe, expect, it } from 'vitest';
import { getProfile, PROFILES } from '../../catalog/index';
import { polygonArea, sectionOutline } from '../section';
import {
  cutAngle,
  cutAngleDeg,
  cutLengths,
  memberFrame,
  miterCut,
  squareCut,
  type Member,
} from '../member';
import { deg2rad, rad2deg } from '../../math/tolerance';
import { EY, EZ, normalize, sub, v3 } from '../../math/vec3';

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

/**
 * Le contour de section est la géométrie qui alimente à la fois le maillage 3D
 * et le tracé des plans. S'il est faux, tout l'est. On le recoupe par son aire :
 * une aire de polygone qui retombe sur l'aire du catalogue à 1 % près ne peut
 * pas cacher une erreur de tracé.
 */
describe('contour de section', () => {
  it('est fermé, non dégénéré et orienté dans le sens trigonométrique', () => {
    for (const p of PROFILES) {
      const o = sectionOutline(p);
      expect(o.outer.length, `${p.id} : contour trop court`).toBeGreaterThan(3);
      expect(polygonArea(o.outer), `${p.id} : sens du contour`).toBeGreaterThan(0);
      for (const t of o.holes) {
        expect(polygonArea(t), `${p.id} : sens du vide`).toBeLessThan(0);
      }
      for (const pt of [...o.outer, ...o.holes.flat()]) {
        expect(Number.isFinite(pt.y) && Number.isFinite(pt.z), `${p.id} : point non fini`).toBe(true);
      }
    }
  });

  it('reste dans l’encombrement h × b annoncé', () => {
    for (const p of PROFILES) {
      const o = sectionOutline(p);
      const zs = o.outer.map((q) => q.z);
      const ys = o.outer.map((q) => q.y);
      expect(Math.max(...zs) - Math.min(...zs), `${p.id} hauteur`).toBeCloseTo(p.h, 6);
      expect(Math.max(...ys) - Math.min(...ys), `${p.id} largeur`).toBeCloseTo(p.b, 6);
    }
  });

  it('retrouve l’aire de catalogue des profils en I à 1 % près', () => {
    for (const p of PROFILES) {
      if (p.shape !== 'I') continue;
      const o = sectionOutline(p, 24);
      expect(rel(polygonArea(o.outer), p.A), `${p.id}`).toBeLessThan(0.01);
    }
  });

  it('retrouve l’aire des UPE à 1 % près (ailes parallèles)', () => {
    for (const p of PROFILES) {
      if (p.shape !== 'U' || p.family !== 'UPE') continue;
      expect(rel(polygonArea(sectionOutline(p, 24).outer), p.A), `${p.id}`).toBeLessThan(0.01);
    }
  });

  it('incline les ailes des UPN à 8 % et laisse celles des UPE parallèles', () => {
    for (const p of PROFILES) {
      if (p.shape !== 'U') continue;
      const o = sectionOutline(p, 24);
      // Épaisseur d'aile au bout et au pied, mesurées sur le contour.
      const yBout = Math.max(...o.outer.map((q) => q.y));
      const zHaut = Math.max(...o.outer.map((q) => q.z));
      const auBout = o.outer.filter((q) => Math.abs(q.y - yBout) < 1e-6).map((q) => q.z);
      const epaisseurBout = zHaut - Math.max(...auBout.filter((z) => z < zHaut - 1e-9));

      if (p.family === 'UPE') {
        expect(epaisseurBout, `${p.id}`).toBeCloseTo(p.tf, 6);
      } else {
        // Aile amincie vers le bout, de la moitié du débord × 8 %.
        const attendu = p.tf - 0.08 * ((p.b - p.tw) / 2);
        expect(epaisseurBout, `${p.id}`).toBeCloseTo(attendu, 6);
        expect(epaisseurBout).toBeLessThan(p.tf);
      }
    }
  });

  it('conserve l’aire d’aile des UPN : la pente pivote à mi-débord', () => {
    for (const p of PROFILES) {
      if (p.shape !== 'U' || p.family !== 'UPN') continue;
      // Le pivot à mi-débord épaissit le pied autant qu'il amincit le bout :
      // l'aire ne change pas, seule la forme le fait.
      expect(rel(polygonArea(sectionOutline(p, 24).outer), p.A), `${p.id}`).toBeLessThan(0.035);
    }
  });

  it('retrouve l’aire des cornières à 2 % près', () => {
    for (const p of PROFILES) {
      if (p.shape !== 'L') continue;
      expect(rel(polygonArea(sectionOutline(p, 24).outer), p.A), `${p.id}`).toBeLessThan(0.02);
    }
  });

  it('retrouve exactement l’aire nette des tubes et des plats', () => {
    for (const p of PROFILES) {
      if (p.shape !== 'CHS' && p.shape !== 'BOX' && p.shape !== 'RECT') continue;
      const o = sectionOutline(p, 40);
      const nette = polygonArea(o.outer) + o.holes.reduce((s, t) => s + polygonArea(t), 0);
      // Les arcs sont discrétisés : l'écart est celui de la corde, pas du tracé.
      expect(rel(nette, p.A), `${p.id}`).toBeLessThan(0.01);
    }
  });

  it('centre le contour sur le centre de gravité', () => {
    // Sur une section doublement symétrique, le contour doit être centré.
    for (const id of ['IPE 300', 'HEB 200', 'CHS 168.3x5', 'SHS 100x100x5']) {
      const o = sectionOutline(getProfile(id), 40);
      const zs = o.outer.map((q) => q.z);
      const ys = o.outer.map((q) => q.y);
      expect(Math.max(...zs) + Math.min(...zs), `${id} centrage z`).toBeCloseTo(0, 6);
      expect(Math.max(...ys) + Math.min(...ys), `${id} centrage y`).toBeCloseTo(0, 6);
    }
    // Sur un U, le dos de l'âme est à −cy du centre de gravité.
    const upe = getProfile('UPE 200');
    const o = sectionOutline(upe, 24);
    expect(Math.min(...o.outer.map((q) => q.y))).toBeCloseTo(-(upe as { cy: number }).cy, 6);
  });
});

/* ------------------------------------------------------------------ */

function barre(partiel: Partial<Member> & Pick<Member, 'start' | 'end'>): Member {
  const axe = normalize(sub(partiel.end, partiel.start));
  return {
    id: 'test',
    role: 'poteau',
    profileId: 'IPE 400',
    grade: 'S235',
    up: EY,
    mirrored: false,
    holes: [],
    notches: [],
    porteur: null,
    cutStart: squareCut(partiel.start, axe, -1),
    cutEnd: squareCut(partiel.end, axe, 1),
    mark: '',
    assemblage: '',
    position: '',
    ...partiel,
  };
}

describe('longueurs et angles de coupe', () => {
  it('coupe droite : les trois longueurs sont égales à la distance des abouts', () => {
    const m = barre({ start: v3(0, 0, 0), end: v3(0, 0, 6000) });
    const l = cutLengths(m);
    expect(l.axis).toBeCloseTo(6000, 6);
    expect(l.min).toBeCloseTo(6000, 6);
    expect(l.max).toBeCloseTo(6000, 6);
    expect(cutAngleDeg(m, 'start')).toBe(0);
    expect(cutAngleDeg(m, 'end')).toBe(0);
  });

  it('coupe d’onglet : chaque barre est coupée à 90° − ψ/2 de son plan droit', () => {
    // Deux barres formant un angle droit (ψ = 90°) : onglet à 45°.
    const noeud = v3(0, 0, 6000);
    const sortieA = v3(0, 0, -1); // le poteau redescend
    const sortieB = v3(0, 1, 0); // la traverse part à l'horizontale
    const m = barre({
      start: v3(0, 0, 0),
      end: noeud,
      cutEnd: miterCut(noeud, sortieA, sortieB),
    });
    expect(rad2deg(cutAngle(m, 'end'))).toBeCloseTo(45, 6);
  });

  it('coupe d’onglet : deux barres alignées donnent une coupe droite', () => {
    const noeud = v3(0, 0, 6000);
    const m = barre({
      start: v3(0, 0, 0),
      end: noeud,
      cutEnd: miterCut(noeud, v3(0, 0, -1), v3(0, 0, 1)),
    });
    expect(rad2deg(cutAngle(m, 'end'))).toBeCloseTo(0, 6);
  });

  it('genou de portique à 10 % : angle de coupe = 45° − pente/2', () => {
    const pente = Math.atan(0.1); // 5,7106°
    const genou = v3(0, 0, 6000);
    const rampant = v3(0, Math.cos(pente), Math.sin(pente));
    const m = barre({
      start: v3(0, 0, 0),
      end: genou,
      cutEnd: miterCut(genou, v3(0, 0, -1), rampant),
    });
    const attendu = 45 - rad2deg(pente) / 2;
    expect(rad2deg(cutAngle(m, 'end'))).toBeCloseTo(attendu, 6);
    expect(attendu).toBeCloseTo(42.1447, 3);
  });

  it('les deux angles d’un onglet referment exactement le changement de direction', () => {
    const pente = deg2rad(12);
    const genou = v3(0, 0, 5000);
    const rampant = v3(0, Math.cos(pente), Math.sin(pente));
    const versBas = v3(0, 0, -1);

    const poteau = barre({ start: v3(0, 0, 0), end: genou, cutEnd: miterCut(genou, versBas, rampant) });
    const traverse = barre({
      start: genou,
      end: v3(0, 10000 * Math.cos(pente), 5000 + 10000 * Math.sin(pente)),
      up: v3(0, -Math.sin(pente), Math.cos(pente)),
      cutStart: miterCut(genou, rampant, versBas),
    });

    const somme = rad2deg(cutAngle(poteau, 'end')) + rad2deg(cutAngle(traverse, 'start'));
    // Le poteau est vertical, la traverse à 12° de l'horizontale : la direction
    // tourne de 90° − 12° = 78°.
    expect(somme).toBeCloseTo(78, 6);
  });

  it('la coupe biaise allonge une fibre et raccourcit l’autre, symétriquement', () => {
    const pente = Math.atan(0.1);
    const genou = v3(0, 0, 6000);
    const rampant = v3(0, Math.cos(pente), Math.sin(pente));
    const m = barre({
      start: v3(0, 0, 0),
      end: genou,
      profileId: 'IPE 400',
      cutEnd: miterCut(genou, v3(0, 0, -1), rampant),
    });
    const l = cutLengths(m);
    const h = getProfile('IPE 400').h;
    const attenduEcart = h * Math.tan(cutAngle(m, 'end'));

    expect(l.axis).toBeCloseTo(6000, 6); // le plan passe par le point de travail
    expect(l.max - l.min).toBeCloseTo(attenduEcart, 3);
    expect(l.max - l.axis).toBeCloseTo(l.axis - l.min, 3); // symétrie
    expect(l.max).toBeCloseTo(6181.0, 0);
    expect(l.min).toBeCloseTo(5819.0, 0);
  });

  it('le repère local est orthonormé et direct', () => {
    const pente = deg2rad(20);
    const m = barre({
      start: v3(0, 0, 0),
      end: v3(0, 1000 * Math.cos(pente), 1000 * Math.sin(pente)),
      up: v3(0, -Math.sin(pente), Math.cos(pente)),
    });
    const f = memberFrame(m);
    const dot = (a: typeof f.ax, b: typeof f.ax) => a.x * b.x + a.y * b.y + a.z * b.z;
    expect(dot(f.ax, f.ax)).toBeCloseTo(1, 9);
    expect(dot(f.ay, f.ay)).toBeCloseTo(1, 9);
    expect(dot(f.az, f.az)).toBeCloseTo(1, 9);
    expect(dot(f.ax, f.az)).toBeCloseTo(0, 9);
    expect(dot(f.ax, f.ay)).toBeCloseTo(0, 9);
    expect(dot(f.ay, f.az)).toBeCloseTo(0, 9);
  });

  it('ré-orthogonalise un « up » approximatif sans casser le repère', () => {
    const m = barre({ start: v3(0, 0, 0), end: v3(0, 0, 1000), up: v3(0, 1, 0.3) });
    const f = memberFrame(m);
    expect(f.az.z).toBeCloseTo(0, 9); // composante parallèle à l'axe retirée
    expect(f.az.y).toBeCloseTo(1, 9);
  });

  it('refuse un plan de coupe parallèle à l’axe', () => {
    const m = barre({
      start: v3(0, 0, 0),
      end: v3(0, 0, 1000),
      cutEnd: { point: v3(0, 0, 1000), normal: EY },
    });
    expect(() => cutLengths(m)).toThrow(/parallèle/);
  });

  it('l’onglet est indépendant du sens de parcours de la barre', () => {
    const pente = deg2rad(15);
    const noeud = v3(0, 0, 4000);
    const rampant = v3(0, Math.cos(pente), Math.sin(pente));
    // Barre montante et barre descendante coupées sur le même nœud.
    const montante = barre({ start: v3(0, 0, 0), end: noeud, cutEnd: miterCut(noeud, v3(0, 0, -1), rampant) });
    const descendante = barre({
      start: noeud,
      end: v3(0, 0, 0),
      cutStart: miterCut(noeud, v3(0, 0, -1), rampant),
      cutEnd: squareCut(v3(0, 0, 0), EZ, 1),
    });
    expect(cutAngleDeg(montante, 'end')).toBe(cutAngleDeg(descendante, 'start'));
    expect(cutLengths(montante).max).toBeCloseTo(cutLengths(descendante).max, 6);
  });
});
