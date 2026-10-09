import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getProfile } from '../core/catalog/index';
import type { StructuralModel } from '../core/build/types';
import { changeDEchelle, distanceDeCadrage } from './cadrage';
import { Jauge } from './jauge';
import { cadrerOmbres, creerGrille, installerEclairage, type Eclairage } from './eclairage';
import { creerBoulons, creerCordons, creerPiece } from './pieces';
import { filtrerBoulonnerie, libererAssemblages, remplacerCordons } from './pieces';
import {
  COULEUR_SELECTION,
  COULEUR_TOLE,
  ROLE_COLORS,
  ACIER_PEINT,
  couleurDeBarre,
  ACIER_TOLE,
  matiereDeRole,
  type ColorMode,
  type Matiere,
} from './colorMaps';
import { haunchGeometry, memberGeometry, plateGeometry } from './meshFactory';

/** Vues normalisées du dessinateur. */
export type StandardView = 'iso' | 'face' | 'cote' | 'dessus' | 'arriere';

/** Coupe dynamique : un plan qui rabote la scène pour voir l'intérieur. */
export interface ClipConfig {
  readonly axis: 'x' | 'y' | 'z';
  /** Position du plan en mm dans le repère du modèle. */
  readonly position: number;
  readonly flipped: boolean;
}

export interface SceneOptions {
  onSelect(id: string | null): void;
  onMeasure(distance: number | null): void;
  onHover(id: string | null): void;
}

interface Piece {
  readonly id: string;
  readonly mesh: THREE.Mesh;
  readonly edges: THREE.LineSegments;
  readonly baseColor: number;
}

/**
 * Scène 3D impérative.
 *
 * Volontairement hors de React : la scène est REGÉNÉRÉE depuis le modèle à
 * chaque changement de paramètre, et faire passer 2 000 maillages par la
 * réconciliation de React coûterait plus cher que de les reconstruire.
 * React ne fait qu'instancier cette classe et lui pousser des ordres.
 */
