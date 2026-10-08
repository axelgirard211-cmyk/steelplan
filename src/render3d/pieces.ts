import * as THREE from 'three';
import { diametreNominal, listerBoulons, percagesDesBarres } from '../core/build/bolts';
import type { StructuralModel } from '../core/build/types';
import { ACIER_BOULON, type Matiere } from './colorMaps';
import { boltMatrices, boltPartGeometries, edgesOf, matriceDePercage, percageGeometry } from './meshFactory';
import { weldBeadGeometry } from './weldBeads';

/**
 * FABRIQUES DE MAILLAGES.
 *
 * Séparées de la scène : elles ne font que transformer des données du modèle en
 * objets `three`, sans rien connaître de la sélection, des masquages ni des
 * coupes. La scène, elle, ne s'occupe plus que du cycle de vie.
 */

export interface PieceMaillee {
  readonly mesh: THREE.Mesh;
  readonly edges: THREE.LineSegments;
  readonly baseColor: number;
}

/**
 * Maillage d'une pièce et ses arêtes.
 *
 * En mode réaliste, la MATIÈRE prime sur la couleur de rôle : c'est elle qui
 * fait la différence entre de l'acier et du plastique teinté. Dans les modes de
 * lecture (rôle, profil, taux), on garde une surface mate et peu réfléchissante,
 * pour que la couleur reste franche et comparable d'une pièce à l'autre — un
 * reflet fausserait la lecture d'un code couleur.
 */
export function creerPiece(
  id: string,
  g: THREE.BufferGeometry,
  couleur: number,
  matiere: Matiere | null,
): PieceMaillee {
  const materiau = new THREE.MeshStandardMaterial({
    color: matiere ? matiere.couleur : couleur,
    metalness: matiere ? matiere.metalness : 0.1,
    roughness: matiere ? matiere.roughness : 0.75,
    clippingPlanes: [],
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, materiau);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData['id'] = id;

  const edges = new THREE.LineSegments(
    edgesOf(g),
    new THREE.LineBasicMaterial({
      color: 0x11151a,
      transparent: true,
      // Les arêtes servent à lire la structure ; en rendu réaliste elles doivent
      // s'effacer, sinon le modèle redevient un dessin.
      opacity: matiere ? 0.12 : 0.35,
    }),
  );
  return { mesh, edges, baseColor: matiere ? matiere.couleur : couleur };
}

/**
 * Boulonnerie, posée depuis la MÊME liste qui la compte.
 *
 * ⚠ C'est ce qui rend un assemblage lisible : sans boulons, une platine d'about
 * n'est qu'une plaque posée contre une autre, et rien ne dit comment les deux
 * pièces tiennent ensemble. Avec eux, on lit le nombre de rangées, les pinces, le
 * sens de montage.
 *
 * Trois maillages instanciés — têtes, tiges, écrous — donc trois appels de
 * dessin pour les cinq cents boulons d'un hangar.
 */
export function creerBoulons(model: StructuralModel): THREE.InstancedMesh[] {
  const placements = listerBoulons(model.members, model.plates);
  const out: THREE.InstancedMesh[] = [];
  const fige = (inst: THREE.InstancedMesh): THREE.InstancedMesh => {
    inst.instanceMatrix.needsUpdate = true;
    /*
     * ⚠ APRÈS avoir posé les matrices, jamais avant. La sphère englobante d'un
     * maillage instancié se calcule à partir de ces matrices ; l'établir sur des
     * matrices identité donne une sphère minuscule à l'origine du repère, et le
     * tronçonnage écarte alors les cinq cents boulons dès qu'on regarde ailleurs.
     * La ligne censée corriger le tronçonnage le provoquait.
     */
    inst.computeBoundingSphere();
    // La boulonnerie n'est pas sélectionnable : on clique une pièce, pas un
    // boulon, et laisser le rayon l'accrocher rendrait la sélection erratique.
    inst.raycast = () => {};
    return inst;
  };

  if (placements.length > 0) {
    const { tete, tige, ecrou } = boltPartGeometries();
    const mat = new THREE.MeshStandardMaterial({
      color: ACIER_BOULON.couleur,
      metalness: ACIER_BOULON.metalness,
      roughness: ACIER_BOULON.roughness,
      clippingPlanes: [],
    });
    const matrices = placements.map((b) => boltMatrices({ ...b, nominal: diametreNominal(b) }));
    const pieces = placements.map((b) => b.pieces);
    for (const [geo, quelle] of [
      [tete, 'tete'],
      [tige, 'tige'],
      [ecrou, 'ecrou'],
    ] as const) {
      const inst = new THREE.InstancedMesh(geo, mat, placements.length);
      inst.castShadow = true;
      for (const [i, m] of matrices.entries()) inst.setMatrixAt(i, m[quelle]);
      inst.userData[PIECES] = pieces;
      inst.userData[MATRICES] = matrices.map((m) => m[quelle]);
      out.push(fige(inst));
    }
  }

  // Les perçages des barres, sombres : vides, ou autour de la tige qui les traverse.
  const percages = percagesDesBarres(model.members);
  if (percages.length > 0) {
    const inst = new THREE.InstancedMesh(
      percageGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x15181c, metalness: 0, roughness: 1, clippingPlanes: [] }),
      percages.length,
    );
    const matrices = percages.map(matriceDePercage);
    for (const [i, m] of matrices.entries()) inst.setMatrixAt(i, m);
    inst.userData[PIECES] = percages.map((t) => [t.piece]);
    inst.userData[MATRICES] = matrices;
    out.push(fige(inst));
  }
  return out;
}

