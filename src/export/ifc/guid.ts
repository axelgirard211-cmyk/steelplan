/**
 * IDENTIFIANTS IFC — GlobalId de 22 caractères.
 *
 * ⚠ DÉTERMINISTES, et non tirés au hasard. Un identifiant aléatoire changerait à
 * chaque export : le logiciel de synthèse verrait alors, à chaque diffusion,
 * quatre cents pièces supprimées et quatre cents pièces nouvelles, et perdrait
 * les remarques, les clashs résolus et les statuts attachés à chacune. Dérivé du
 * projet et de l'identifiant de la pièce, il reste le même d'un indice à
 * l'autre tant que la pièce existe.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** Empreinte de 128 bits (quatre mots de 32 bits), stable et bien mélangée. */
function empreinte(t: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < t.length; i++) {
    const k = t.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Code `n` sur `chiffres` caractères de l'alphabet IFC (6 bits chacun). */
function base64(n: number, chiffres: number): string {
  let out = '';
  for (let i = chiffres - 1; i >= 0; i--) out += ALPHABET[Math.floor(n / 64 ** i) % 64];
  return out;
}

/**
 * GlobalId d'une clé : 16 octets codés comme le fait buildingSMART — le premier
 * octet sur deux caractères (d'où un premier caractère entre 0 et 3), puis cinq
 * groupes de trois octets sur quatre caractères.
 */
export function guidIfc(cle: string): string {
  const mots = empreinte(cle);
  const octets: number[] = [];
  for (const m of mots) octets.push((m >>> 24) & 255, (m >>> 16) & 255, (m >>> 8) & 255, m & 255);
  let out = base64(octets[0] as number, 2);
  for (let i = 1; i < 16; i += 3) {
    out += base64(((octets[i] as number) << 16) | ((octets[i + 1] as number) << 8) | (octets[i + 2] as number), 4);
  }
  return out;
}

/** Le GlobalId est-il bien formé ? */
export function guidValide(g: string): boolean {
  return /^[0-3][0-9A-Za-z_$]{21}$/.test(g);
}
