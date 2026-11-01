/**
 * ÉCRITURE D'UNE ARCHIVE ZIP, sans compression.
 *
 * ⚠ Un lot DSTV n'est PAS un fichier, c'est une COLLECTION de fichiers : la
 * machine en lit un par pièce. Les concaténer produirait un texte qu'aucune
 * commande numérique ne sait découper, et les télécharger un à un se heurte au
 * blocage des téléchargements multiples par le navigateur. L'archive est donc le
 * seul emballage qui préserve des fichiers réellement séparés.
 *
 * Seule la méthode « stored » est écrite — les données sont copiées telles
 * quelles, sans compression. Du NC1 est du texte court et peu répétitif ; le
 * dégonflage y gagnerait peu, et le coder demanderait un DEFLATE complet dont
 * chaque erreur produirait une archive acceptée par l'outil qui l'écrit et
 * refusée par celui qui la lit.
 */

import { dxfEnOctets } from './dxf';

interface Entree {
  readonly nom: string;
  readonly contenu: string;
}

/*
 * ⚠ Tailles FIXES des en-têtes, nom de fichier NON compris : le nom est écrit
 * juste après, comme un bloc à part. Les dimensionner à « en-tête + nom »
 * laissait derrière chaque en-tête autant d'octets nuls que le nom est long.
 * L'archive s'ouvrait quand même dans l'explorateur, qui rattrape le décalage,
 * et se refusait à l'outil strict qui lit le répertoire central — soit
 * exactement l'atelier, qui recevait un lot vide.
 */
const TAILLE_ENTETE = 30;
const TAILLE_CENTRAL = 46;

/** Archive ZIP contenant les fichiers donnés, à la racine. */
export function zip(entrees: readonly Entree[]): Blob {
  const encodeur = new TextEncoder();
  const locaux: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let decalage = 0;

  for (const e of entrees) {
    const nom = encodeur.encode(e.nom);
    // Un DXF annonce Windows-1252 dans son en-tête : ses octets doivent l'être.
    const data = e.nom.toLowerCase().endsWith('.dxf') ? dxfEnOctets(e.contenu) : encodeur.encode(e.contenu);
    const crc = crc32(data);

    /*
     * ⚠ Le répertoire central porte le DÉCALAGE de chaque en-tête local. Le
     * calculer après coup, ou oublier de l'avancer d'une entrée, produit une
     * archive que la plupart des outils ouvrent quand même — en lisant le
     * mauvais fichier. C'est pour cela qu'il est tenu au fil de l'écriture.
     */
    const entete = bloc(TAILLE_ENTETE, (v, o) => {
      v.setUint32(o, 0x04034b50, true); // signature d'en-tête local
      v.setUint16(o + 4, 20, true); // version minimale
      v.setUint16(o + 6, 0, true); // pas de drapeau
      v.setUint16(o + 8, 0, true); // méthode 0 : stored
      v.setUint16(o + 10, 0, true); // heure
      v.setUint16(o + 12, 0x21, true); // date : 1er janvier 1980, minimum du format
      v.setUint32(o + 14, crc, true);
      v.setUint32(o + 18, data.length, true); // taille compressée
      v.setUint32(o + 22, data.length, true); // taille d'origine, la même
      v.setUint16(o + 26, nom.length, true);
      v.setUint16(o + 28, 0, true); // pas de champ supplémentaire
    });
    locaux.push(entete, nom, data);

    central.push(
      bloc(TAILLE_CENTRAL, (v, o) => {
        v.setUint32(o, 0x02014b50, true); // signature de répertoire
        v.setUint16(o + 4, 20, true); // version d'écriture
        v.setUint16(o + 6, 20, true); // version minimale de lecture
        v.setUint16(o + 8, 0, true);
        v.setUint16(o + 10, 0, true);
        v.setUint16(o + 12, 0, true);
        v.setUint16(o + 14, 0x21, true);
        v.setUint32(o + 16, crc, true);
        v.setUint32(o + 20, data.length, true);
        v.setUint32(o + 24, data.length, true);
        v.setUint16(o + 28, nom.length, true);
        v.setUint16(o + 30, 0, true); // champ supplémentaire
        v.setUint16(o + 32, 0, true); // commentaire
        v.setUint16(o + 34, 0, true); // numéro de disque
        v.setUint16(o + 36, 0, true); // attributs internes
        v.setUint32(o + 38, 0, true); // attributs externes
        v.setUint32(o + 42, decalage, true);
      }),
      nom,
    );

    decalage += TAILLE_ENTETE + nom.length + data.length;
  }

  const tailleCentral = central.reduce((s, b) => s + b.length, 0);
  const fin = bloc(22, (v, o) => {
    v.setUint32(o, 0x06054b50, true); // fin de répertoire central
    v.setUint16(o + 4, 0, true); // disque courant
    v.setUint16(o + 6, 0, true); // disque du répertoire
    v.setUint16(o + 8, entrees.length, true);
    v.setUint16(o + 10, entrees.length, true);
    v.setUint32(o + 12, tailleCentral, true);
    v.setUint32(o + 16, decalage, true);
    v.setUint16(o + 20, 0, true); // pas de commentaire
  });

  return new Blob([assembler([...locaux, ...central, fin])], { type: 'application/zip' });
}

/** Concatène les morceaux en un seul tampon contigu. */
function assembler(morceaux: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = morceaux.reduce((s, m) => s + m.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const m of morceaux) {
    out.set(m, o);
    o += m.length;
  }
  return out;
}

/** Un bloc d'octets rempli par l'écrivain donné. */
function bloc(taille: number, ecrire: (v: DataView, o: number) => void): Uint8Array {
  const b = new Uint8Array(taille);
  ecrire(new DataView(b.buffer), 0);
  return b;
}

/**
 * CRC-32, polynôme du format ZIP.
 *
 * ⚠ Une somme fausse donne une archive que l'explorateur ouvre parfois sans
 * broncher, mais que les outils stricts refusent en bloc — et l'atelier reçoit
 * alors un lot vide sans savoir pourquoi.
 */
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const octet of data) {
    c ^= octet;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
