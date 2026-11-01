import { FORMATS, type SheetFormat } from '../core/drawing/layout';
import { hatchLines } from '../core/drawing/hatch';
import { LAYER_STYLES, type DrawEntity, type Pt } from '../core/drawing/scene';
import type { Sheet } from '../core/drawing/sheet';

/**
 * Traduction `DrawScene` → SVG.
 *
 * Ce module ne fait AUCUNE géométrie : il traduit, entité par entité. Toute la
 * construction du dessin a eu lieu en amont, ce qui garantit que le SVG affiché
 * et le PDF imprimé (phase suivante) montreront rigoureusement la même chose.
 *
 * Le repère SVG a son Y vers le bas, celui du dessin vers le haut : on retourne
 * l'axe une fois pour toutes par la hauteur de feuille, et plus jamais ensuite.
 */

export interface SvgOptions {
  /** Couleur du trait ; noir pour l'impression, clair sur fond sombre à l'écran. */
  readonly encre?: string;
  /** Couleur du fond de feuille ; `null` pour un fond transparent. */
  readonly papier?: string | null;
}

export function sheetToSvg(sheet: Sheet, opts: SvgOptions = {}): string {
  const f = FORMATS[sheet.format];
  const encre = opts.encre ?? '#111318';
  const papier = opts.papier === undefined ? '#ffffff' : opts.papier;

  const corps = sheet.scene.entities.map((e) => entiteToSvg(e, f.hauteur, encre, papier)).join('\n');
  const fond =
    papier === null
      ? ''
      : `<rect x="0" y="0" width="${f.largeur}" height="${f.hauteur}" fill="${papier}"/>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f.largeur}mm" height="${f.hauteur}mm"`,
    ` viewBox="0 0 ${f.largeur} ${f.hauteur}" role="img" aria-label="${echapper(sheet.titre)}">`,
    fond,
    `<g stroke-linecap="round" stroke-linejoin="round" fill="none">`,
    corps,
    `</g></svg>`,
  ].join('');
}

/** Dimensions de la feuille, pour dimensionner un conteneur. */
export function tailleFeuille(format: SheetFormat): { largeur: number; hauteur: number } {
  return FORMATS[format];
}

function entiteToSvg(e: DrawEntity, hFeuille: number, encre: string, papier: string | null = '#ffffff'): string {
  const style = LAYER_STYLES[e.layer];
  const trait = `stroke="${encre}" stroke-width="${style.width}"${
    style.dash.length > 0 ? ` stroke-dasharray="${style.dash.join(' ')}"` : ''
  }`;
  const Y = (y: number): number => hFeuille - y;

  switch (e.kind) {
    case 'ligne':
      return `<line x1="${n(e.a.x)}" y1="${n(Y(e.a.y))}" x2="${n(e.b.x)}" y2="${n(Y(e.b.y))}" ${trait}/>`;

    case 'polyligne': {
      const d = cheminDe(e.points, Y, e.fermee);
      return `<path d="${d}" ${trait}/>`;
    }

    case 'cercle':
      return `<circle cx="${n(e.c.x)}" cy="${n(Y(e.c.y))}" r="${n(e.r)}" ${trait}/>`;

    case 'arc': {
      const p0 = { x: e.c.x + e.r * Math.cos(e.a0), y: e.c.y + e.r * Math.sin(e.a0) };
      const p1 = { x: e.c.x + e.r * Math.cos(e.a1), y: e.c.y + e.r * Math.sin(e.a1) };
      const delta = e.a1 - e.a0;
      const grandArc = Math.abs(delta) > Math.PI ? 1 : 0;
      // Le sens s'inverse avec le retournement de l'axe Y.
      const sens = delta > 0 ? 0 : 1;
      return (
        `<path d="M ${n(p0.x)} ${n(Y(p0.y))} A ${n(e.r)} ${n(e.r)} 0 ${grandArc} ${sens} ` +
        `${n(p1.x)} ${n(Y(p1.y))}" ${trait}/>`
      );
    }

    case 'texte': {
      const ancrage = { gauche: 'start', centre: 'middle', droite: 'end' }[e.ancrage];
      const base = { bas: 'auto', milieu: 'central', haut: 'hanging' }[e.ligneDeBase];
      const x = n(e.at.x);
      const y = n(Y(e.at.y));
      // La rotation du dessin est trigonométrique, celle de SVG horaire.
      const rot = e.rotation !== 0 ? ` transform="rotate(${n(-e.rotation)} ${x} ${y})"` : '';
      return (
        `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif"` +
        ` font-size="${n(e.hauteur * 1.35)}" fill="${encre}" stroke="none"` +
        ` text-anchor="${ancrage}" dominant-baseline="${base}"` +
        `${e.gras ? ' font-weight="600"' : ''}${rot}>${echapper(e.texte)}</text>`
      );
    }

    case 'remplissage': {
      const d = [e.contour, ...e.trous].map((r) => cheminDe(r, Y, true)).join(' ');
      const gris = Math.round(e.gris * 255);
      // Blanc = masque : il prend la couleur du papier, quel que soit le thème.
      if (e.gris >= 0.999 && papier === null) return '';
      const couleur = e.gris === 0 ? encre : e.gris >= 0.999 ? (papier as string) : `rgb(${gris},${gris},${gris})`;
      return `<path d="${d}" fill="${couleur}" fill-rule="evenodd" stroke="none"/>`;
    }

    case 'hachure': {
      // ⚠ Les traits sont calculés par le moteur commun, PAS par un motif SVG.
      // Un motif natif serait plus court à écrire, mais chaque format de sortie
      // hachurerait alors à sa façon : le PDF imprimé ne montrerait pas tout à
      // fait le dessin affiché. Un seul calcul, trois rendus identiques.
      const traits = hatchLines(e.contour, e.trous, e.pas, e.angle)
        .map((s) => `M ${n(s.a.x)} ${n(Y(s.a.y))} L ${n(s.b.x)} ${n(Y(s.b.y))}`)
        .join(' ');
      return traits === ''
        ? ''
        : `<path d="${traits}" stroke="${encre}" stroke-width="${LAYER_STYLES.hachure.width}"/>`;
    }
  }
}

function cheminDe(points: readonly Pt[], Y: (y: number) => number, fermee: boolean): string {
  if (points.length === 0) return '';
  const tete = points[0] as Pt;
  const corps = points
    .slice(1)
    .map((p) => `L ${n(p.x)} ${n(Y(p.y))}`)
    .join(' ');
  return `M ${n(tete.x)} ${n(Y(tete.y))} ${corps}${fermee ? ' Z' : ''}`;
}

/** Trois décimales suffisent : le micron n'a pas de sens sur un plan papier. */
function n(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

function echapper(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // ⚠ L'apostrophe aussi : un attribut entre apostrophes s'y refermerait.
    .replace(/'/g, '&#39;');
}
