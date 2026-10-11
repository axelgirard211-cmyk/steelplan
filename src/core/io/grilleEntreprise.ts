import type { ProjectParams } from '../model/project';
import { GRILLE_PAR_DEFAUT, type GrillePrix } from '../model/prix';
import { stockageDisponible } from './storage';

/**
 * GRILLE DE L'ENTREPRISE — les prix que le bureau d'études saisit une fois et
 * que chaque nouveau projet reprend.
 *
 * Mémorisée sur le poste, et relue avec méfiance : le stockage peut avoir été
 * écrit par une version antérieure, tronqué, ou modifié à la main. Une valeur
 * qui n'est pas un nombre fini fait rejeter la grille entière — mieux vaut
 * repartir des prix par défaut, visiblement, que chiffrer sur un prix corrompu.
 */

const CLE = 'steelplan.grille-entreprise.v1';

/** La grille relue, ou `null` si aucune n'est mémorisée ou si elle est illisible. */
export function lireGrilleEntreprise(store: Storage | null = stockageDisponible()): GrillePrix | null {
  if (!store) return null;
  try {
    const brut = store.getItem(CLE);
    return brut === null ? null : verifierGrille(JSON.parse(brut));
  } catch {
    return null;
  }
}

/** Mémorise la grille ; `false` si le stockage refuse. */
export function memoriserGrilleEntreprise(g: GrillePrix, store: Storage | null = stockageDisponible()): boolean {
  if (!store) return false;
  try {
    store.setItem(CLE, JSON.stringify(g));
    return true;
  } catch {
    return false;
  }
}

/** Le projet, avec la grille de l'entreprise si elle existe. */
export function avecGrilleEntreprise(p: ProjectParams, store: Storage | null = stockageDisponible()): ProjectParams {
  const g = lireGrilleEntreprise(store);
  return g ? { ...p, prix: g } : p;
}

/** Contrôle à la frontière : tous les champs de la grille, et rien que des nombres finis. */
export function verifierGrille(brut: unknown): GrillePrix | null {
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return null;
  const r = brut as Record<string, unknown>;
  const nombre = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const acier = r['acier'];
  if (acier === null || typeof acier !== 'object' || Array.isArray(acier)) return null;
  const prixAcier: Record<string, number> = { ...GRILLE_PAR_DEFAUT.acier };
  for (const [nuance, v] of Object.entries(acier as Record<string, unknown>)) {
    if (!(nuance in GRILLE_PAR_DEFAUT.acier) || !nombre(v)) return null;
    prixAcier[nuance] = v;
  }
  const out: Record<string, unknown> = { acier: prixAcier };
  for (const k of Object.keys(GRILLE_PAR_DEFAUT) as (keyof GrillePrix)[]) {
    if (k === 'acier') continue;
    // Un champ ajouté depuis l'enregistrement prend sa valeur par défaut.
    const v = r[k] === undefined ? GRILLE_PAR_DEFAUT[k] : r[k];
    if (!nombre(v)) return null;
    out[k] = v;
  }
  return out as unknown as GrillePrix;
}
