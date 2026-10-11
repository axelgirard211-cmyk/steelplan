import { buildProject } from '../build/buildProject';
import type { StructuralModel } from '../build/types';
import { getProfile, type ProfileFamily } from '../catalog/index';
import type { SteelGradeId } from '../catalog/types';
import { cutLengths } from '../geometry/member';
import type { ProjectParams } from '../model/project';
import { isValid, validateProject } from '../model/validate';
import { inertieFaible } from './buckling';
import { runChecks } from './index';
import { classer } from './section';
import { fyDe } from './element';
import { candidats, postesActifs, type Poste } from './postes';
import { dimensionnerAssemblages, type PropositionAssemblages } from './dimensionnerAssemblages';

/**
 * DIMENSIONNEMENT AUTOMATIQUE : le profil le plus léger qui tient.
 *
 * ⚠ C'est la fonction qui manquait pour que le calcul serve à quelque chose.
 * SteelPlan savait dire « ce poteau travaille à 1,34 » sans offrir aucun moyen
 * d'y répondre : il fallait éditer le fichier à la main, relancer, relire. Le
 * moteur Eurocode était consultatif.
 *
 * La recherche est GLOUTONNE, poste par poste, dans l'ordre où les postes se
 * portent les uns les autres : l'ossature secondaire d'abord, les poteaux en
 * dernier. Ce n'est pas un optimum global — deux postes couplés peuvent avoir un
 * meilleur couple que la somme de leurs meilleurs choix isolés — et c'est
 * assumé : un optimum global demanderait d'explorer le produit des catalogues.
 */

/**
 * Pourquoi un poste change. Sans cette raison, une proposition qui ALOURDIT une
 * pièce déjà vérifiée paraît arbitraire, et c'est tout le reste qu'on cesse de
 * croire.
 */
export type MotifChangement =
  /** L'ancien profil dépassait la cible : il fallait renforcer. */
  | 'renfort'
  /** L'ancien profil tenait, un plus léger tient aussi. */
  | 'allegement'
  /** L'ancien profil tenait au calcul mais était trop élancé pour être monté. */
  | 'elancement';

export const MOTIFS: Readonly<Record<MotifChangement, string>> = {
  renfort: 'insuffisant',
  allegement: 'allégement',
  elancement: 'trop élancé pour être monté',
};

export interface ChangementPoste {
  readonly poste: string;
  readonly avant: string;
  readonly apres: string;
  /** Taux de travail du poste avant et après, sur ses propres pièces. */
  readonly tauxAvant: number;
  readonly tauxApres: number;
  readonly motif: MotifChangement;
  /** Masse linéique gagnée (négative) ou ajoutée (positive), en kg/m. */
  readonly deltaKgParM: number;
  /**
   * Le profil proposé est d'une autre FAMILLE (tube rond → tube carré, HEA →
   * IPE). Ce n'est pas un détail de catalogue : platines, goussets, perçages et
   * assemblages sont à reprendre. Jamais en silence.
   */
  readonly familleAvant: ProfileFamily;
  readonly familleApres: ProfileFamily;
  /** Pièces que le changement entraîne, s'il y en a (chevêtres avec les lisses). */
  readonly entraine: string | null;
}

export interface Proposition {
  readonly projet: ProjectParams;
  readonly changements: readonly ChangementPoste[];
  readonly masseAvant: number;
  readonly masseApres: number;
  /** Taux de travail maximal du projet retenu, toutes pièces confondues. */
  readonly tauxMax: number;
  /** Postes dont aucun profil du catalogue ne tient : ils restent au plus fort. */
  readonly insuffisants: readonly string[];
  /** Nombre de modèles construits et vérifiés — le coût réel de la recherche. */
  readonly evaluations: number;
  readonly ms: number;
  /** Réglages d'assemblage, quand ils ont été demandés. */
  readonly assemblages: PropositionAssemblages | null;
}

/**
 * Élancement au-delà duquel on refuse de PROPOSER un profil.
 *
 * ⚠ Ce n'est pas un critère de vérification — une barre tendue n'a pas de limite
 * d'élancement, et le rapport n'en impose aucune aux contreventements. C'est un
 * critère de PROPOSITION : laissé libre, le dimensionnement automatique
 * remplaçait une palée CHS 60,3×4 par une cornière L 20×20×3, parce qu'un tirant
 * de 8 mètres ne travaille qu'à 12 % de sa résistance. La barre « tient ». Elle
 * flèche sous son propre poids, vibre au vent et se vrille au transport, et
 * aucun atelier ne l'expédierait. Le logiciel n'a pas à conseiller ce qu'un
 * professionnel refuserait de monter.
 */
