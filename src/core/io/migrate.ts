/**
 * Migrations du format de fichier.
 *
 * Règle : un fichier .steelplan enregistré aujourd'hui doit rester ouvrable
 * dans dix ans. Chaque évolution du schéma incrémente CURRENT_VERSION et ajoute
 * une fonction de migration ; on ne modifie JAMAIS une migration déjà publiée.
 */

export const CURRENT_VERSION = 1;

/** Une migration transforme un projet de la version `n` vers `n + 1`. */
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations indexées par version de départ.
 * Vide pour l'instant : le format n'a pas encore évolué.
 */
const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
  }
}

/** Amène un projet brut à la version courante du schéma. */
export function migrate(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new FormatError('Le fichier ne contient pas un projet SteelPlan.');
  }
  let obj = raw as Record<string, unknown>;
  const v = obj['version'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new FormatError('Numéro de version du fichier absent ou invalide.');
  }
  if (v > CURRENT_VERSION) {
    throw new FormatError(
      `Fichier enregistré avec une version plus récente de SteelPlan (format ${v}, cette version lit jusqu'au format ${CURRENT_VERSION}).`,
    );
  }

  let cur = v;
  while (cur < CURRENT_VERSION) {
    const m = MIGRATIONS[cur];
    if (!m) throw new FormatError(`Migration manquante du format ${cur} vers ${cur + 1}.`);
    obj = m(obj);
    cur += 1;
    obj['version'] = cur;
  }
  return obj;
}
