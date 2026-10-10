import * as THREE from 'three';
import type { Vec3 } from '../core/math/vec3';
import type { SteelScene } from './scene';

/**
 * POINTAGE 3D — désigner un point du modèle au pointeur, accroché.
 *
 * ⚠ Une barre posée « à l'œil » dans une vue en perspective n'a aucune chance
 * d'aboutir où l'on croit : rien, sur l'écran, ne dit à quelle profondeur est le
 * pointeur. Le point est donc toujours un point DU MODÈLE — extrémité ou milieu
 * d'une barre, point de travail d'un nœud —, choisi parmi ceux qui se projettent
 * sous le pointeur. C'est l'accrochage aux objets des logiciels de DAO 3D.
 */

export interface PointCible {
  readonly p: Vec3;
  readonly nature: 'extremite' | 'milieu';
}

/** Distance d'accrochage à l'écran (px). */
const RAYON_PX = 14;
/** Un glissé de plus de 4 px fait tourner la vue : ce n'est pas un pointage. */
const GLISSE_PX = 4;

export class Pointage {
  private readonly marqueur: THREE.Mesh;
  private readonly elastique: THREE.Line;
  private cibles: PointCible[] = [];
  private actif = false;
  private depart: THREE.Vector3 | null = null;
  private appui = { x: 0, y: 0 };

  constructor(
    private readonly s: SteelScene,
    private readonly rappels: { onSurvol(c: PointCible | null): void; onPoint(c: PointCible): void },
  ) {
    this.marqueur = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xf0a020, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.marqueur.renderOrder = 10;
    this.marqueur.visible = false;
    this.elastique = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x22a06b, depthTest: false }),
    );
    this.elastique.renderOrder = 10;
    this.elastique.visible = false;
    s.scene.add(this.marqueur, this.elastique);
    const dom = s.renderer.domElement;
    dom.addEventListener('pointermove', this.surDeplacement);
    dom.addEventListener('pointerdown', this.surAppui);
    dom.addEventListener('pointerup', this.surRelache);
  }

  /** Points auxquels on peut s'accrocher : extrémités et milieux des barres. */
  setCibles(barres: readonly { start: Vec3; end: Vec3 }[]): void {
    const vus = new Set<string>();
    const out: PointCible[] = [];
    const pousser = (p: Vec3, nature: PointCible['nature']): void => {
      const cle = `${Math.round(p.x)}|${Math.round(p.y)}|${Math.round(p.z)}`;
      if (vus.has(cle)) return;
      vus.add(cle);
      out.push({ p, nature });
    };
    for (const b of barres) {
      pousser(b.start, 'extremite');
      pousser(b.end, 'extremite');
    }
    for (const b of barres) pousser({ x: (b.start.x + b.end.x) / 2, y: (b.start.y + b.end.y) / 2, z: (b.start.z + b.end.z) / 2 }, 'milieu');
    this.cibles = out;
  }

  /** Active le pointage ; `depart` tire l'élastique depuis un premier point. */
  setActif(actif: boolean, depart: Vec3 | null = null): void {
    this.actif = actif;
    this.depart = depart ? new THREE.Vector3(depart.x, depart.y, depart.z) : null;
    if (!actif) {
      this.marqueur.visible = false;
      this.elastique.visible = false;
    }
  }

  dispose(): void {
    const dom = this.s.renderer.domElement;
    dom.removeEventListener('pointermove', this.surDeplacement);
    dom.removeEventListener('pointerdown', this.surAppui);
    dom.removeEventListener('pointerup', this.surRelache);
    this.s.scene.remove(this.marqueur, this.elastique);
    this.marqueur.geometry.dispose();
    this.elastique.geometry.dispose();
  }

  /** Cible la plus proche du pointeur à l'écran, les plus proches de la caméra d'abord à égalité. */
  private viser(e: PointerEvent): PointCible | null {
    const r = this.s.renderer.domElement.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const cam = this.s.camera;
    const v = new THREE.Vector3();
    let best: PointCible | null = null;
    let dMin = RAYON_PX;
    let profondeur = Infinity;
    for (const c of this.cibles) {
      v.set(c.p.x, c.p.y, c.p.z).project(cam);
      if (v.z < -1 || v.z > 1) continue; // derrière la caméra ou hors champ
      const sx = ((v.x + 1) / 2) * r.width;
      const sy = ((1 - v.y) / 2) * r.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d < dMin - 0.5 || (Math.abs(d - dMin) <= 0.5 && v.z < profondeur)) {
        dMin = d;
        profondeur = v.z;
        best = c;
      }
    }
    return best;
  }

  private readonly surDeplacement = (e: PointerEvent): void => {
    if (!this.actif) return;
    const c = this.viser(e);
    this.marqueur.visible = c !== null;
    if (c) {
      this.marqueur.position.set(c.p.x, c.p.y, c.p.z);
      // Taille constante à l'écran : proportionnelle à la distance de la caméra.
      this.marqueur.scale.setScalar(this.s.camera.position.distanceTo(this.marqueur.position) * 0.006);
    }
    if (this.depart && c) {
      this.elastique.geometry.setFromPoints([this.depart, new THREE.Vector3(c.p.x, c.p.y, c.p.z)]);
      this.elastique.visible = true;
    } else this.elastique.visible = false;
    this.rappels.onSurvol(c);
  };

  private readonly surAppui = (e: PointerEvent): void => {
    this.appui = { x: e.clientX, y: e.clientY };
  };

  private readonly surRelache = (e: PointerEvent): void => {
    if (!this.actif || e.button !== 0) return;
    if (Math.hypot(e.clientX - this.appui.x, e.clientY - this.appui.y) > GLISSE_PX) return;
    const c = this.viser(e);
    if (c) this.rappels.onPoint(c);
  };
}