const ELANCEMENT_MAX_PROPOSE = 400;

export interface OptionsDimensionnement {
  /** Taux de travail visé, 1,00 par défaut. */
  readonly cible?: number;
  /** Appelée à chaque poste terminé, pour que l'écran ne paraisse pas figé. */
  readonly onProgres?: (fait: number, total: number, libelle: string) => void;
  /**
   * Chercher aussi dans les autres familles du poste. Faux par défaut : la
   * famille est un choix de conception — l'assemblage d'un tube rond n'est pas
   * celui d'un tube carré — et un dimensionnement n'a pas à le défaire. Même
   * faux, une famille qui n'a AUCUN profil qui tienne laisse chercher ailleurs,
   * et le changement est signalé.
   */
  readonly changerDeFamille?: boolean;
  /**
   * Balayer tout le catalogue de la famille au lieu de chercher autour du
   * profil actuel. Même réponse, plus lent : sert à le vérifier.
   */
  readonly balayageComplet?: boolean;
  /**
   * Régler aussi les assemblages, une fois les profils trouvés : platines,
   * tiges, goussets, boulons, oblongs. Ils dépendent des profils, pas l'inverse.
   */
  readonly assemblages?: boolean;
}

export function dimensionner(
  depart: ProjectParams,
  opts: OptionsDimensionnement = {},
): Proposition {
  const t0 = performance.now();
  const cible = opts.cible ?? 1.0;
  const postes = postesActifs(depart);

  let projet = depart;
  let evaluations = 0;
  const changements: ChangementPoste[] = [];
  const insuffisants: string[] = [];

  /**
   * Taux de travail des pièces d'un poste, pour un projet donné — et le modèle
   * construit pour l'obtenir, que l'appelant réutilise au lieu de le refaire.
   *
   * ⚠ Un poste dont les pièces EXISTENT mais dont aucune n'apparaît au rapport
   * vaut l'infini, jamais zéro. `runChecks` abandonne silencieusement une
   * combinaison dont le système est insoluble — et un poteau trop faible rend
   * précisément le portique insoluble. Compter cette absence comme un succès
   * faisait proposer un IPE 80 en poteau de 6 m « travaillant à 0,00 ». C'est le
   * même piège que celui des pièces non vérifiées : le silence n'est pas une
   * réponse acceptable.
   */
  const evaluer = (p: ProjectParams, poste: Poste): { taux: number; model: StructuralModel } => {
    evaluations += 1;
    const model = buildProject(p);
    const concernes = new Set(model.members.filter(poste.concerne).map((m) => m.mark));
    if (concernes.size === 0) return { taux: 0, model };

    // Seule la partie du rapport où se lisent les pièces du poste est établie.
    const rapport = runChecks(p, model, poste.perimetre);
    let max = 0;
    let vues = 0;
    for (const l of rapport.lines) {
      if (poste.partage) max = Math.max(max, poste.partage(l));
      if (!concernes.has(l.mark)) continue;
      vues += 1;
      max = Math.max(max, l.ratio);
    }
    return { taux: vues === concernes.size ? max : Infinity, model };
  };

  let modeleDepart: StructuralModel | null = null;
  for (const [i, poste] of postes.entries()) {
    const avant = poste.profil(projet);
    const famille = getProfile(avant).family;
    const initial = evaluer(projet, poste);
    modeleDepart ??= initial.model;
    const tauxAvant = initial.taux;
    const liste = proposables(
      candidats(poste).filter((id) => !classeQuatre(id, poste.nuance(projet))),
      longueurMax(initial.model, poste),
    );

    // Un profil déjà évalué ne l'est pas deux fois — à commencer par l'actuel.
    const memo = new Map<string, number>([[avant, tauxAvant]]);
    const taux = (p: ProjectParams): number => {
      const id = poste.profil(p);
      const connu = memo.get(id);
      if (connu !== undefined) return connu;
      const t = evaluer(p, poste).taux;
      memo.set(id, t);
      return t;
    };

    const dans = (memeFamille: boolean): string[] =>
      liste.filter((id) => (getProfile(id).family === famille) === memeFamille);
    const memeFamille = dans(true);
    // Recherche LOCALE autour du profil actuel quand le taux suit la masse dans
    // la famille ; balayage complet sinon (treillis, changement de famille).
    let choix =
      opts.changerDeFamille || opts.balayageComplet || !poste.monotone || !memeFamille.includes(avant)
        ? chercher(projet, poste, opts.changerDeFamille ? liste : memeFamille, cible, taux)
        : chercherAutour(projet, poste, memeFamille, avant, cible, taux);
    // Dernier recours : rien ne tient dans la famille. On cherche ailleurs — et
    // le changement de famille sera écrit sur la ligne.
    if (choix === null && !opts.changerDeFamille) choix = chercher(projet, poste, dans(false), cible, taux);
    if (choix === null) {
      insuffisants.push(poste.libelle);
    } else if (choix.profil !== avant) {
      const ga = getProfile(avant).G;
      const gb = getProfile(choix.profil).G;
      projet = poste.poser(projet, choix.profil);
      changements.push({
        poste: poste.libelle,
        avant,
        apres: choix.profil,
        tauxAvant,
        tauxApres: choix.taux,
        motif:
          tauxAvant > cible ? 'renfort' : gb > ga ? 'elancement' : 'allegement',
        deltaKgParM: gb - ga,
        familleAvant: famille,
        familleApres: getProfile(choix.profil).family,
        entraine: poste.entraine?.(projet) ?? null,
      });
    }
    opts.onProgres?.(i + 1, postes.length, poste.libelle);
  }

  let assemblages: PropositionAssemblages | null = null;
  if (opts.assemblages) {
    opts.onProgres?.(postes.length, postes.length, 'Assemblages');
    assemblages = dimensionnerAssemblages(projet, cible);
    projet = assemblages.projet;
    evaluations += assemblages.evaluations;
  }

  const modeleFinal = buildProject(projet);
  const final = runChecks(projet, modeleFinal);
  return {
    assemblages,
    projet,
    changements,
    masseAvant: (modeleDepart ?? buildProject(depart)).stats.massKg,
    masseApres: modeleFinal.stats.massKg,
    tauxMax: final.maxRatio,
    insuffisants,
    evaluations,
    ms: performance.now() - t0,
  };
}

