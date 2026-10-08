import { getProfile } from '../../catalog/index';
import { squareCut, type Member, type MemberRole } from '../../geometry/member';
import { normalize, sub, EZ, type Vec3 } from '../../math/vec3';
import type { ProjectParams } from '../../model/project';

/**
 * CE QUE TOUTE PIÈCE D'OSSATURE SECONDAIRE PARTAGE.
 *
 * Une panne, une lisse et un potelet se construisent de la même façon — coupe
 * droite aux deux abouts, orientation donnée approximativement — et reposent sur
 * la même pièce porteuse. Ces deux fonctions sont ici pour qu'il n'en existe
 * qu'une version : un jour où l'une des trois familles aurait sa propre copie de
 * `barre`, elles cesseraient d'être posées de la même manière sans que rien ne
 * le signale.
 */

/** Barre d'ossature secondaire : coupée droite aux deux abouts. */
export function barre(
  id: string,
  role: MemberRole,
  profileId: string,
  grade: Member['grade'],
  a: Vec3,
  b: Vec3,
  up: Vec3,
  position: string,
): Member {
  const axe = normalize(sub(b, a));
  // `up` peut être donné approximativement : memberFrame l'orthogonalise.
  const axeUp = Math.abs(up.x * axe.x + up.y * axe.y + up.z * axe.z) > 0.999 ? EZ : up;
  return {
    id,
    role,
    profileId,
    grade,
    start: a,
    end: b,
    up: axeUp,
    mirrored: false,
    holes: [],
    notches: [],
    porteur: null,
    cutStart: squareCut(a, axe, -1),
    cutEnd: squareCut(b, axe, 1),
    mark: '',
    assemblage: '',
    position,
  };
}

/** Hauteur de la pièce qui porte l'ossature secondaire : traverse ou membrure. */
/** Hauteur de la pièce porteuse sous les pannes : traverse ou arbalétrier. */
export function hauteurPorteur(p: ProjectParams): number {
  return p.frame.enabled
    ? getProfile(p.frame.rafterProfile).h
    : getProfile(p.truss.topChordProfile).h;
}