export class SteelScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly racine = new THREE.Group();
  private grille: THREE.GridHelper;
  private readonly raycaster = new THREE.Raycaster();
  private readonly observateur: ResizeObserver;
  private readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  // Le rappel est différé : `options` n'est lu qu'au moment d'une mesure.
  private readonly jauge = new Jauge((d) => this.options.onMeasure(d));
  private readonly eclairage: Eclairage;
  /** Boulonnerie, instanciée : trois appels de dessin pour tout le bâtiment. */
  private boulons: THREE.InstancedMesh[] = [];
  /** Cordons de soudure : un seul maillage pour tout le bâtiment. */
  private cordons: THREE.Mesh | null = null;
  /** Modèle affiché, et cordons restreints ou non aux pièces visibles. */
  private modele: StructuralModel | null = null;
  private cordonsFiltres = false;

  private pieces: Piece[] = [];
  private colorMode: ColorMode = 'realiste';
  /** Taux de travail par repère, pour le mode de coloration « taux ». */
  private taux: ReadonlyMap<string, number> | null = null;
  private selection: string | null = null;
  private survol: string | null = null;
  private masques = new Set<string>();
  private isole: ReadonlySet<string> | null = null;
  private modeMesure = false;
  private boite = new THREE.Box3();
  private anime = 0;
  /** Le cadrage initial appartient à la scène, pas au composant qui l'affiche :
   *  React peut la monter, la démonter et la remonter sans qu'on perde la vue. */
  private cadre = false;
  /**
   * Vue normalisée affichée, tant que l'utilisateur n'a pas bougé la caméra.
   * Elle est REFAITE quand la case change de forme : sans cela, un bâtiment
   * cadré dans une fenêtre large se retrouvait coupé dès qu'on la rétrécissait.
   */
  private vueCourante: StandardView | null = null;

  constructor(
    private readonly conteneur: HTMLElement,
    private readonly options: SceneOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.localClippingEnabled = true;
    /*
     * ⚠ Trois réglages, sans lesquels aucun matériau métallique ne peut être
     * crédible :
     *  - l'espace colorimétrique de sortie, faute de quoi tout est délavé ;
     *  - une courbe de rendu, ici ACES, qui empêche les reflets de saturer en
     *    aplats blancs — c'est ce qui distingue de l'acier d'un plastique clair ;
     *  - des ombres douces : sans elles, rien ne dit où une pièce en touche une
     *    autre, et l'assemblage devient illisible.
     */
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    conteneur.appendChild(this.renderer.domElement);

    // Repère du bâtiment : Z vers le haut, comme sur les plans.
    this.camera = new THREE.PerspectiveCamera(45, 1, 100, 500_000);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    // Dès que l'utilisateur oriente la vue lui-même, on cesse de la recadrer.
    this.controls.addEventListener('start', () => {
      this.vueCourante = null;
    });

    this.eclairage = installerEclairage(this.scene, this.renderer);

    // Teinte provisoire : le panneau la remplace aussitôt par celle du thème.
    this.grille = creerGrille(0x6b737d, 0x3c424a);
    this.scene.add(this.grille);
    this.scene.add(this.racine);
    this.scene.add(this.jauge.groupe);

    this.observateur = new ResizeObserver(() => this.redimensionner());
    this.observateur.observe(conteneur);
    this.redimensionner();

    this.renderer.domElement.addEventListener('pointerdown', this.surClic);
    this.renderer.domElement.addEventListener('dblclick', this.surDoubleClic);
    this.renderer.domElement.addEventListener('pointermove', this.surDeplacement);

    const boucle = (): void => {
      this.anime = requestAnimationFrame(boucle);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    boucle();
  }

  /* ---------------- Modèle ---------------- */

  setModel(model: StructuralModel): void {
    this.viderPieces();
    const reel = this.colorMode === 'realiste';

    for (const m of model.members) {
      const g = memberGeometry(m);
      const mat = reel ? matiereDeRole(m.role) : null;
      this.ajouter(m.id, g, couleurDeBarre(this.colorMode, m.role, m.profileId, m.mark, this.taux), mat);
    }
    for (const h of model.haunches) {
      const hauteur = getProfile(h.profileId).h;
      const g = haunchGeometry(h, hauteur);
      if (g.getAttribute('position')) {
        this.ajouter(h.id, g, ROLE_COLORS.jarret, reel ? ACIER_PEINT : null);
      }
    }
    for (const pl of model.plates) {
      this.ajouter(pl.id, plateGeometry(pl), COULEUR_TOLE, reel ? ACIER_TOLE : null);
    }

    this.boulons = creerBoulons(model);
    for (const b of this.boulons) this.racine.add(b);
    this.cordons = creerCordons(model);
    if (this.cordons) this.racine.add(this.cordons);
    this.modele = model;
    this.cordonsFiltres = false;

    const avant = this.boite.clone();
    this.boite = new THREE.Box3().setFromObject(this.racine);
    cadrerOmbres(this.eclairage, this.boite);
    this.appliquerVisibilite();
    if (!this.cadre && !this.boite.isEmpty()) {
      this.recadrer();
      this.cadre = true;
    } else if (changeDEchelle(avant, this.boite)) {
      // Recadré sur le nouvel ouvrage, sous le même angle de vue.
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.cadrerSurPoint(this.boite.getCenter(new THREE.Vector3()), distanceDeCadrage(this.boite, dir, this.camera.up, this.camera.fov, this.camera.aspect));
    }
  }

  /** Fabrique la pièce, l'ajoute à la scène et la retient pour son cycle de vie. */
  private ajouter(
    id: string,
    g: THREE.BufferGeometry,
    couleur: number,
    matiere: Matiere | null,
  ): void {
    const { mesh, edges, baseColor } = creerPiece(id, g, couleur, matiere);
    this.racine.add(mesh, edges);
    this.pieces.push({ id, mesh, edges, baseColor });
  }

  private viderPieces(): void {
    for (const p of this.pieces) {
      this.racine.remove(p.mesh, p.edges);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
      p.edges.geometry.dispose();
      (p.edges.material as THREE.Material).dispose();
    }
    this.pieces = [];

    libererAssemblages(this.racine, this.boulons, this.cordons);
    this.boulons = [];
    this.cordons = null;
  }

  /* ---------------- Affichage ---------------- */

  setColorMode(
    mode: ColorMode,
    model: StructuralModel,
    taux: ReadonlyMap<string, number> | null = null,
  ): void {
    this.colorMode = mode;
    this.taux = taux;
    this.setModel(model);
  }

  setHidden(ids: ReadonlySet<string>): void {
    this.masques = new Set(ids);
    this.appliquerVisibilite();
  }

  setIsolated(ids: ReadonlySet<string> | null): void {
    this.isole = ids;
    this.appliquerVisibilite();
  }

  setSelected(id: string | null): void {
    this.selection = id;
    this.appliquerCouleurs();
  }

  setGridVisible(visible: boolean): void {
    this.grille.visible = visible;
  }

  /**
   * Reteint la grille du sol selon le thème. Les couleurs viennent des jetons
   * CSS, et non d'une seconde table ici : le thème ne se définit qu'à un endroit.
   */
  teinterGrille(majeure: string, mineure: string): void {
    const visible = this.grille.visible;
    this.scene.remove(this.grille);
    this.grille.geometry.dispose();
    (this.grille.material as THREE.Material).dispose();
    this.grille = creerGrille(majeure, mineure);
    this.grille.visible = visible;
    this.scene.add(this.grille);
  }

  setEdgesVisible(visible: boolean): void {
    for (const p of this.pieces) p.edges.userData['cache'] = !visible;
    this.appliquerVisibilite();
  }

  private appliquerVisibilite(): void {
    const visibles = new Set<string>();
    for (const p of this.pieces) {
      const visible = !this.masques.has(p.id) && (this.isole === null || this.isole.has(p.id));
      p.mesh.visible = visible;
      p.edges.visible = visible && p.edges.userData['cache'] !== true;
      if (visible) visibles.add(p.id);
    }
    // Boulons et cordons suivent les pièces qu'ils assemblent.
    const filtre = visibles.size === this.pieces.length ? null : visibles;
    filtrerBoulonnerie(this.boulons, filtre);
    if (this.modele && (filtre !== null || this.cordonsFiltres)) {
      this.cordons = remplacerCordons(this.racine, this.cordons, this.modele, filtre);
      this.cordonsFiltres = filtre !== null;
    }
    this.appliquerCouleurs();
  }

  private appliquerCouleurs(): void {
    for (const p of this.pieces) {
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      const actif = p.id === this.selection;
      mat.color.setHex(actif ? COULEUR_SELECTION : p.baseColor);
      mat.emissive.setHex(p.id === this.survol && !actif ? 0x222a33 : 0x000000);
    }
  }

  /* ---------------- Coupe dynamique ---------------- */

  setClip(config: ClipConfig | null): void {
    const plans: THREE.Plane[] = [];
    if (config) {
      const n = new THREE.Vector3(
        config.axis === 'x' ? 1 : 0,
        config.axis === 'y' ? 1 : 0,
        config.axis === 'z' ? 1 : 0,
      );
      if (!config.flipped) n.negate();
      this.clipPlane.normal.copy(n);
      this.clipPlane.constant = config.flipped ? -config.position : config.position;
      plans.push(this.clipPlane);
    }
    for (const p of this.pieces) {
      (p.mesh.material as THREE.MeshStandardMaterial).clippingPlanes = plans;
      (p.edges.material as THREE.LineBasicMaterial).clippingPlanes = plans;
    }
    // La boulonnerie se coupe avec le reste : un boulon qui flotterait devant
    // une coupe donnerait une section fausse.
    for (const b of this.boulons) {
      (b.material as THREE.MeshStandardMaterial).clippingPlanes = plans;
    }
    if (this.cordons) {
      (this.cordons.material as THREE.MeshStandardMaterial).clippingPlanes = plans;
    }
  }

  /** Étendue du modèle selon un axe, pour borner le curseur de coupe. */
  extent(axis: 'x' | 'y' | 'z'): { min: number; max: number } {
    if (this.boite.isEmpty()) return { min: 0, max: 1 };
    return { min: this.boite.min[axis], max: this.boite.max[axis] };
  }

  /* ---------------- Vues et cadrage ---------------- */

  setView(vue: StandardView): void {
    const c = this.boite.isEmpty() ? new THREE.Vector3() : this.boite.getCenter(new THREE.Vector3());
    const directions: Record<StandardView, [number, number, number]> = {
      iso: [0.8, -0.8, 0.6],
      face: [0, -1, 0],
      arriere: [0, 1, 0],
      cote: [-1, 0, 0],
      /*
       * Une ombre d'inclinaison vers le sud : regarder EXACTEMENT à la verticale
       * laisse l'orientation de l'écran au hasard du moteur. Ainsi la vue de
       * dessus se lit comme la vue en plan du dossier — X à droite, Y en haut.
       */
      dessus: [0, -1e-3, 1],
    };
    const dir = new THREE.Vector3(...directions[vue]).normalize();
    // Recul calculé pour que la boîte tienne en largeur ET en hauteur.
    const d = this.boite.isEmpty()
      ? 24_000
      : distanceDeCadrage(this.boite, dir, this.camera.up, this.camera.fov, this.camera.aspect);
    this.camera.position.copy(c).addScaledVector(dir, d);
    this.controls.target.copy(c);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.vueCourante = vue;
  }

  recadrer(): void {
    this.setView('iso');
  }

  /**
   * Cadre la vue sur une pièce, assez près pour lire son assemblage.
   *
   * ⚠ Sans cela, un nœud de portique est inatteignable : il faut viser à la
   * molette une jonction large de trente centimètres dans un bâtiment de trente
   * mètres, et on passe à côté vingt fois de suite. C'est précisément à ces
   * endroits — genou, faîtage, pied de poteau — qu'on a besoin de voir comment
   * les pièces tiennent ensemble.
   */
  cadrerSur(id: string): boolean {
    const piece = this.pieces.find((x) => x.id === id);
    if (!piece) return false;

    const boite = new THREE.Box3().setFromObject(piece.mesh);
    if (boite.isEmpty()) return false;
    const centre = boite.getCenter(new THREE.Vector3());

    // Une barre de dix mètres cadrée sur toute sa longueur ne montre rien de son
    // assemblage : on borne la distance pour rester à l'échelle d'un nœud.
    const taille = boite.getSize(new THREE.Vector3()).length();
    const distance = Math.min(Math.max(taille * 1.4, 900), 6000);

    this.cadrerSurPoint(centre, distance);
    return true;
  }

  /** Amène la vue à `distance` d'un point, sans changer l'angle de vue. */
  cadrerSurPoint(point: THREE.Vector3, distance: number): void {
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(point);
    this.camera.position.copy(point).addScaledVector(direction, distance);
    this.controls.update();
  }

  private rayon(): number {
    if (this.boite.isEmpty()) return 10_000;
    return Math.max(1000, this.boite.getSize(new THREE.Vector3()).length() / 2);
  }

  /* ---------------- Mesure ---------------- */

  setMeasureMode(actif: boolean): void {
    this.modeMesure = actif;
    if (!actif) this.jauge.effacer();
  }

  /* ---------------- Interaction ---------------- */

  private pointeur(e: MouseEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
  }

  private toucher(e: MouseEvent): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.pointeur(e), this.camera);
    const cibles = this.pieces.filter((p) => p.mesh.visible).map((p) => p.mesh);
    return this.raycaster.intersectObjects(cibles, false)[0] ?? null;
  }

  private depart = { x: 0, y: 0 };

  private readonly surClic = (e: PointerEvent): void => {
    this.depart = { x: e.clientX, y: e.clientY };
    const fin = (up: PointerEvent): void => {
      this.renderer.domElement.removeEventListener('pointerup', fin);
      // Un glissé fait tourner la scène : ce n'est pas une sélection.
      if (Math.hypot(up.clientX - this.depart.x, up.clientY - this.depart.y) > 4) return;
      const t = this.toucher(up);
      if (this.modeMesure) {
        if (t) this.jauge.ajouter(t.point, this.rayon() / 120);
        return;
      }
      this.options.onSelect(t ? (t.object.userData['id'] as string) : null);
    };
    this.renderer.domElement.addEventListener('pointerup', fin);
  };

  /**
   * Double-clic : on cadre sur le POINT visé, pas sur la pièce.
   *
   * ⚠ La différence est décisive. Cadrer une panne de six mètres place la vue à
   * six mètres, et une tête de boulon y fait deux pixels — on a donc « cadré sur
   * la pièce » sans rien pouvoir en lire. Ce qu'on veut voir, c'est le NŒUD : il
   * est sous le curseur, et à un mètre on distingue les boulons, les pinces et
   * l'ordre d'empilage des tôles.
   */
  private readonly surDoubleClic = (e: MouseEvent): void => {
    const t = this.toucher(e);
    if (!t) return;
    const id = t.object.userData['id'] as string | undefined;
    if (id) this.options.onSelect(id);
    this.cadrerSurPoint(t.point, 1200);
  };

  private readonly surDeplacement = (e: PointerEvent): void => {
    const t = this.toucher(e);
    const id = t ? (t.object.userData['id'] as string) : null;
    if (id === this.survol) return;
    this.survol = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : 'default';
    this.appliquerCouleurs();
    this.options.onHover(id);
  };

  private redimensionner(): void {
    const { clientWidth: w, clientHeight: h } = this.conteneur;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.vueCourante) this.setView(this.vueCourante);
  }

  dispose(): void {
    cancelAnimationFrame(this.anime);
    this.observateur.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.surClic);
    this.renderer.domElement.removeEventListener('dblclick', this.surDoubleClic);
    this.renderer.domElement.removeEventListener('pointermove', this.surDeplacement);
    this.jauge.effacer();
    this.viderPieces();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