/**
 * Recherche LOCALE, pour un poste dont le taux décroît avec la masse dans sa
 * famille : on part du profil actuel au lieu du plus léger du catalogue.
 *
 *  - il tient : on cherche le plus léger qui tient encore, en dessous ;
 *  - il ne tient pas : le premier qui tient, au-dessus.
 *
 * Par BONDS — 1, 1, 2, 4, 8 profils — jusqu'à encadrer la réponse, puis par
 * dichotomie dans l'encadrement : deux évaluations quand la réponse est voisine
 * (le cas courant), quelques-unes quand elle est loin — un poteau de ferme qui
 * passe de HEA 300 à HEA 140 en demandait neuf, un à un.
 *
 * Même réponse que le balayage depuis le bas, puisque le taux suit la masse.
 * Les profils qui rendent le projet INGÉNÉRABLE sont écartés d'abord : la
 * validation ne coûte presque rien, et ce sont eux — comptés comme « trop
 * faibles » — qui avaient fait abandonner autrefois la dichotomie.
 */
function chercherAutour(
  projet: ProjectParams,
  poste: Poste,
  liste: readonly string[],
  actuel: string,
  cible: number,
  taux: (p: ProjectParams) => number,
): { profil: string; taux: number } | null {
  const valides = liste.filter((id) => id === actuel || isValid(validateProject(poste.poser(projet, id))));
  const c = valides.indexOf(actuel);
  const t = new Map<number, number>();
  const tauxDe = (k: number): number => {
    const connu = t.get(k);
    if (connu !== undefined) return connu;
    const v = taux(poste.poser(projet, valides[k] as string));
    t.set(k, v);
    return v;
  };
  const tient = (k: number): boolean => tauxDe(k) <= cible;
  const PAS = [1, 1, 2, 4, 8, 16];
  const pas = (n: number): number => PAS[Math.min(n, PAS.length - 1)] as number;

  // Encadrement : `bas` ne tient pas (ou -1), `haut` tient (ou longueur).
  let bas: number;
  let haut: number;
  if (tient(c)) {
    haut = c;
    bas = -1;
    for (let n = 0, k = c; ; n++) {
      k -= pas(n);
      if (k < 0) k = 0;
      if (tient(k)) {
        haut = k;
        if (k === 0) break;
      } else {
        bas = k;
        break;
      }
    }
  } else {
    bas = c;
    haut = valides.length;
    for (let n = 0, k = c; ; n++) {
      k = Math.min(k + pas(n), valides.length - 1);
      if (tient(k)) {
        haut = k;
        break;
      }
      bas = k;
      if (k === valides.length - 1) return null;
    }
  }
  while (haut - bas > 1) {
    const m = (bas + haut) >> 1;
    if (tient(m)) haut = m;
    else bas = m;
  }
  return { profil: valides[haut] as string, taux: tauxDe(haut) };
}

