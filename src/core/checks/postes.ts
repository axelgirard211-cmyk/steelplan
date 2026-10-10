import { PROFILES, type ProfileFamily } from '../catalog/index';
import type { SteelGradeId } from '../catalog/types';
import type { Member } from '../geometry/member';
import type { ProjectParams } from '../model/project';

/**
 * LES POSTES DIMENSIONNABLES.
 *
 * ⚠ Un « poste » n'est ni une barre ni un repère : c'est UN champ de profil du
 * projet, et l'ensemble des pièces qu'il commande. Changer `frame.columnProfile`
 * change tous les poteaux d'un coup — c'est précisément ce qui rend le
 * dimensionnement automatique possible, et c'est aussi ce qui interdit de
 * raisonner repère par repère.
 *
 * Chaque poste sait trois choses : où lire son profil, comment l'écrire, et
 * QUELLES pièces en dépendent. La troisième n'est pas déductible du rôle seul :
 * la poutre au vent, les palées et le contreventement de pignon portent tous le
 * rôle `contreventement` et ont pourtant trois profils distincts. C'est la
 * position, écrite par le générateur, qui les sépare.
 */

export interface Poste {
  readonly id: string;
  readonly libelle: string;
  /** Familles de profils proposées : on n'essaie pas un IPE 600 en lierne. */
  readonly familles: readonly ProfileFamily[];
  readonly profil: (p: ProjectParams) => string;
  /** Nuance employée par ce poste : elle décide du classement de section. */
  readonly nuance: (p: ProjectParams) => SteelGradeId;
  readonly poser: (p: ProjectParams, profil: string) => ProjectParams;
  /** La pièce dépend-elle de ce poste ? */
  readonly concerne: (m: Member) => boolean;
  /** Pièces qui SUIVENT ce poste sans être vérifiées avec lui, s'il y en a. */
  readonly entraine?: (p: ProjectParams) => string | null;
}

/**
 * Les chevêtres d'ouverture suivent les lisses.
 *
 * ⚠ Même hauteur imposée (bardage plan, attaches plaquées) : une lisse allégée
 * d'UPE 160 en UPE 140 rendait le projet invalide, la recherche l'écartait, et
 * les lisses restaient bloquées à leur hauteur sans que rien ne dise pourquoi.
 */
const chevetresSuivent = (p: ProjectParams): boolean =>
  p.ouvertures.enabled && p.ouvertures.items.length > 0;

const POTEAU: readonly ProfileFamily[] = ['HEA', 'HEB', 'HEM', 'IPE'];
const TRAVERSE: readonly ProfileFamily[] = ['IPE', 'HEA', 'HEB'];
const PANNE: readonly ProfileFamily[] = ['IPE', 'UPE'];
const LISSE: readonly ProfileFamily[] = ['UPE', 'UPN'];
const TREILLIS: readonly ProfileFamily[] = ['L', 'LI', 'CHS', 'SHS', 'RHS'];
const DIAGONALE: readonly ProfileFamily[] = ['CHS', 'L', 'SHS'];

/**
 * Postes réellement présents dans ce projet.
 *
 * ⚠ Les profils de pignon distincts en sont ABSENTS. Poteaux courants et
 * poteaux de pignon partagent le rôle `poteau` et le générateur ne les
 * distingue pas par la position : les dimensionner séparément demanderait de
 * savoir lesquels sont sur la file de rive, ce que le rapport de vérification
 * ne dit pas. Les régler à la main reste possible ; les régler mal
 * automatiquement ne le serait pas.
 */
