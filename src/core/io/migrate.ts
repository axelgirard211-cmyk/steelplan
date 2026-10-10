/**
 * Migrations du format de fichier.
 *
 * Règle : un fichier .steelplan enregistré aujourd'hui doit rester ouvrable
 * dans dix ans. Chaque évolution du schéma incrémente CURRENT_VERSION et ajoute
 * une fonction de migration ; on ne modifie JAMAIS une migration déjà publiée.
 */

export const CURRENT_VERSION = 2;

/** Une migration transforme un projet de la version `n` vers `n + 1`. */
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations indexées par version de départ.
 *
 * ⚠ 1 → 2 : arrivée des retouches du dessinateur. Le champ manquant prendrait
 * de lui-même sa valeur par défaut ; la version change pour l'autre sens : une
 * version antérieure de SteelPlan, qui ignore ce champ, refuse le fichier au
 * lieu de l'ouvrir en perdant les retouches sans un mot.
 */
const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: (raw) => ({ ...raw, retouches: [] }),
};

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
