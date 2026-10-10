import { pt, type Pt } from '../../core/drawing/scene';

/**
 * SAISIE AU CLAVIER, comme dans un logiciel de DAO.
 *
 * Les valeurs se tapent en millimètres RÉELS — ceux de l'ouvrage — et sont
 * ramenées au papier par l'échelle de la planche : sur un détail au 1:10, taper
 * 200 trace 20 mm de papier, c'est-à-dire les 200 mm de la platine.
 *
 * Conventions de la DAO, point décimal et virgule séparatrice :
 *  - `@dx,dy` ou `dx,dy` : déplacement relatif depuis le dernier point ;
 *  - `@d<a` ou `d<a`     : distance et angle (degrés, sens trigonométrique) ;
 *  - `d`                 : distance dans la direction du pointeur (saisie directe),
 *                          ou valeur demandée — rayon, angle, facteur.
 */

export type Saisie =
  | { readonly type: 'relatif'; readonly dx: number; readonly dy: number; readonly arobase: boolean }
  | { readonly type: 'polaire'; readonly d: number; readonly angle: number }
  | { readonly type: 'nombre'; readonly v: number }
  | { readonly type: 'mot'; readonly texte: string };

const NOMBRE = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;
const RELATIF = new RegExp(String.raw`^@?\s*(${NOMBRE})\s*,\s*(${NOMBRE})$`);
const POLAIRE = new RegExp(String.raw`^@?\s*(${NOMBRE})\s*<\s*(${NOMBRE})$`);
const SEUL = new RegExp(String.raw`^(${NOMBRE})$`);

export function lireSaisie(brut: string): Saisie {
  const s = brut.trim();
  let m = RELATIF.exec(s);
  if (m) return { type: 'relatif', dx: Number(m[1]), dy: Number(m[2]), arobase: s.startsWith('@') };
  m = POLAIRE.exec(s);
  if (m) return { type: 'polaire', d: Number(m[1]), angle: Number(m[2]) };
  m = SEUL.exec(s);
  if (m) return { type: 'nombre', v: Number(m[1]) };
  return { type: 'mot', texte: s };
}

/**
 * Point désigné par une saisie, depuis une base, ou `null` si la saisie n'est
 * pas un point. Sans base, `x,y` se lit en millimètres papier depuis le coin bas
 * gauche de la feuille ; `@x,y` est refusé.
 */
export function pointSaisi(s: Saisie, base: Pt | null, curseur: Pt, echelle: number): Pt | null {
  const k = 1 / echelle;
  // « @ » sans point de départ n'a pas de sens : refusé plutôt que lu en absolu.
  if (s.type === 'relatif') return base ? pt(base.x + s.dx * k, base.y + s.dy * k) : s.arobase ? null : pt(s.dx, s.dy);
  if (!base) return null;
  if (s.type === 'polaire') {
    const a = (s.angle * Math.PI) / 180;
    return pt(base.x + s.d * k * Math.cos(a), base.y + s.d * k * Math.sin(a));
  }
  if (s.type === 'nombre') {
    const dx = curseur.x - base.x;
    const dy = curseur.y - base.y;
    const l = Math.hypot(dx, dy);
    // Pointeur sur la base : pas de direction, on part vers la droite.
    const ux = l > 1e-9 ? dx / l : 1;
    const uy = l > 1e-9 ? dy / l : 0;
    return pt(base.x + ux * s.v * k, base.y + uy * s.v * k);
  }
  return null;
}
