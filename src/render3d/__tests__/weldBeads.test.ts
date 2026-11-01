import { describe, expect, it } from 'vitest';
import { buildProject } from '../../core/build/buildProject';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import { TEMPLATES } from '../../core/model/templates';
import { weldBeadGeometry } from '../weldBeads';
import { contourJarret } from '../../core/build/jarret';
import type { Vec3 } from '../../core/math/vec3';

/**
 * CORDONS DE SOUDURE EN 3D.
 *
 * Le maillage est reconstruit à partir des soudures du modèle, sans donnée
 * ajoutée : ces contrôles vérifient qu'il reste fidèle à ce que la nomenclature
 * de soudure annonce, et qu'il ne produit pas de géométrie aberrante.
 */

const P = DEFAULT_PROJECT;
const model = buildProject(P);

/*
 * ⚠ RAPIDITÉ. Le maillage compte des centaines de milliers de coordonnées ; un
 * `expect` par coordonnée coûtait plus que le maillage lui-même. Chaque
 * coordonnée est toujours contrôlée, mais on ne rapporte que la PREMIÈRE
 * fautive, avec son rang — ce qui suffit à la retrouver. Le maillage du projet
 * par défaut est construit une fois et partagé.
 */
/** Rang de la première coordonnée non finie, −1 s'il n'y en a pas. */
function premiereNonFinie(c: Float32Array): number {
  for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i] as number)) return i;
  return -1;
}

function coordonnees(g: ReturnType<typeof weldBeadGeometry>): Float32Array {
  const attr = g?.getAttribute('position');
  return (attr?.array as Float32Array) ?? new Float32Array();
}

const g = weldBeadGeometry(model);

describe('maillage des cordons', () => {

  it('existe dès que le modèle porte des soudures', () => {
    expect(model.welds.length).toBeGreaterThan(0);
    expect(g).not.toBeNull();
    expect(coordonnees(g).length).toBeGreaterThan(0);
  });

  it('porte une normale par sommet', () => {
    const pos = g?.getAttribute('position');
    const nor = g?.getAttribute('normal');
    expect(nor?.count).toBe(pos?.count);
  });

  it('ne produit aucune coordonnée non finie', () => {
    const c = coordonnees(g);
    const i = premiereNonFinie(c);
    expect(i, `coordonnée ${i} : ${c[i]}`).toBe(-1);
  });

  it('reste dans l’emprise du bâtiment', () => {
    // Un cordon hors du bâtiment signalerait une tôle rattachée au mauvais about.
    const c = coordonnees(g);
    const marge = 600;
    const zMax = P.grid.eaveHeight + 3000 + marge;
    let hors = -1;
    for (let i = 0; i < c.length && hors < 0; i += 3) {
      const z = c[i + 2] as number;
      // Écrit à l'envers pour qu'un NaN soit lui aussi « hors ».
      if (!(z > -marge && z < zMax)) hors = i;
    }
    expect(hors, `sommet ${hors / 3} à z = ${c[hors + 2]}`).toBe(-1);
    expect(c.length).toBeGreaterThan(0);
  });

  it('se dépose au contact des pièces qu’il assemble, non au milieu des barres', () => {
    /*
     * ⚠ Le cordon d'une tôle fait le tour de la section À L'ABOUT où elle se
     * trouve : se tromper d'about le poserait six mètres plus loin, en plein
     * milieu de rien. Ceux des jarrets courent le long de leur âme, ceux des
     * échantignolles au pied de leur aile. Chaque sommet du maillage doit donc
     * être près d'une tôle, d'un jarret ou d'une échantignolle.
     */
    const c = coordonnees(g);
    const toles = model.plates.map((pl) => pl.origin);
    const jarrets = model.haunches.map((h) => contourJarret(h));
    const attaches = model.members
      .filter((m) => m.role === 'attache' || m.role === 'equerre')
      .map((m) => ({ x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2, z: (m.start.z + m.end.z) / 2 }));
    const d = (a: Vec3, x: number, y: number, z: number): number => Math.hypot(a.x - x, a.y - y, a.z - z);
    const surSegment = (a: Vec3, b: Vec3, x: number, y: number, z: number): number => {
      const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const l2 = ab.x ** 2 + ab.y ** 2 + ab.z ** 2;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ab.x + (y - a.y) * ab.y + (z - a.z) * ab.z) / l2));
      return d({ x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t }, x, y, z);
    };
    let verifies = 0;
    for (let i = 0; i < c.length; i += 3 * 50) {
      const x = c[i] as number;
      const y = c[i + 1] as number;
      const z = c[i + 2] as number;
      const proche =
        toles.some((o) => d(o, x, y, z) < 900) ||
        jarrets.some((j) => surSegment(j.haut, j.pointe, x, y, z) < 50) ||
        attaches.some((a) => d(a, x, y, z) < 150);
      expect(proche, `sommet (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`).toBe(true);
      verifies += 1;
    }
    expect(verifies).toBeGreaterThan(10);
  });

  it('a une section à l’échelle de la gorge, non du profil', () => {
    // Le cordon d'une platine de pied sur IPE 400 mesure quelques millimètres de
    // côté : s'il en faisait des dizaines, c'est que la gorge aurait été
    // confondue avec une dimension de la section.
    const gorges = model.welds.map((w) => w.throat);
    expect(Math.max(...gorges)).toBeLessThan(20);
    expect(Math.min(...gorges)).toBeGreaterThanOrEqual(3);
  });
});

describe('robustesse', () => {
  it('rend null quand il n’y a rien à souder', () => {
    const sansToles = { ...model, plates: [], welds: [] };
    expect(weldBeadGeometry(sansToles)).toBeNull();
  });

  it('tient sur tous les gabarits, treillis compris', () => {
    for (const t of TEMPLATES) {
      const m = buildProject(t.build());
      const g = weldBeadGeometry(m);
      if (m.welds.length === 0) continue;
      expect(g, t.id).not.toBeNull();
      const c = coordonnees(g);
      const i = premiereNonFinie(c);
      expect(i, `${t.id} : coordonnée ${i} : ${c[i]}`).toBe(-1);
    }
  });

  it('couvre chaque soudure du modèle', () => {
    // Autant de cordons tracés que de cordons au modèle : aucun n'est
    // silencieusement ignoré parce que sa nature ne serait pas prévue — c'était
    // le cas des jarrets et des échantignolles, devenus soudés.
    expect(new Set(g?.userData.cordons as string[])).toEqual(new Set(model.welds.map((w) => w.id)));
  });
});
