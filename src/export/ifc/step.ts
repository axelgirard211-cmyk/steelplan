/**
 * ÉCRITURE STEP — ISO 10303-21, le format physique des fichiers IFC.
 *
 * ⚠ Trois règles que les lecteurs appliquent sans tolérance, et qu'un fichier
 * « qui a l'air juste » viole facilement :
 *  - un réel porte TOUJOURS un point : « 1. » et non « 1 », qui serait un
 *    entier et ferait rejeter l'entité entière ;
 *  - une chaîne n'admet que l'ASCII imprimable : « é » s'écrit \X2\00E9\X0\,
 *    l'apostrophe se double, la barre oblique inverse aussi ;
 *  - chaque entité a un nombre d'attributs FIXE, les absents valant « $ ».
 */

export interface Ref {
  readonly '#': number;
}

/** Valeur d'énumération, écrite .VALEUR. */
export interface Enum {
  readonly enum: string;
}

/** Entier — un nombre JavaScript s'écrit sinon en réel. */
export interface Entier {
  readonly entier: number;
}

/** Valeur typée, ex. IFCLABEL('S235') dans une propriété. */
export interface Type {
  readonly type: string;
  readonly v: Valeur;
}

/** `null` : absent ($) ; '*' : attribut dérivé, recalculé par le lecteur. */
export type Valeur = null | '*' | number | boolean | string | Ref | Enum | Entier | Type | readonly Valeur[];

export const en = (v: string): Enum => ({ enum: v });
export const entier = (v: number): Entier => ({ entier: Math.round(v) });
export const type = (t: string, v: Valeur): Type => ({ type: t, v });

const estRef = (v: object): v is Ref => '#' in v;

/** Réel au format STEP : point obligatoire, exposant en « E ». */
export function reel(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`Réel non fini dans le fichier IFC : ${v}`);
  // Au millionième de millimètre : au-delà, ce n'est que du bruit de calcul,
  // et c'est lui qui écrivait « -0. » ou « 1.0000000000000002 ».
  const r = Math.round(v * 1e6) / 1e6;
  const t = String(Object.is(r, -0) ? 0 : r);
  if (t.includes('e')) {
    const [m, e] = t.split('e') as [string, string];
    return `${m.includes('.') ? m : `${m}.`}E${e}`;
  }
  return t.includes('.') ? t : `${t}.`;
}

/** Chaîne STEP : ASCII imprimable, le reste en \X2\…\X0\ (UTF-16). */
export function chaine(t: string): string {
  let out = '';
  let large = '';
  const vider = (): void => {
    if (large) out += `\\X2\\${large}\\X0\\`;
    large = '';
  };
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    // Hors du plan multilingue de base (émoji…) : \X2\ ne sait pas l'écrire.
    if (c >= 0xd800 && c <= 0xdfff) {
      vider();
      out += '?';
      if (c < 0xdc00) i++;
    } else if (c >= 0x20 && c <= 0x7e) {
      vider();
      const ch = t[i] as string;
      out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch;
    } else {
      large += c.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  vider();
  return `'${out}'`;
}

export function valeur(v: Valeur): string {
  if (v === null) return '$';
  if (v === '*') return '*';
  if (typeof v === 'number') return reel(v);
  if (typeof v === 'boolean') return v ? '.T.' : '.F.';
  if (typeof v === 'string') return chaine(v);
  if (Array.isArray(v)) return `(${v.map(valeur).join(',')})`;
  const o = v as Exclude<Valeur, null | string | number | boolean | readonly Valeur[]>;
  if (estRef(o)) return `#${o['#']}`;
  if ('enum' in o) return `.${o.enum}.`;
  if ('entier' in o) return String(o.entier);
  return `${o.type}(${valeur(o.v)})`;
}

/** Fichier en cours d'écriture : une ligne par entité, numérotée dans l'ordre. */
export class FichierStep {
  private readonly lignes: string[] = [];

  /** Ajoute une entité et rend sa référence. */
  ajouter(nom: string, ...attributs: Valeur[]): Ref {
    const n = this.lignes.length + 1;
    this.lignes.push(`#${n}=${nom}(${attributs.map(valeur).join(',')});`);
    return { '#': n };
  }

  get nombre(): number {
    return this.lignes.length;
  }

  /** Le fichier complet, en-tête compris. */
  ecrire(entete: EnteteStep): string {
    return [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION((${chaine(entete.vue)}),'2;1');`,
      `FILE_NAME(${[
        chaine(entete.nom),
        chaine(entete.horodatage),
        `(${chaine(entete.auteur)})`,
        `(${chaine(entete.organisation)})`,
        chaine(entete.preprocesseur),
        chaine(entete.application),
        chaine(''),
      ].join(',')});`,
      `FILE_SCHEMA((${chaine(entete.schema)}));`,
      'ENDSEC;',
      'DATA;',
      ...this.lignes,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }
}

export interface EnteteStep {
  /** Définition de vue déclarée, ex. « ViewDefinition [DesignTransferView] ». */
  readonly vue: string;
  readonly nom: string;
  /** Date ISO 8601 de l'export. */
  readonly horodatage: string;
  readonly auteur: string;
  readonly organisation: string;
  readonly preprocesseur: string;
  readonly application: string;
  readonly schema: string;
}