const PIECES = 'pieces';
const MATRICES = 'matrices';
const ESCAMOTE = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Masque les boulons et les perçages des pièces masquées.
 *
 * ⚠ Une pièce isolée ou masquée laissait sa boulonnerie en place : on isolait
 * une traverse et les boulons de tout le bâtiment flottaient autour d'elle. Un
 * boulon reste visible tant qu'UNE des pièces qu'il serre l'est.
 *
 * @param visibles pièces affichées, ou `null` si toutes le sont
 */
export function filtrerBoulonnerie(meshes: readonly THREE.InstancedMesh[], visibles: ReadonlySet<string> | null): void {
  for (const inst of meshes) {
    const pieces = inst.userData[PIECES] as readonly (readonly string[])[] | undefined;
    const matrices = inst.userData[MATRICES] as readonly THREE.Matrix4[] | undefined;
    if (!pieces || !matrices) continue;
    for (const [i, ids] of pieces.entries()) {
      const vu = visibles === null || ids.some((id) => visibles.has(id));
      inst.setMatrixAt(i, vu ? (matrices[i] as THREE.Matrix4) : ESCAMOTE);
    }
    inst.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Cordons de soudure.
 *
 * ⚠ Ils complètent la boulonnerie : un nœud de charpente tient par l'une ou par
 * l'autre, et n'en montrer qu'une revient à laisser croire que les platines sont
 * simplement posées contre l'about des poutres.
 *
 * Le métal déposé est plus mat et plus sombre que l'acier alentour — c'est ce qui
 * le distingue à l'œil sur une pièce réelle, avant même sa forme.
 */
export function creerCordons(
  model: StructuralModel,
  /** Pièces affichées : seuls leurs cordons sont tracés. `null` : toutes. */
  visibles: ReadonlySet<string> | null = null,
): THREE.Mesh | null {
  const g = weldBeadGeometry(
    visibles === null
      ? model
      : { ...model, welds: model.welds.filter((w) => w.between.some((id) => visibles.has(id))) },
  );
  if (!g) return null;
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      color: 0x6f7378,
      metalness: 0.65,
      roughness: 0.78,
      clippingPlanes: [],
      side: THREE.DoubleSide,
    }),
  );
  mesh.castShadow = true;
  // Un cordon n'est pas une pièce : on ne le sélectionne pas.
  mesh.raycast = () => {};
  return mesh;
}

/** Retrace les cordons, restreints aux pièces visibles, en gardant la coupe en cours. */
export function remplacerCordons(
  racine: THREE.Object3D,
  ancien: THREE.Mesh | null,
  model: StructuralModel,
  visibles: ReadonlySet<string> | null,
): THREE.Mesh | null {
  const plans = ancien ? (ancien.material as THREE.Material).clippingPlanes : null;
  if (ancien) {
    racine.remove(ancien);
    ancien.geometry.dispose();
    (ancien.material as THREE.Material).dispose();
  }
  const neuf = creerCordons(model, visibles);
  if (neuf) {
    (neuf.material as THREE.Material).clippingPlanes = plans;
    racine.add(neuf);
  }
  return neuf;
}

/**
 * Libère boulonnerie et cordons. La boulonnerie est instanciée : ses maillages
 * partagent leurs matériaux, mais géométries et matériaux lui appartiennent.
 */
export function libererAssemblages(
  racine: THREE.Object3D,
  boulons: readonly THREE.InstancedMesh[],
  cordons: THREE.Mesh | null,
): void {
  const materiaux = new Set(boulons.map((b) => b.material as THREE.Material));
  for (const b of boulons) {
    racine.remove(b);
    b.geometry.dispose();
    b.dispose();
  }
  for (const m of materiaux) m.dispose();
  if (cordons) {
    racine.remove(cordons);
    cordons.geometry.dispose();
    (cordons.material as THREE.Material).dispose();
  }
}
