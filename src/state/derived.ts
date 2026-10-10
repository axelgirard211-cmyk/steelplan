import { buildProject } from '../core/build/buildProject';
import { runChecks } from '../core/checks/index';
import type { ChecksReport } from '../core/checks/types';
import type { StructuralModel } from '../core/build/types';
import { DEFAULT_PROJECT } from '../core/model/defaults';
import type { ProjectParams } from '../core/model/project';
import { rubriqueDe, validateProject, type Issue } from '../core/model/validate';
import { useProjectStore } from './store';

/**
 * PROJET EFFECTIF — celui à partir duquel tout est dérivé.
 *
 * ⚠⚠ UNE SAISIE INVALIDE FAISAIT PLANTER TOUTE L'APPLICATION. Taper une portée
 * de 0 : le générateur lève « Coupe d'onglet impossible : les deux barres sont
 * confondues », l'exception remonte jusqu'au rendu, et l'interface entière
 * disparaît — page blanche, sans un mot. La validation existait pourtant, et
 * signalait bien la portée nulle : simplement, personne ne la consultait avant
 * de construire. Pire, la saisie fautive était aussitôt sauvegardée, et choisir
 * « Restaurer » au rechargement replantait à l'identique.
 *
 * La règle est donc : on ne CONSTRUIT que depuis un projet valide. Une saisie en
 * erreur laisse la 3D, les plans et les calculs sur le DERNIER ÉTAT VALIDE, et
 * l'interface dit pourquoi. Les champs, eux, affichent toujours ce qui a été
 * tapé : c'est le seul moyen de voir — et de corriger — la valeur fautive.
 *
 * La génération est aussi gardée contre ce que la validation ne prévoit pas :
 * une géométrie dégénérée qui lève quand même est traitée comme une erreur, pas
 * comme une panne.
 */

export interface EtatModele {
  /** Le projet saisi est-il celui que montrent les vues ? */
  readonly aJour: boolean;
  /** Pourquoi il ne l'est pas : erreurs de validation ou échec de génération. */
  readonly raisons: readonly string[];
}

interface Effectif {
  readonly saisi: ProjectParams;
  readonly projet: ProjectParams;
  readonly modele: StructuralModel;
  readonly etat: EtatModele;
}

let cacheEffectif: Effectif | null = null;
let dernierValide: { projet: ProjectParams; modele: StructuralModel } | null = null;

function repli(): { projet: ProjectParams; modele: StructuralModel } {
  /*
   * Aucun état valide connu : cas d'un projet fautif rouvert au démarrage. On
   * montre le projet par défaut plutôt que rien — et le bandeau dit qu'il ne
   * s'agit pas du projet saisi.
   */
  if (!dernierValide) dernierValide = { projet: DEFAULT_PROJECT, modele: buildProject(DEFAULT_PROJECT) };
  return dernierValide;
}

/**
 * Deux saisies ne diffèrent-elles que par les retouches des planches ?
 *
 * ⚠ Une retouche ne change ni le modèle, ni les calculs, ni les planches
 * générées : elle se pose PAR-DESSUS. Sans ce test, chaque trait tiré dans
 * l'éditeur relançait la génération, les vérifications et la centaine de
 * planches du dossier.
 */
function memeHorsRetouches(a: ProjectParams, b: ProjectParams): boolean {
  for (const k of Object.keys(b) as (keyof ProjectParams)[]) {
    if (k !== 'retouches' && a[k] !== b[k]) return false;
  }
  return true;
}

function effectif(p: ProjectParams): Effectif {
  if (cacheEffectif && (cacheEffectif.saisi === p || memeHorsRetouches(cacheEffectif.saisi, p))) return cacheEffectif;

  const erreurs = validateProject(p).filter((i: Issue) => i.level === 'erreur');
  let resultat: Effectif;
  if (erreurs.length > 0) {
    const r = repli();
    resultat = {
      saisi: p,
      projet: r.projet,
      modele: r.modele,
      etat: { aJour: false, raisons: erreurs.map((i) => `${rubriqueDe(i.path)} — ${i.message}`) },
    };
  } else {
    try {
      const modele = buildProject(p);
      dernierValide = { projet: p, modele };
      resultat = { saisi: p, projet: p, modele, etat: { aJour: true, raisons: [] } };
    } catch (e) {
      const r = repli();
      resultat = {
        saisi: p,
        projet: r.projet,
        modele: r.modele,
        etat: {
          aJour: false,
          raisons: [`Génération impossible : ${e instanceof Error ? e.message : String(e)}`],
        },
      };
    }
  }
  cacheEffectif = resultat;
  return resultat;
}

/**
 * Mémoïsation du modèle structurel.
 *
 * Le projet étant immuable, son identité suffit de clé : tant que l'utilisateur
 * ne modifie rien, `buildProject` n'est appelé qu'une fois, quel que soit le
 * nombre de vues qui consomment le modèle (3D, plans, nomenclatures…).
 */
export function structuralModel(p: ProjectParams): StructuralModel {
  return effectif(p).modele;
}

export function useStructuralModel(): StructuralModel {
  return structuralModel(useProjectStore((s) => s.project));
}

/**
 * Le projet DONT EST TIRÉ le modèle affiché.
 *
 * ⚠ À employer partout où un calcul combine le projet ET le modèle —
 * nomenclature, dossier de plans, chiffrage. Mêler la saisie fautive au dernier
 * modèle valide reviendrait à coter un bâtiment de portée nulle sur la géométrie
 * d'un bâtiment de 20 m : ni l'un ni l'autre.
 */
export function useProjetEffectif(): ProjectParams {
  return effectif(useProjectStore((s) => s.project)).projet;
}

/** Les vues montrent-elles la saisie, et sinon pourquoi ? */
export function useEtatModele(): EtatModele {
  return effectif(useProjectStore((s) => s.project)).etat;
}

/**
 * Mémoïsation du rapport de vérification, sur le même principe.
 *
 * Le calcul enchaîne une douzaine de résolutions de système : il ne doit pas être
 * relancé à chaque rendu de composant. Le projet étant immuable, son identité
 * suffit encore de clé.
 *
 * ⚠ Calculé sur le projet EFFECTIF, comme le modèle. Un calcul qui échouerait
 * malgré tout garde le dernier rapport obtenu plutôt que d'emporter l'écran.
 */
let cacheChecks: { cle: ProjectParams; valeur: ChecksReport } | null = null;
let dernierRapport: ChecksReport | null = null;

export function checksReport(p: ProjectParams): ChecksReport {
  const e = effectif(p);
  if (cacheChecks && cacheChecks.cle === e.projet) return cacheChecks.valeur;
  try {
    const valeur = runChecks(e.projet, e.modele);
    cacheChecks = { cle: e.projet, valeur };
    dernierRapport = valeur;
    return valeur;
  } catch (err) {
    if (dernierRapport) return dernierRapport;
    throw err;
  }
}

export function useChecksReport(): ChecksReport {
  return checksReport(useProjectStore((s) => s.project));
}
