import type { AtelierParams } from './atelier';
import type { SteelGradeId } from '../catalog/types';
import type { Vec3 } from '../math/vec3';
import type { BracingParams } from './bracing';
import type { ConnectionParams } from './connections';
import type { FrameParams } from './frame';
import type { GridParams } from './grid';
import type { FinitionParams } from './finition';
import type { LoadModel } from './loads';
import type { OuvertureParams } from './ouvertures';
import type { SecondaryParams } from './secondary';
import type { SiteParams } from './site';
import type { TrussParams } from './truss';

/**
 * Une diffusion du dossier : ce qui a changé, quand, et par qui.
 *
 * ⚠ C'est la seule trace de ce qui distingue l'indice C de l'indice B. Un
 * atelier qui reçoit un plan à l'indice C sans savoir ce qui a bougé doit
 * comparer les deux tirages trait par trait — et c'est ainsi qu'une
 * modification de platine passe inaperçue jusqu'au montage.
 */
export interface Revision {
  readonly indice: string;
  /** Date au format ISO (AAAA-MM-JJ). */
  readonly date: string;
  /** Objet de la modification : ce qu'il faut regarder sur le nouveau tirage. */
  readonly objet: string;
  readonly auteur: string;
}

/** Cartouche du plan : ce qui identifie le document en atelier. */
export interface ProjectMeta {
  readonly nom: string;
  readonly client: string;
  readonly chantier: string;
  readonly dessinateur: string;
  /** Indice de révision, ex. « A », « B »… */
  readonly indice: string;
  /** Date au format ISO (AAAA-MM-JJ). */
  readonly date: string;
  readonly commentaire: string;
  /**
   * Historique des diffusions, de la plus ancienne à la plus récente.
   *
   * ⚠ La dernière doit porter l'indice et la date du cartouche : la fiche
   * Cartouche les tient ensemble, et la validation signale tout écart. Un
   * cartouche à l'indice C dont le tableau s'arrête à B ferait croire qu'une
   * diffusion manque.
   */
  readonly revisions: readonly Revision[];
}

/**
 * Barre libre ajoutée à la main entre deux points, hors trame paramétrique.
 * Sert aux cas particuliers qu'aucune règle ne couvre.
 */
export interface FreeMember {
  readonly id: string;
  readonly profile: string;
  readonly grade: SteelGradeId;
  readonly start: Vec3;
  readonly end: Vec3;
  /** Rotation du profil autour de son axe (degrés). */
  readonly rotation: number;
  readonly label: string;
}

/**
 * ⚠ SOURCE DE VÉRITÉ UNIQUE.
 *
 * Cet objet est l'intégralité du projet : c'est lui qui est sauvegardé, annulé,
 * rétabli. La vue 3D, les plans, les nomenclatures et les vérifications en sont
 * TOUS déduits par recalcul. Rien de dérivé n'est stocké ici.
 */
export interface ProjectParams {
  /** Version du schéma, pour les migrations de fichier. */
  readonly version: number;
  readonly meta: ProjectMeta;
  readonly grid: GridParams;
  readonly frame: FrameParams;
  readonly truss: TrussParams;
  readonly secondary: SecondaryParams;
  /** Portails, portes et châssis percés dans les façades. */
  readonly ouvertures: OuvertureParams;
  readonly bracing: BracingParams;
  readonly connections: ConnectionParams;
  /** Le site : région de neige, région de vent, terrain, altitude. */
  readonly site: SiteParams;
  readonly loads: LoadModel;
  /** Traitement de surface : dernier poste de l'atelier. */
  readonly finition: FinitionParams;
  /** Barres du commerce, trait de scie, classe d'exécution : ce que sait l'atelier. */
  readonly atelier: AtelierParams;
  readonly freeMembers: readonly FreeMember[];
}
