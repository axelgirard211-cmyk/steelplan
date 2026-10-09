import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { changeDEchelle, distanceDeCadrage } from '../cadrage';

/** Hangar par défaut : 30 m de long, 20 m de portée, 7 m au faîtage. */
const HANGAR = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30_000, 20_000, 7_000));
const HAUT = new THREE.Vector3(0, 0, 1);
const FOV = 45;

/**
 * Coordonnées écran normalisées (−1 à 1) de chaque coin, caméra posée à la
 * distance calculée. C'est la propriété elle-même qu'on vérifie — l'ouvrage
 * entier à l'écran —, pas la formule qui la produit.
 */
function coinsALEcran(direction: THREE.Vector3, aspect: number): THREE.Vector3[] {
  const dir = direction.clone().normalize();
  const d = distanceDeCadrage(HANGAR, dir, HAUT, FOV, aspect);
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 10, 1e7);
  camera.up.copy(HAUT);
  const centre = HANGAR.getCenter(new THREE.Vector3());
  camera.position.copy(centre).addScaledVector(dir, d);
  camera.lookAt(centre);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const out: THREE.Vector3[] = [];
  for (const x of [HANGAR.min.x, HANGAR.max.x])
    for (const y of [HANGAR.min.y, HANGAR.max.y])
      for (const z of [HANGAR.min.z, HANGAR.max.z]) out.push(new THREE.Vector3(x, y, z).project(camera));
  return out;
}

const VUES: Record<string, THREE.Vector3> = {
  iso: new THREE.Vector3(0.8, -0.8, 0.6),
  face: new THREE.Vector3(0, -1, 0),
  cote: new THREE.Vector3(-1, 0, 0),
  // Celle de l'application : légèrement inclinée, pour une orientation de plan.
  dessus: new THREE.Vector3(0, -1e-3, 1),
  // Et le cas indéterminé, à la verticale exacte : il doit rester sûr.
  verticale: new THREE.Vector3(0, 0, 1),
};

describe('distance de cadrage', () => {
  it('fait tenir tout l’ouvrage à l’écran, quelle que soit la vue et la forme de la case', () => {
    /*
     * ⚠ Le cas qui a révélé le défaut : vue de FACE dans une case en PORTRAIT.
     * À 2,4 rayons de recul, le long pan de 30 m sortait des deux côtés. On
     * balaie ici des cases du portrait étroit au paysage large.
     */
    for (const [nom, dir] of Object.entries(VUES)) {
      for (const aspect of [0.5, 0.78, 1, 1.6, 2.4]) {
        for (const q of coinsALEcran(dir, aspect)) {
          expect(Math.abs(q.x), `${nom} à ${aspect} : x`).toBeLessThanOrEqual(1);
          expect(Math.abs(q.y), `${nom} à ${aspect} : y`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('recule davantage dans une case en portrait que dans une case en paysage', () => {
    const face = VUES['face'] as THREE.Vector3;
    expect(distanceDeCadrage(HANGAR, face, HAUT, FOV, 0.78)).toBeGreaterThan(
      distanceDeCadrage(HANGAR, face, HAUT, FOV, 1.6),
    );
  });

  it('ne gaspille pas l’écran : l’ouvrage occupe la plus grande des deux dimensions', () => {
    /*
     * Un recul trop prudent — un rayon de sphère englobante, par exemple —
     * tiendrait aussi à l'écran, mais en vignette. La marge de 8 % laisse
     * l'ouvrage occuper plus de 85 % de la dimension qui le contraint.
     */
    for (const [nom, dir] of Object.entries(VUES)) {
      // La verticale exacte est PRUDENTE par construction : son orientation
      // d'écran est indéterminée, elle cadre le disque qui contient la boîte.
      // Son contrat est de tenir à l'écran, pas de le remplir.
      if (nom === 'verticale') continue;
      const pts = coinsALEcran(dir, 1.6);
      const occupe = Math.max(
        Math.max(...pts.map((q) => Math.abs(q.x))),
        Math.max(...pts.map((q) => Math.abs(q.y))),
      );
      expect(occupe, nom).toBeGreaterThan(0.85);
    }
  });
});

describe('recadrage après modification', () => {
  const boite = (l: number, b: number, h: number, x0 = 0): THREE.Box3 =>
    new THREE.Box3(new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x0 + l, b, h));

  it('recadre quand la portée double : le bâtiment sortirait du champ', () => {
    expect(changeDEchelle(HANGAR, boite(30_000, 40_000, 9_000))).toBe(true);
    expect(changeDEchelle(HANGAR, boite(10_000, 8_000, 5_000))).toBe(true);
  });

  it('recadre quand l’ouvrage se déplace d’un cinquième de sa taille', () => {
    expect(changeDEchelle(HANGAR, boite(30_000, 20_000, 7_000, 12_000))).toBe(true);
  });

  it('ne recadre PAS pour une retouche : on garderait le nœud qu’on examine', () => {
    // Une platine plus épaisse, un débord de 300 mm : l'emprise bouge à peine.
    expect(changeDEchelle(HANGAR, HANGAR.clone())).toBe(false);
    expect(changeDEchelle(HANGAR, boite(30_600, 20_000, 7_100, -300))).toBe(false);
  });

  it('ne décide rien sur un modèle vide', () => {
    expect(changeDEchelle(new THREE.Box3(), HANGAR)).toBe(false);
  });
});
