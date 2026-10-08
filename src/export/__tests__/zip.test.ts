import { describe, expect, it } from 'vitest';
import { zip } from '../zip';

/**
 * Lecture d'une archive EN SUIVANT LE RÉPERTOIRE CENTRAL, comme le fait un outil
 * strict — et non en parcourant les en-têtes locaux de proche en proche.
 *
 * ⚠ C'est la seule lecture qui démasque un décalage. Un lecteur qui avance
 * d'en-tête en en-tête retombe sur ses pieds même quand les offsets annoncés
 * sont faux : l'archive lui paraît saine, et elle est refusée par la machine de
 * l'atelier. La première version de `zip` laissait ainsi sept octets nuls
 * derrière chaque en-tête ; elle s'ouvrait dans l'explorateur et nulle part
 * ailleurs.
 */
async function relire(b: Blob): Promise<{ nom: string; contenu: string }[]> {
  const octets = new Uint8Array(await b.arrayBuffer());
  const v = new DataView(octets.buffer);
  const dec = new TextDecoder();

  // Fin du répertoire central : les 22 derniers octets, sans commentaire.
  const fin = octets.length - 22;
  expect(v.getUint32(fin, true)).toBe(0x06054b50);
  const nb = v.getUint16(fin + 10, true);
  let o = v.getUint32(fin + 16, true);

  const out: { nom: string; contenu: string }[] = [];
  for (let i = 0; i < nb; i += 1) {
    expect(v.getUint32(o, true)).toBe(0x02014b50);
    const crcAnnonce = v.getUint32(o + 16, true);
    const taille = v.getUint32(o + 24, true);
    const lNom = v.getUint16(o + 28, true);
    const local = v.getUint32(o + 42, true);

    // On saute à l'en-tête local ANNONCÉ : c'est lui qui doit être juste.
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const lNomLocal = v.getUint16(local + 26, true);
    const lExtra = v.getUint16(local + 28, true);
    const debut = local + 30 + lNomLocal + lExtra;
    const data = octets.slice(debut, debut + taille);

    expect(crc32(data)).toBe(crcAnnonce);
    out.push({
      nom: dec.decode(octets.slice(local + 30, local + 30 + lNomLocal)),
      contenu: dec.decode(data),
    });
    o += 46 + lNom + v.getUint16(o + 30, true) + v.getUint16(o + 32, true);
  }
  return out;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const octet of data) {
    c ^= octet;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ================================================================== */

describe('archive ZIP', () => {
  const ENTREES = [
    { nom: 'PO1.nc1', contenu: 'ST\n  IPE 400\nEN\n' },
    { nom: 'TR1.nc1', contenu: 'ST\n  IPE 360\nBO\n  v  120.00  200.00  22.00  0.00\nEN\n' },
    { nom: 'CV3.nc1', contenu: 'ST\n  L 60x60x6\nEN\n' },
  ];

  it('restitue chaque fichier à l’identique', async () => {
    expect(await relire(zip(ENTREES))).toEqual(ENTREES);
  });

  it('annonce des décalages exacts, nom de fichier compris', async () => {
    /*
     * Le nom le plus long est celui qui révèle le défaut : c'est de sa longueur
     * que les offsets décalaient. Des noms de tailles différentes désalignent
     * chaque entrée d'une valeur différente.
     */
    const varie = [
      { nom: 'A.nc1', contenu: 'un' },
      { nom: 'REPERE-TRES-LONG-12345.nc1', contenu: 'deux' },
      { nom: 'B.nc1', contenu: 'trois' },
    ];
    expect(await relire(zip(varie))).toEqual(varie);
  });

  it('accepte une archive vide sans produire d’octets parasites', async () => {
    const b = zip([]);
    expect(b.size).toBe(22);
    expect(await relire(b)).toEqual([]);
  });

  it('encode les accents en UTF-8, pas en latin-1', async () => {
    const e = [{ nom: 'poutre-ferrée.nc1', contenu: 'Épure à 45°\n' }];
    expect(await relire(zip(e))).toEqual(e);
  });
});