export function postesActifs(p: ProjectParams): Poste[] {
  const out: Poste[] = [];

  if (p.secondary.purlins.enabled) {
    out.push({
      id: 'panne',
      libelle: 'Pannes',
      familles: PANNE,
      profil: (x) => x.secondary.purlins.profile,
      nuance: (x) => x.secondary.purlins.grade,
      poser: (x, v) => ({
        ...x,
        secondary: { ...x.secondary, purlins: { ...x.secondary.purlins, profile: v } },
      }),
      concerne: (m) => m.role === 'panne',
    });
  }

  if (p.secondary.rails.enabled) {
    out.push({
      id: 'lisse',
      libelle: 'Lisses',
      familles: LISSE,
      profil: (x) => x.secondary.rails.profile,
      nuance: (x) => x.secondary.rails.grade,
      poser: (x, v) => ({
        ...x,
        secondary: { ...x.secondary, rails: { ...x.secondary.rails, profile: v } },
        ouvertures: chevetresSuivent(x) ? { ...x.ouvertures, profile: v } : x.ouvertures,
      }),
      concerne: (m) => m.role === 'lisse',
      entraine: (x) => (chevetresSuivent(x) ? 'chevêtres d’ouverture (même hauteur que les lisses)' : null),
    });
  }

  if (p.secondary.gablePosts.enabled) {
    out.push({
      id: 'potelet',
      libelle: 'Potelets',
      familles: POTEAU,
      profil: (x) => x.secondary.gablePosts.profile,
      nuance: (x) => x.secondary.gablePosts.grade,
      poser: (x, v) => ({
        ...x,
        secondary: { ...x.secondary, gablePosts: { ...x.secondary.gablePosts, profile: v } },
      }),
      concerne: (m) => m.role === 'potelet',
    });
  }

  for (const [cle, libelle, motif] of [
    ['roof', 'Poutre au vent', 'poutre au vent'],
    ['wall', 'Palées de stabilité', 'palée de stabilité'],
    ['gable', 'Contreventement de pignon', 'contreventement de pignon'],
  ] as const) {
    if (!p.bracing[cle].enabled) continue;
    out.push({
      id: `contreventement-${cle}`,
      libelle,
      familles: DIAGONALE,
      profil: (x) => x.bracing[cle].profile,
      nuance: (x) => x.bracing.grade,
      poser: (x, v) => ({
        ...x,
        bracing: { ...x.bracing, [cle]: { ...x.bracing[cle], profile: v } },
      }),
      concerne: (m) => m.role === 'contreventement' && m.position.startsWith(motif),
    });
  }

  if (p.truss.enabled) {
    const membre = (
      id: string,
      libelle: string,
      cle: 'topChordProfile' | 'bottomChordProfile' | 'postProfile' | 'diagonalProfile',
      role: Member['role'],
      familles: readonly ProfileFamily[],
    ): Poste => ({
      id,
      libelle,
      familles,
      profil: (x) => x.truss[cle],
      nuance: (x) => x.truss.grade,
      poser: (x, v) => ({ ...x, truss: { ...x.truss, [cle]: v } }),
      concerne: (m) => m.role === role,
    });
    out.push(
      membre('membrure-sup', 'Membrure supérieure', 'topChordProfile', 'membrure-sup', TREILLIS),
      membre('membrure-inf', 'Membrure inférieure', 'bottomChordProfile', 'membrure-inf', TREILLIS),
      membre('montant', 'Montants de ferme', 'postProfile', 'montant', TREILLIS),
      membre('diagonale', 'Diagonales de ferme', 'diagonalProfile', 'diagonale', TREILLIS),
    );
  }

  if (p.frame.enabled) {
    out.push({
      id: 'traverse',
      libelle: 'Traverses',
      familles: TRAVERSE,
      profil: (x) => x.frame.rafterProfile,
      nuance: (x) => x.frame.grade,
      poser: (x, v) => ({ ...x, frame: { ...x.frame, rafterProfile: v } }),
      concerne: (m) => m.role === 'traverse',
    });
  }

  // ⚠ Le poteau EN DERNIER, toujours. Il porte tout le reste : l'alléger avant
  // d'avoir figé ce qu'il supporte reviendrait à le dimensionner sur une charge
  // qui va encore changer.
  out.push({
    id: 'poteau',
    libelle: 'Poteaux',
    familles: POTEAU,
    profil: (x) => x.frame.columnProfile,
    nuance: (x) => x.frame.grade,
    poser: (x, v) => ({ ...x, frame: { ...x.frame, columnProfile: v } }),
    concerne: (m) => m.role === 'poteau',
  });

  return out;
}

/**
 * Profils candidats d'un poste, du plus léger au plus lourd.
 *
 * Le tri par masse linéique est ce qui donne son sens à la recherche : « le plus
 * léger qui tient » est la définition même du dimensionnement économique, et
 * l'acier se paie au kilo.
 */
export function candidats(poste: Poste): string[] {
  return PROFILES.filter((x) => poste.familles.includes(x.family))
    .slice()
    .sort((a, b) => a.G - b.G || a.id.localeCompare(b.id))
    .map((x) => x.id);
}
