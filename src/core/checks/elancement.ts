import type { Profile } from '../catalog/types';
import type { MemberRole } from '../geometry/member';
import { inertieFaible } from './buckling';

/**
 * ÉLANCEMENT GÉOMÉTRIQUE λ = Lcr / i.
 *
 * ⚠ Ce n'est PAS une exigence de l'EN 1993-1-1, qui a supprimé les limites
 * d'élancement de l'ancien CM66. C'est un critère de BONNE PRATIQUE, et il est
 * indispensable ici pour une raison très concrète : le dimensionnement
 * automatique cherche le profil le plus léger dont le taux reste sous 1. Sans
 * limite d'élancement, il propose une cornière L 20×20×3 en palée de stabilité —
 * la barre « tient » au calcul, parce qu'elle ne travaille qu'en traction, mais
 * elle vibre au vent, flèche sous son propre poids, se tord au transport et
 * personne ne la monterait.
 *
 * Les limites retenues sont celles couramment imposées en charpente française.
 * Elles figurent dans les hypothèses du rapport, pour qu'on sache que c'est un
 * choix de l'outil et non une clause de norme.
 */

/**
 * Limite d'élancement admise, par rôle.
 *
 * ⚠ Les valeurs suivent la gradation classique du CM66, reprise par l'usage :
 * plus une barre est COMPRIMÉE et porteuse, plus on la bride. Une barre
 * uniquement tendue n'a pas de limite physique — elle ne flambe pas — mais on
 * la bride tout de même, parce qu'un tirant trop fin flèche sous son poids,
 * vibre au vent et se vrille au transport.
 */
export function limiteElancement(role: MemberRole): number {
  switch (role) {
    // Compression principale : on reste dans le domaine où les formules de
    // flambement sont fiables et la pièce reste manipulable.
    case 'poteau':
    case 'traverse':
    case 'console':
    case 'membrure-sup':
    case 'membrure-inf':
      return 200;
    // Barres de treillis secondaires, comprimées sous certaines combinaisons.
    case 'montant':
    case 'diagonale':
      return 250;
    /*
     * Pannes, lisses et potelets : fléchis, et maintenus sur toute leur longueur
     * par le bac qu'ils portent. Leur élancement hors plan ne décrit aucun mode
     * de ruine réel — la limite ne sert qu'à écarter les sections absurdes.
     */
    case 'panne':
    case 'lisse':
    case 'potelet':
      return 350;
    /*
     * ⚠ AUCUNE limite sur les barres tendues seules — contreventements et
     * liernes. Ce n'est pas un oubli : une palée en croix de Saint-André se pose
     * avec un tendeur, on la met en tension à la main, et son élancement dépasse
     * couramment 1000 sans que personne s'en émeuve. Elle ne flambe pas : elle
     * est tendue. Leur imposer 400 condamnait tous les gabarits du logiciel pour
     * un critère qui ne décrit aucun mode de ruine.
     *
     * Le garde-fou est ailleurs, et il est de nature différente : le
     * dimensionnement automatique refuse de PROPOSER une barre qu'on n'oserait
     * pas monter (voir ELANCEMENT_MAX_PROPOSE). Ce que le calcul accepte et ce
     * qu'on ose commander sont deux questions distinctes.
     */
    case 'contreventement':
    case 'lierne':
      return Infinity;
    default:
      return 250;
  }
}

/**
 * Élancement le plus défavorable d'une barre, et son taux vis-à-vis de la limite.
 *
 * On retient le maximum des deux plans : c'est le plus élancé qui gouverne, et
 * hors plan une cornière est bien plus élancée qu'elle n'en a l'air — son rayon
 * de giration minimal suit l'axe incliné, pas l'aile.
 */
export function elancement(
  p: Profile,
  role: MemberRole,
  lcrY: number,
  lcrZ: number,
): { lambda: number; limite: number; ratio: number } {
  const limite = limiteElancement(role);
  const iy = p.A > 0 ? Math.sqrt(p.Iy / p.A) : 0;
  const iz = p.A > 0 ? Math.sqrt(inertieFaible(p) / p.A) : 0;
  const lambda = Math.max(iy > 0 ? lcrY / iy : 0, iz > 0 ? lcrZ / iz : 0);
  return {
    lambda,
    limite,
    ratio: Number.isFinite(limite) && limite > 0 ? lambda / limite : 0,
  };
}