/**
 * Le plus léger profil de la liste dont le taux reste sous la cible.
 *
 * ⚠ BALAYAGE, et non dichotomie. La dichotomie suppose que « plus lourd » veut
 * dire « moins sollicité », et c'est faux ici pour une raison qui n'a rien de
 * subtil : un profil peut rendre le projet INGÉNÉRABLE — platine de pied plus
 * étroite que la semelle, jarret plus court que la traverse — et compte alors
 * comme un échec. Ces échecs sont dispersés dans le haut de la liste, où les
 * sections sont larges. La dichotomie les lisait comme « trop faible », montait,
 * et rendait un profil PLUS LOURD que celui de départ : sur le projet par
 * défaut elle proposait de remplacer un potelet IPE 240 travaillant à 0,75 par
 * un IPE 300 travaillant à 0,39. Proposer d'alourdir une pièce qui tient déjà
 * discrédite tout le reste de la proposition.
 *
 * Le balayage part du plus léger et s'arrête au premier qui tient. Il coûte
 * autant d'évaluations que le rang de la réponse — une poignée en pratique,
 * puisque la réponse est justement du côté léger.
 */
function chercher(
  projet: ProjectParams,
  poste: Poste,
  liste: readonly string[],
  cible: number,
  taux: (p: ProjectParams) => number,
): { profil: string; taux: number } | null {
  for (const profil of liste) {
    const candidat = poste.poser(projet, profil);
    // Un projet que le générateur refuse n'est pas un candidat : on passe, sans
    // en conclure quoi que ce soit sur les profils suivants.
    if (!isValid(validateProject(candidat))) continue;
    const t = taux(candidat);
    if (t <= cible) return { profil, taux: t };
  }
  return null;
}

/** Longueur de la plus longue barre commandée par ce poste (mm). */
function longueurMax(model: StructuralModel, poste: Poste): number {
  let max = 0;
  for (const m of model.members) {
    if (poste.concerne(m)) max = Math.max(max, cutLengths(m).axis);
  }
  return max;
}

/**
 * Candidats qu'on accepte de proposer, l'élancement écarté.
 *
 * Le rayon de giration minimal est celui qui gouverne : sur une cornière il suit
 * l'axe incliné, pas l'aile. Écarter sur Iz laisserait passer exactement les
 * sections que ce filtre existe pour refuser.
 */
function proposables(liste: readonly string[], longueur: number): string[] {
  if (longueur <= 0) return [...liste];
  return liste.filter((id) => {
    const p = getProfile(id);
    if (p.A <= 0) return false;
    const iMin = Math.sqrt(inertieFaible(p) / p.A);
    return iMin > 0 && longueur / iMin <= ELANCEMENT_MAX_PROPOSE;
  });
}

/**
 * Le profil est-il de classe 4 dans cette nuance ?
 *
 * ⚠ SteelPlan ne calcule PAS les sections efficaces de l'EN 1993-1-5 : une
 * section de classe 4 voile localement avant d'atteindre sa limite d'élasticité,
 * et sa résistance réelle est inférieure à celle qu'on lui calcule. Le rapport
 * l'écrit en toutes lettres quand l'utilisateur en choisit une.
 *
 * Mais le dimensionnement automatique, lui, n'a aucune raison d'en PROPOSER une :
 * ce serait recommander précisément le profil dont on vient de dire qu'on ne sait
 * pas le vérifier. Sur ce catalogue le filtre ne retire d'ailleurs rien en S235 ni
 * en S355 — aucun profil n'y est de classe 4 — et une petite poignée en S460.
 */
function classeQuatre(profileId: string, nuance: SteelGradeId): boolean {
  const p = getProfile(profileId);
  // Classement sous compression pure : le cas le plus défavorable.
  return classer(p, fyDe(p, nuance), -1).cls === 4;
}
