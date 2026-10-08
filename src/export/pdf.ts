import { jsPDF } from 'jspdf';
import { versCp1252 } from './glyphes';
import { flattenArc, flattenCircle, hatchLines } from '../core/drawing/hatch';
import { FORMATS, type SheetFormat } from '../core/drawing/layout';
import { LAYER_STYLES, type DrawEntity, type Pt } from '../core/drawing/scene';
import type { Sheet } from '../core/drawing/sheet';

/**
 * Export PDF VECTORIEL.
 *
 * Écrit directement dans le document PDF, sans passer par une conversion depuis
 * le SVG. C'est le choix qui a été retenu en début de projet : une conversion
 * SVG→PDF ramène les faiblesses connues des convertisseurs sur les métriques de
 * texte et les tiretés, et une cote décalée de deux millimètres à l'impression
 * est exactement ce qu'on ne peut pas se permettre sur un plan d'atelier.
 *
 * Le document est produit en millimètres, à l'échelle 1 : une cote mesurée à la
 * règle sur le tirage papier retombe donc sur la valeur du plan.
 */

/** Conversion millimètre → point typographique, pour les tailles de police. */
const MM_EN_POINTS = 72 / 25.4;

export interface PdfOptions {
  /** Titre inscrit dans les propriétés du document. */
  readonly titre?: string;
  readonly auteur?: string;
  /**
   * Compression du flux de contenu. Activée par défaut ; on peut la couper pour
   * relire le PDF produit et vérifier les opérateurs de tracé un à un.
   */
  readonly compresser?: boolean;
}

/** Produit le dossier complet : une planche par page, dans l'ordre du dossier. */
export function sheetsToPdf(sheets: readonly Sheet[], opts: PdfOptions = {}): Blob {
  if (sheets.length === 0) throw new Error('Aucune planche à exporter.');

  const premier = sheets[0] as Sheet;
  const doc = new jsPDF({
    unit: 'mm',
    format: dimensions(premier.format),
    orientation: 'landscape',
    compress: opts.compresser !== false,
  });
  doc.setProperties({
    title: opts.titre ?? 'Dossier de plans',
    creator: 'SteelPlan',
    author: opts.auteur ?? '',
  });

  for (const [i, sheet] of sheets.entries()) {
    if (i > 0) doc.addPage(dimensions(sheet.format), 'landscape');
    dessinerPlanche(doc, sheet);
  }
  return doc.output('blob');
}

/** Produit une planche isolée. */
export function sheetToPdf(sheet: Sheet, opts: PdfOptions = {}): Blob {
  return sheetsToPdf([sheet], opts);
}

function dimensions(format: SheetFormat): [number, number] {
  const f = FORMATS[format];
  return [f.largeur, f.hauteur];
}

/* ------------------------------------------------------------------ */

function dessinerPlanche(doc: jsPDF, sheet: Sheet): void {
  const h = FORMATS[sheet.format].hauteur;
  // Le dessin a son Y vers le haut, le PDF vers le bas : on retourne une fois.
  const Y = (y: number): number => h - y;

  // Tout est tracé en noir : un plan d'atelier s'imprime en noir et blanc.
  doc.setDrawColor(0, 0, 0);
  doc.setFillColor(0, 0, 0);
  doc.setLineCap('round');
  doc.setLineJoin('round');

  for (const e of sheet.scene.entities) {
    appliquerStyle(doc, e);
    switch (e.kind) {
      case 'ligne':
        doc.line(e.a.x, Y(e.a.y), e.b.x, Y(e.b.y));
        break;

      case 'polyligne':
        tracerPolyligne(doc, e.points, Y, e.fermee, 'S');
        break;

      case 'cercle':
        // Aplati en polyligne : le cercle natif de jsPDF passe par des courbes
        // de Bézier dont l'écart, sur un petit perçage, se voit.
        tracerPolyligne(doc, flattenCircle(e.c, e.r), Y, true, 'S');
        break;

      case 'arc':
        tracerPolyligne(doc, flattenArc(e.c, e.r, e.a0, e.a1), Y, false, 'S');
        break;

      case 'remplissage': {
        const gris = Math.round(e.gris * 255);
        doc.setFillColor(gris, gris, gris);
        // Les contours intérieurs sont tracés dans le sens inverse : la règle
        // pair-impair les évide.
        for (const anneau of [e.contour, ...e.trous]) {
          tracerPolyligne(doc, anneau, Y, true, 'F');
        }
        doc.setFillColor(0, 0, 0);
        break;
      }

      case 'hachure':
        // ⚠ Les traits de hachure sont calculés par le moteur commun, pas par le
        // PDF : c'est ce qui garantit que l'écran et le papier montrent
        // exactement les mêmes hachures.
        for (const s of hatchLines(e.contour, e.trous, e.pas, e.angle)) {
          doc.line(s.a.x, Y(s.a.y), s.b.x, Y(s.b.y));
        }
        break;

      case 'texte':
        ecrireTexte(doc, e, Y);
        break;
    }
  }
}

function appliquerStyle(doc: jsPDF, e: DrawEntity): void {
  const style = LAYER_STYLES[e.layer];
  doc.setLineWidth(style.width);
  if (style.dash.length > 0) doc.setLineDashPattern([...style.dash], 0);
  else doc.setLineDashPattern([], 0);
}

function tracerPolyligne(
  doc: jsPDF,
  points: readonly Pt[],
  Y: (y: number) => number,
  fermee: boolean,
  style: 'S' | 'F',
): void {
  if (points.length < 2) return;
  const tete = points[0] as Pt;
  // jsPDF attend des déplacements relatifs.
  const deltas: [number, number][] = [];
  let precedent = tete;
  for (const p of points.slice(1)) {
    deltas.push([p.x - precedent.x, Y(p.y) - Y(precedent.y)]);
    precedent = p;
  }
  doc.lines(deltas, tete.x, Y(tete.y), [1, 1], style, fermee);
}

function ecrireTexte(
  doc: jsPDF,
  e: Extract<DrawEntity, { kind: 'texte' }>,
  Y: (y: number) => number,
): void {
  doc.setFont('helvetica', e.gras ? 'bold' : 'normal');
  // Même facteur qu'à l'écran : la hauteur nominale du dessin est une hauteur de
  // caractère, la taille de police la déborde légèrement.
  doc.setFontSize(e.hauteur * 1.35 * MM_EN_POINTS);

  const align = { gauche: 'left', centre: 'center', droite: 'right' } as const;
  const baseline = { bas: 'alphabetic', milieu: 'middle', haut: 'hanging' } as const;

  doc.text(versCp1252(e.texte), e.at.x, Y(e.at.y), {
    align: align[e.ancrage],
    baseline: baseline[e.ligneDeBase],
    // La rotation du dessin est trigonométrique, celle de jsPDF aussi.
    angle: e.rotation,
  });
}
