import * as THREE from 'three';

/**
 * DISTANCE DE CADRAGE — à quelle distance poser la caméra pour que l'ouvrage
 * tienne ENTIER à l'écran.
 *
 * ⚠ La première version plaçait la caméra à 2,4 fois le rayon du bâtiment,
 * quelle que soit la forme de la vue. Or le champ d'une caméra est fixé en
 * HAUTEUR : dans une case en portrait, le champ horizontal est plus étroit que
 * le vertical, et un long pan de 30 m débordait des deux côtés en vue de face.
 * Le bâtiment paraissait coupé dès qu'on ouvrait la vue sur un écran étroit.
 *
 * On calcule donc, coin par coin de la boîte englobante, la distance qui le fait
 * entrer dans le champ horizontal ET dans le champ vertical, en tenant compte de
 * la perspective : un coin plus proche de la caméra paraît plus grand et demande
 * plus de recul. On garde la plus grande.
 */
export function distanceDeCadrage(
  boite: THREE.Box3,
  /** Direction de la cible vers la caméra. */
  direction: THREE.Vector3,
  /** Haut de l'écran souhaité. */
  haut: THREE.Vector3,
  /** Champ vertical de la caméra (degrés). */
  champVertical: number,
  /** Largeur sur hauteur de la vue. */
  aspect: number,
  marge = 1.08,
): number {
  const centre = boite.getCenter(new THREE.Vector3());
  const versCamera = direction.clone().normalize();

  const tv = Math.tan(THREE.MathUtils.degToRad(champVertical) / 2);
  const th = tv * Math.max(1e-3, aspect);

  /*
   * ⚠ Regard DANS L'AXE du « haut » : l'orientation de l'écran est alors
   * indéterminée, et la caméra en choisira une que ce calcul ne peut pas
   * deviner. Supposer une droite selon X faisait sortir de l'écran les 30 m d'un
   * bâtiment que la caméra avait finalement posés en hauteur. Dans ce cas seul,
   * on cadre le DISQUE qui contient la boîte : valable pour toute rotation.
   */
  let droite = new THREE.Vector3().crossVectors(haut, versCamera);
  const indetermine = droite.lengthSq() < 1e-12;
  if (indetermine) droite = new THREE.Vector3(1, 0, 0);
  droite.normalize();
  const hautEcran = new THREE.Vector3().crossVectors(versCamera, droite).normalize();

  let d = 0;
  for (const x of [boite.min.x, boite.max.x]) {
    for (const y of [boite.min.y, boite.max.y]) {
      for (const z of [boite.min.z, boite.max.z]) {
        const v = new THREE.Vector3(x, y, z).sub(centre);
        const profondeur = v.dot(versCamera); // > 0 : coin du côté de la caméra
        if (indetermine) {
          const rho = Math.hypot(v.dot(droite), v.dot(hautEcran));
          d = Math.max(d, profondeur + rho / Math.min(th, tv));
          continue;
        }
        d = Math.max(
          d,
          profondeur + Math.abs(v.dot(droite)) / th,
          profondeur + Math.abs(v.dot(hautEcran)) / tv,
        );
      }
    }
  }
  return d * marge;
}

/**
 * Le modèle a-t-il changé d'ÉCHELLE au point de sortir du cadre ?
 *
 * ⚠ La vue ne se recadrait qu'au premier affichage : une portée passée de 20 à
 * 40 m laissait la moitié du bâtiment hors champ. Mais recadrer à CHAQUE
 * modification ferait perdre le nœud qu'on examine dès qu'on change une
 * épaisseur de platine. Seul un changement d'emprise notable — taille ou centre
 * déplacés d'un cinquième — déclenche le recadrage.
 */
export function changeDEchelle(avant: THREE.Box3, apres: THREE.Box3, seuil = 0.2): boolean {
  if (avant.isEmpty() || apres.isEmpty()) return false;
  const ta = avant.getSize(new THREE.Vector3()).length();
  const tb = apres.getSize(new THREE.Vector3()).length();
  const deplacement = avant.getCenter(new THREE.Vector3()).distanceTo(apres.getCenter(new THREE.Vector3()));
  return Math.abs(tb - ta) > seuil * ta || deplacement > seuil * ta;
}
