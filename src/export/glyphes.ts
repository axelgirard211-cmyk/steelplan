/**
 * TEXTE IMPRIMABLE — ce que la police du PDF et le DXF R12 savent écrire.
 *
 * ⚠ Le PDF est écrit en Helvetica standard et le DXF R12 en page de code
 * Windows-1252 : ni l'un ni l'autre ne connaît « ⚠ », les lettres grecques de la
 * note de calcul, les exposants ou l'espace fine des milliers. L'écran les
 * affichait ; le papier les imprimait en charabia — sur la note de calcul et le
 * plan de fondations, c'est-à-dire là où un « λ » illisible rend la ligne
 * fausse. On les translittère à l'écriture, avec UNE table.
 */
const TABLE: Readonly<Record<string, string>> = {
  '⚠': '(!)',
  '⁻': '-',
  '⁺': '+',
  ' ': ' ', // espace fine insécable → insécable
  ' ': ' ',
  ' ': ' ',
  '≥': '>=',
  '≤': '<=',
  '≈': '~',
  '→': '->',
  '∞': 'inf',
  '√': 'rac',
  '☐': '[ ]',
  'α': 'alpha',
  'β': 'beta',
  'γ': 'gamma',
  'δ': 'delta',
  'Δ': 'Delta',
  'ε': 'eps',
  'η': 'eta',
  'λ': 'lambda',
  'μ': 'µ', // mu grec → signe micro, qui est dans le jeu
  'π': 'pi',
  'ρ': 'rho',
  'σ': 'sigma',
  'Σ': 'Somme',
  'τ': 'tau',
  'φ': 'phi',
  'χ': 'chi',
  'ψ': 'psi',
  'ω': 'omega',
  '⁰': '0',
  '⁴': '4',
  '₀': '0',
  '₁': '1',
  '₂': '2',
};

const HORS_LATIN1 = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Le caractère est-il dans Windows-1252 ? */
export function imprimable(c: string): boolean {
  const n = c.codePointAt(0) as number;
  return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || HORS_LATIN1.has(c);
}

/** Le caractère s'écrit-il, tel quel ou par la table ? */
export function transcriptible(c: string): boolean {
  return imprimable(c) || c in TABLE;
}

/** Le texte, ramené à ce que Windows-1252 sait écrire ; « ? » pour l'inconnu. */
export function versCp1252(t: string): string {
  let out = '';
  for (const c of t) out += imprimable(c) ? c : (TABLE[c] ?? '?');
  return out;
}
