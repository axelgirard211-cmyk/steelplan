import { GRADE_IDS } from '../catalog/grades';
import { ZONES_NEIGE } from '../climat/neige';
import { TERRAINS, ZONES_VENT } from '../climat/vent';
import { CLASSES_EXECUTION } from '../model/atelier';
import type { BracingShape } from '../model/bracing';
import { BOLT_DIAMETERS, type BoltClass, type ClasseBeton } from '../model/connections';
import { DEFAULT_PROJECT } from '../model/defaults';
import type { PreparationSurface, TypeFinition } from '../model/finition';
import type { BaseFixity } from '../model/frame';
import type { RoofType, SlopeUnit } from '../model/grid';
import { FACES_OUVERTURE, type Ouverture, type TypeOuverture } from '../model/ouvertures';
import type { SpacingMode } from '../model/secondary';
import type { TrussType } from '../model/truss';
import type { SoudureSemelles } from '../geometry/weld';
import type { FreeMember, ProjectParams, Revision } from '../model/project';
import { validateProject, type Issue } from '../model/validate';
import { lireRetouches } from './lireRetouches';
import { CURRENT_VERSION, FormatError, migrate } from './migrate';

/** Extension et type MIME du format de projet. */
export const PROJECT_EXTENSION = '.steelplan';
export const PROJECT_MIME = 'application/json';

/** Sérialise un projet. Le JSON produit est lisible et diffable. */
export function serializeProject(p: ProjectParams): string {
  return JSON.stringify({ ...p, version: CURRENT_VERSION }, null, 2);
}

export interface LoadResult {
  readonly project: ProjectParams;
  /** Anomalies détectées ; le projet reste utilisable si aucune n'est bloquante. */
  readonly issues: readonly Issue[];
}

/**
 * Relit un projet.
 *
 * Stratégie : les champs absents prennent la valeur par défaut (un fichier
 * ancien reste lisible), mais un champ présent avec un type incohérent est une
 * erreur de format — mieux vaut refuser que dessiner un plan à partir d'une
 * donnée corrompue.
 */
export function deserializeProject(text: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FormatError('Fichier illisible : ce n’est pas du JSON valide.');
  }

  const migrated = migrate(raw);
  const project = mergeWithDefaults(DEFAULT_PROJECT, migrated, '') as ProjectParams;
  return { project, issues: validateProject(project) };
}

/**
 * Recouvre les valeurs par défaut avec celles du fichier, en contrôlant les
 * types feuille par feuille. `path` sert uniquement aux messages d'erreur.
 */
function mergeWithDefaults(def: unknown, raw: unknown, path: string): unknown {
  if (raw === undefined) return def;

  if (Array.isArray(def)) {
    if (!Array.isArray(raw)) throw typeError(path, 'une liste', raw);
    // Les barres libres ont leur propre lecteur : elles portent un identifiant
    // et une géométrie qu'on ne peut pas gabariter sur une valeur par défaut.
    if (path === 'freeMembers') return raw.map((m, i) => parseFreeMember(m, `freeMembers[${i}]`));

    /*
     * ⚠ Les ouvertures ont elles aussi leur lecteur, et pour une raison
     * différente : leur liste par défaut est VIDE. Sans gabarit à en tirer, la
     * relecture tombait dans la branche des nombres et refusait tout fichier
     * contenant un portail — exactement le défaut qui avait déjà rendu illisible
     * chaque projet enregistré le jour où les couches de peinture sont arrivées.
     * Une liste par défaut vide est donc un piège, pas un cas particulier.
     */
    if (path === 'ouvertures.items') {
      return raw.map((o, i) => parseOuverture(o, `ouvertures.items[${i}]`));
    }
    // Les retouches des planches : entités de dessin, relues sur leur propre lecteur.
    if (path === 'retouches') return lireRetouches(raw, path);
    // Même piège, même remède : l'historique des indices est vide par défaut.
    if (path === 'meta.revisions') {
      return raw.map((r, i) => parseRevision(r, `meta.revisions[${i}]`));
    }

    /*
     * ⚠ Toute autre liste d'objets se relit sur le GABARIT que constitue son
     * premier élément par défaut — les couches de peinture, par exemple, dont le
     * nombre varie d'un système à l'autre. Sans cette branche, ajouter au modèle
     * la moindre liste d'objets rendait illisible tout fichier enregistré : le
     * lecteur tombait dans la branche des nombres et refusait le fichier.
     */
    const gabarit = def[0];
    if (gabarit !== null && typeof gabarit === 'object') {
      return raw.map((v, i) => mergeWithDefaults(gabarit, v, `${path}[${i}]`));
    }

    // Listes de nombres (indices de travées contreventées).
    return raw.map((v, i) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw typeError(`${path}[${i}]`, 'un nombre', v);
      return v;
    });
  }

  if (def !== null && typeof def === 'object') {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw typeError(path, 'un objet', raw);
    }
    const d = def as Record<string, unknown>;
    const r = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(d)) {
      out[k] = mergeWithDefaults(d[k], r[k], path ? `${path}.${k}` : k);
    }
    return out;
  }

  const attendu = typeof def;
  if (typeof raw !== attendu) throw typeError(path, traduire(attendu), raw);
  if (attendu === 'number' && !Number.isFinite(raw as number)) {
    throw new FormatError(`Champ « ${path} » : valeur numérique invalide (${String(raw)}).`);
  }
  const permis = enumerationDe(path);
  if (permis && !permis.includes(raw as string | number)) {
    throw new FormatError(
      `Champ « ${path} » : valeur ${JSON.stringify(raw)} inconnue (attendu : ${permis.join(', ')}).`,
    );
  }
  return raw;
}

