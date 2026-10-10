/**
 * LECTURE STEP pour les contrôles : relit un fichier ISO 10303-21 entité par
 * entité, comme le ferait un lecteur strict. Toute ligne mal formée lève une
 * erreur au lieu d'être ignorée.
 */

export type V =
  | null
  | '*'
  | number
  | boolean
  | string
  | { readonly ref: number }
  | { readonly enum: string }
  | { readonly type: string; readonly v: V }
  | V[];

export interface Lu {
  readonly nom: string;
  readonly attrs: V[];
}

export function lireStep(texte: string): Map<number, Lu> {
  const debut = texte.indexOf('\nDATA;\n');
  const fin = texte.indexOf('\nENDSEC;\nEND-ISO-10303-21;');
  if (debut < 0 || fin < 0) throw new Error('Section DATA introuvable.');
  const out = new Map<number, Lu>();
  for (const ligne of texte.slice(debut + 7, fin).split('\n')) {
    const m = /^#(\d+)=([A-Z0-9_]+)\((.*)\);$/.exec(ligne);
    if (!m) throw new Error(`Ligne STEP mal formée : ${ligne.slice(0, 120)}`);
    const id = Number(m[1]);
    if (out.has(id)) throw new Error(`Entité #${id} définie deux fois.`);
    const lecteur = { t: m[3] as string, i: 0 };
    const attrs = liste(lecteur, ')');
    if (lecteur.i !== lecteur.t.length) throw new Error(`Reste illisible dans #${id} : ${lecteur.t.slice(lecteur.i, lecteur.i + 40)}`);
    out.set(id, { nom: m[2] as string, attrs });
  }
  return out;
}

/** Toutes les références contenues dans une valeur, à toute profondeur. */
export function refs(v: readonly V[]): number[] {
  const out: number[] = [];
  const visiter = (x: V): void => {
    if (Array.isArray(x)) x.forEach(visiter);
    else if (x !== null && typeof x === 'object') {
      if ('ref' in x) out.push(x.ref);
      else if ('v' in x) visiter(x.v);
    }
  };
  v.forEach(visiter);
  return out;
}

interface Lecteur {
  readonly t: string;
  i: number;
}

function liste(l: Lecteur, fermeture: string): V[] {
  const out: V[] = [];
  if (l.t[l.i] === fermeture || (fermeture === ')' && l.i === l.t.length)) return out;
  for (;;) {
    out.push(valeur(l));
    if (l.t[l.i] === ',') {
      l.i++;
      continue;
    }
    if (fermeture === ')' && l.i === l.t.length) return out;
    if (l.t[l.i] === fermeture) return out;
    throw new Error(`Séparateur attendu à ${l.i} : ${l.t.slice(l.i, l.i + 30)}`);
  }
}

function valeur(l: Lecteur): V {
  const c = l.t[l.i];
  if (c === '$') {
    l.i++;
    return null;
  }
  if (c === '*') {
    l.i++;
    return '*';
  }
  if (c === '#') {
    const m = /^#(\d+)/.exec(l.t.slice(l.i)) as RegExpExecArray;
    l.i += m[0].length;
    return { ref: Number(m[1]) };
  }
  if (c === "'") {
    let out = '';
    l.i++;
    for (;;) {
      const ch = l.t[l.i];
      if (ch === undefined) throw new Error('Chaîne non fermée.');
      if (ch === "'") {
        if (l.t[l.i + 1] === "'") {
          out += "'";
          l.i += 2;
          continue;
        }
        l.i++;
        return decoder(out);
      }
      out += ch;
      l.i++;
    }
  }
  if (c === '.') {
    const m = /^\.([A-Z0-9_]+)\./.exec(l.t.slice(l.i));
    if (!m) throw new Error(`Énumération mal formée à ${l.i}.`);
    l.i += m[0].length;
    if (m[1] === 'T' || m[1] === 'F') return m[1] === 'T';
    return { enum: m[1] as string };
  }
  if (c === '(') {
    l.i++;
    const v = liste(l, ')');
    l.i++;
    return v;
  }
  const nombre = /^[-+]?\d+(\.\d*)?(E[-+]?\d+)?/.exec(l.t.slice(l.i));
  if (nombre) {
    l.i += nombre[0].length;
    return Number(nombre[0]);
  }
  const typee = /^([A-Z0-9_]+)\(/.exec(l.t.slice(l.i));
  if (typee) {
    l.i += typee[0].length;
    const v = valeur(l);
    if (l.t[l.i] !== ')') throw new Error('Valeur typée non fermée.');
    l.i++;
    return { type: typee[1] as string, v };
  }
  throw new Error(`Valeur illisible à ${l.i} : ${l.t.slice(l.i, l.i + 30)}`);
}

/** \X2\…\X0\ → caractères ; \\ → \. */
function decoder(t: string): string {
  return t
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/g, (_, h: string) => String.fromCharCode(...(h.match(/.{4}/g) ?? []).map((x) => parseInt(x, 16))))
    .replace(/\\\\/g, '\\');
}
