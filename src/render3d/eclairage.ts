import * as THREE from 'three';

/**
 * ÉCLAIRAGE ET ENVIRONNEMENT.
 *
 * Séparé de la scène parce que c'est un sujet en soi : ce qui fait qu'un acier
 * ressemble à de l'acier tient entièrement ici, et n'a rien à voir avec la
 * gestion des pièces, de la sélection ou des coupes.
 */

export interface Eclairage {
  readonly soleil: THREE.DirectionalLight;
  /** Plan invisible ne servant qu'à recevoir les ombres. */
  readonly sol: THREE.Mesh;
}

/**
 * Installe l'éclairage complet d'une scène et renvoie ce qu'il faut piloter.
 *
 * ⚠ Un métal ne s'éclaire pas, il REFLÈTE. Une lumière directionnelle seule rend
 * une pièce d'acier uniformément grise et plate ; ce qui lui donne sa matière,
 * c'est l'environnement qu'elle renvoie.
 */
export function installerEclairage(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): Eclairage {
  scene.environment = environnementAcier(renderer);
  scene.environmentIntensity = 1.35;

  scene.add(new THREE.HemisphereLight(0xdfe7f2, 0x4a5158, 0.9));

  const soleil = new THREE.DirectionalLight(0xfff4e6, 2.9);
  soleil.position.set(-18_000, -26_000, 34_000);
  soleil.castShadow = true;
  soleil.shadow.mapSize.set(2048, 2048);
  soleil.shadow.bias = -0.0006;
  soleil.shadow.normalBias = 12;
  scene.add(soleil, soleil.target);

  const appoint = new THREE.DirectionalLight(0xdbe4f0, 0.45);
  appoint.position.set(22_000, 16_000, 6_000);
  scene.add(appoint);

  // Sol : invisible en lui-même, il ne sert qu'à recevoir les ombres — c'est le
  // contact au sol qui donne l'échelle du bâtiment.
  const sol = new THREE.Mesh(
    new THREE.PlaneGeometry(400_000, 400_000),
    new THREE.ShadowMaterial({ opacity: 0.26 }),
  );
  sol.receiveShadow = true;
  scene.add(sol);

  return { soleil, sol };
}

/**
 * Recentre le soleil et sa carte d'ombres sur le bâtiment.
 *
 * Une carte d'ombres a une étendue finie : réglée une fois pour toutes, elle
 * laisserait un hangar de dix travées sans ombre sur la moitié de sa longueur.
 */
export function cadrerOmbres(e: Eclairage, boite: THREE.Box3): void {
  if (boite.isEmpty()) return;
  const centre = boite.getCenter(new THREE.Vector3());
  const rayon = boite.getBoundingSphere(new THREE.Sphere()).radius || 10_000;

  e.soleil.target.position.copy(centre);
  e.soleil.position
    .copy(centre)
    .add(new THREE.Vector3(-0.55, -0.75, 1.1).multiplyScalar(rayon * 1.8));

  const cam = e.soleil.shadow.camera;
  cam.left = -rayon * 1.25;
  cam.right = rayon * 1.25;
  cam.top = rayon * 1.25;
  cam.bottom = -rayon * 1.25;
  cam.near = rayon * 0.2;
  cam.far = rayon * 5;
  cam.updateProjectionMatrix();

  e.sol.position.z = boite.min.z - 1;
}

/* ------------------------------------------------------------------ */
/* Environnement                                                       */
/* ------------------------------------------------------------------ */

/**
 * Carte d'environnement fabriquée à la volée : ciel clair, horizon, sol sombre,
 * et une tache lumineuse tenant lieu de soleil.
 *
 * ⚠ Aucune image n'est embarquée. Un fichier HDR pèserait quelques mégaoctets
 * pour une application qui doit rester locale et ouvrable hors ligne, alors
 * qu'un dégradé suffit : ce qu'on demande à cette carte, c'est de donner à
 * l'acier quelque chose à refléter, pas de représenter un lieu.
 */
function environnementAcier(renderer: THREE.WebGLRenderer): THREE.Texture {
  const L = 256;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = L;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();

  // Dégradé vertical : le zénith en haut, le nadir en bas.
  const ciel = ctx.createLinearGradient(0, 0, 0, H);
  ciel.addColorStop(0, '#e8f0fb');
  ciel.addColorStop(0.44, '#b9c8dc');
  ciel.addColorStop(0.5, '#8e9aa8'); // ligne d'horizon
  ciel.addColorStop(0.56, '#4a5058');
  ciel.addColorStop(1, '#23272c');
  ctx.fillStyle = ciel;
  ctx.fillRect(0, 0, L, H);

  // Tache solaire : c'est elle qui allume les arêtes et fait lire le galbe des
  // congés. Sans elle, l'acier reste uniformément gris.
  const soleil = ctx.createRadialGradient(L * 0.28, H * 0.2, 0, L * 0.28, H * 0.2, H * 0.38);
  soleil.addColorStop(0, 'rgba(255,252,240,1)');
  soleil.addColorStop(0.35, 'rgba(255,246,225,0.45)');
  soleil.addColorStop(1, 'rgba(255,246,225,0)');
  ctx.fillStyle = soleil;
  ctx.fillRect(0, 0, L, H);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
  texture.dispose();
  return env;
}

/**
 * Grille du sol, dans le plan Z = 0 du bâtiment.
 *
 * ⚠ UNE seule fabrique, employée à la création de la scène comme à chaque
 * changement de thème. Une grille de Three.js porte ses couleurs dans sa
 * géométrie : on ne la recolore pas, on la refait — et deux endroits qui la
 * refont, c'est un jour une grille d'une autre taille selon qu'on vient
 * d'ouvrir la vue ou de basculer le thème.
 */
export function creerGrille(majeure: THREE.ColorRepresentation, mineure: THREE.ColorRepresentation): THREE.GridHelper {
  const g = new THREE.GridHelper(60_000, 60, majeure, mineure);
  g.rotation.x = Math.PI / 2; // GridHelper est horizontal en Y ; notre sol est en Z
  return g;
}