/*
 * ÉNUMÉRATIONS — liste blanche à la relecture.
 *
 * ⚠ Le contrôle de TYPE ne suffit pas : « toString » est bien un texte, et une
 * nuance « toString » allait chercher une fonction d'Object.prototype dans la
 * table des aciers ; un mode de pannes « bogus » laissait le générateur choisir
 * une branche au hasard. Tout champ à valeurs fermées est donc confronté à sa
 * liste, et le fichier refusé en nommant le chemin fautif.
 */
type Valeurs = readonly (string | number)[];
const SPACING: readonly SpacingMode[] = ['entraxe', 'nombre'];
const FORMES: readonly BracingShape[] = ['croix', 'diagonale', 'k'];
const CLASSES_BOULON: readonly BoltClass[] = ['8.8', '10.9'];
const SOUDURES: readonly SoudureSemelles[] = ['angle', 'pleine-penetration'];

/** Par chemin complet, les indices de liste ramenés à « [] ». */
const ENUMERATIONS: Readonly<Record<string, Valeurs>> = {
  'grid.roofType': ['bipente', 'monopente'] satisfies RoofType[],
  'grid.slopeUnit': ['pourcent', 'degres'] satisfies SlopeUnit[],
  'frame.baseFixity': ['articule', 'encastre'] satisfies BaseFixity[],
  'truss.type': ['warren', 'pratt', 'howe', 'polonceau'] satisfies TrussType[],
  'secondary.purlins.mode': SPACING,
  'secondary.rails.mode': SPACING,
  'secondary.gablePosts.mode': SPACING,
  'ouvertures.items[].face': FACES_OUVERTURE,
  'ouvertures.items[].type': ['portail', 'porte', 'chassis'] satisfies TypeOuverture[],
  'bracing.roof.shape': FORMES,
  'bracing.wall.shape': FORMES,
  'bracing.gable.shape': FORMES,
  'connections.rafterToColumn.soudureSemelles': SOUDURES,
  'connections.ridge.soudureSemelles': SOUDURES,
  'connections.columnBase.concrete': ['C20/25', 'C25/30', 'C30/37', 'C35/45', 'C40/50'] satisfies ClasseBeton[],
  'finition.type': ['peinture', 'galvanisation', 'brut'] satisfies TypeFinition[],
  'finition.preparation': ['Sa 3', 'Sa 2½', 'Sa 2', 'St 3', 'St 2'] satisfies PreparationSurface[],
  'finition.categorie': ['C1', 'C2', 'C3', 'C4', 'C5'],
  'atelier.classeExecution': CLASSES_EXECUTION,
  'site.mode': ['manuel', 'eurocode'],
  'site.zoneNeige': ZONES_NEIGE,
  'site.zoneVent': ZONES_VENT,
  'site.terrain': TERRAINS,
};

/** Les valeurs permises d'un champ, ou `undefined` s'il est libre. */
function enumerationDe(path: string): Valeurs | undefined {
  const norme = path.replace(/\[\d+\]/g, '[]');
  if (Object.hasOwn(ENUMERATIONS, norme)) return ENUMERATIONS[norme];
  // Toute nuance, où qu'elle soit (portique, pannes, barres libres…).
  if (norme === 'grade' || norme.endsWith('.grade')) return GRADE_IDS;
  // Tout boulon de la rubrique Assemblages : diamètre et classe normalisés.
  if (/(?:^|\.)(?:bolt|secondaryBolt)\.d$/.test(norme)) return BOLT_DIAMETERS;
  if (/(?:^|\.)(?:bolt|secondaryBolt)\.cls$/.test(norme)) return CLASSES_BOULON;
  return undefined;
}

function parseFreeMember(raw: unknown, path: string): FreeMember {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw typeError(path, 'un objet', raw);
  }
  const gabarit: FreeMember = {
    id: '',
    profile: 'IPE 200',
    grade: 'S235',
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 0, z: 0 },
    rotation: 0,
    label: '',
  };
  return mergeWithDefaults(gabarit, raw, path) as FreeMember;
}

/** Une ouverture de façade, relue sur un gabarit explicite. */
function parseOuverture(raw: unknown, path: string): Ouverture {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw typeError(path, 'un objet', raw);
  }
  const gabarit: Ouverture = {
    id: '',
    face: 'long-pan-gauche',
    type: 'porte',
    position: 0,
    largeur: 0,
    hauteur: 0,
    allege: 0,
  };
  return mergeWithDefaults(gabarit, raw, path) as Ouverture;
}

/** Une diffusion de l'historique des indices, relue sur un gabarit explicite. */
function parseRevision(raw: unknown, path: string): Revision {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw typeError(path, 'un objet', raw);
  }
  const gabarit: Revision = { indice: '', date: '', objet: '', auteur: '' };
  return mergeWithDefaults(gabarit, raw, path) as Revision;
}

function traduire(t: string): string {
  return t === 'number' ? 'un nombre' : t === 'string' ? 'un texte' : t === 'boolean' ? 'un booléen' : t;
}

function typeError(path: string, attendu: string, recu: unknown): FormatError {
  const ou = path === '' ? 'à la racine du fichier' : `pour le champ « ${path} »`;
  return new FormatError(`Format incorrect ${ou} : ${attendu} était attendu, reçu ${JSON.stringify(recu)}.`);
}

export { FormatError, CURRENT_VERSION };
