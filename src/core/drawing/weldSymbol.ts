import type { Weld } from '../geometry/weld';
import { pt, type DrawScene, type Pt } from './scene';

/**
 * Symbole de soudure normalisé (NF EN ISO 2553).
 *
 * Composition : une LIGNE DE REPÈRE qui pointe le cordon par une flèche, une
 * LIGNE DE RÉFÉRENCE horizontale, et le symbole de forme posé dessus. Un triangle
 * rectangle désigne une soudure d'angle. La gorge est écrite AVANT le symbole
 * (« a5 »), la longueur APRÈS (« 350 »), et deux triangles opposés de part et
 * d'autre de la ligne désignent une soudure d'angle double.
 *
 * Le symbole ne fabrique aucune valeur : gorge, longueur et continuité viennent
 * du cordon du modèle, exactement comme une cote vient du modèle et non du
 * dessin.
 */

const LONGUEUR_REF = 26;
const COTE_TRIANGLE = 3.4;
const HAUTEUR_TEXTE = 2.2;

/**
 * Trace le symbole d'un cordon.
 * @param at point du dessin où pointe la flèche (le cordon lui-même)
 * @param ancrage origine de la ligne de référence ; sa direction en découle
 */
export function symboleSoudure(s: DrawScene, at: Pt, ancrage: Pt, w: Weld): void {
  const versLaDroite = ancrage.x >= at.x;
  const signe = versLaDroite ? 1 : -1;
  const finRef = pt(ancrage.x + signe * LONGUEUR_REF, ancrage.y);

  // Ligne de repère (flèche brisée) puis ligne de référence.
  s.ligne(at, ancrage, 'cotation');
  s.ligne(ancrage, finRef, 'cotation');
  flecheSoudure(s, at, ancrage);

  // Symbole de forme, posé au tiers de la ligne de référence.
  const xSym = ancrage.x + signe * (LONGUEUR_REF * 0.42);
  if (w.type === 'angle' || w.type === 'angle-double') {
    triangle(s, pt(xSym, ancrage.y), signe, 1);
    if (w.type === 'angle-double') triangle(s, pt(xSym, ancrage.y), signe, -1);
  } else if (w.type === 'bout-a-bout') {
    // Soudure bout à bout sur chants droits : deux traits parallèles.
    s.ligne(pt(xSym, ancrage.y - COTE_TRIANGLE), pt(xSym, ancrage.y + COTE_TRIANGLE), 'cotation');
    s.ligne(
      pt(xSym + signe * 1.4, ancrage.y - COTE_TRIANGLE),
      pt(xSym + signe * 1.4, ancrage.y + COTE_TRIANGLE),
      'cotation',
    );
  } else {
    s.cercle(pt(xSym, ancrage.y), COTE_TRIANGLE * 0.6, 'cotation');
  }

  // Gorge avant le symbole, longueur après.
  s.texte(pt(xSym - signe * 1.5, ancrage.y + 0.6), `a${w.throat}`, {
    hauteur: HAUTEUR_TEXTE,
    ancrage: versLaDroite ? 'droite' : 'gauche',
  });
  if (w.length > 0 && !w.pourtour) {
    const nb = w.type === 'angle-double' ? '2 × ' : '';
    s.texte(pt(xSym + signe * (COTE_TRIANGLE + 1.5), ancrage.y + 0.6), `${nb}${Math.round(w.length)}`, {
      hauteur: HAUTEUR_TEXTE,
      ancrage: versLaDroite ? 'gauche' : 'droite',
    });
  }

  /*
   * Cordon sur le POURTOUR : le cercle normalisé au coude (ISO 2553). C'est lui,
   * et non une longueur écrite, qui dit au soudeur de faire le tour du profil —
   * écrire « 2 × 1467 » laissait croire à deux cordons rectilignes.
   */
  if (w.pourtour) s.cercle(ancrage, 1.6, 'cotation');

  // Cordon interrompu : le drapeau normalisé au coude de la ligne de repère.
  if (!w.continuous) {
    s.polyligne(
      [
        pt(ancrage.x, ancrage.y),
        pt(ancrage.x, ancrage.y + 4.5),
        pt(ancrage.x + signe * 3, ancrage.y + 3.2),
      ],
      true,
      'cotation',
    );
  }
}

/** Triangle de soudure d'angle, au-dessus (`cote` = 1) ou en dessous de la ligne. */
function triangle(s: DrawScene, base: Pt, signe: number, cote: 1 | -1): void {
  s.remplissage(
    [
      pt(base.x, base.y),
      pt(base.x + signe * COTE_TRIANGLE, base.y),
      pt(base.x, base.y + cote * COTE_TRIANGLE),
    ],
    [],
    0,
    'cotation',
  );
}

/** Pointe de la ligne de repère : une flèche fine, pas la flèche de cotation. */
function flecheSoudure(s: DrawScene, at: Pt, depuis: Pt): void {
  const l = Math.hypot(depuis.x - at.x, depuis.y - at.y);
  if (l < 1e-9) return;
  const ux = (depuis.x - at.x) / l;
  const uy = (depuis.y - at.y) / l;
  const b = pt(at.x + ux * 2.6, at.y + uy * 2.6);
  s.remplissage(
    [pt(at.x, at.y), pt(b.x - uy * 0.8, b.y + ux * 0.8), pt(b.x + uy * 0.8, b.y - ux * 0.8)],
    [],
    0,
    'cotation',
  );
}
