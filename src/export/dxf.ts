import { flattenArc, hatchLines } from '../core/drawing/hatch';
import { LAYER_STYLES, type DrawEntity, type Layer, type Pt } from '../core/drawing/scene';
import type { Sheet } from '../core/drawing/sheet';
import { versCp1252 } from './glyphes';

/**
 * Export DXF (AutoCAD R12 ASCII).
 *
 * R12 est délibéré : c'est la version que TOUT logiciel de CAO relit, y compris
 * les vieux postes de commande numérique d'atelier. Les entités y sont peu
 * nombreuses — ligne, cercle, arc, polyligne, texte, solide — mais elles
 * suffisent à porter un plan de charpente.
 *
 * ⚠ Deux limites, assumées et signalées :
 *  - le DXF R12 n'a pas d'entité de COTATION associative. Les cotes sont donc
 *    exportées « éclatées » : traits, flèches et textes. Elles restent
 *    parfaitement mesurables et imprimables, mais ne se recalculeront pas si
 *    quelqu'un déplace une pièce dans son logiciel de CAO ;
 *  - les hachures sont exportées en traits, pour la même raison qu'en PDF : un
 *    seul calcul de hachure pour tous les formats.
 *
 * Le repère DXF a son Y vers le haut, comme le dessin : aucun retournement.
 */

/** Couleurs ACI (AutoCAD Color Index) par calque, et type de ligne. */
const CALQUES: Readonly<Record<Layer, { couleur: number; ligne: string }>> = {
  contour: { couleur: 7, ligne: 'CONTINUOUS' },
  'contour-fin': { couleur: 8, ligne: 'CONTINUOUS' },
  cachee: { couleur: 8, ligne: 'TIRETE' },
  axe: { couleur: 4, ligne: 'AXE' },
  cotation: { couleur: 3, ligne: 'CONTINUOUS' },
  hachure: { couleur: 8, ligne: 'CONTINUOUS' },
  texte: { couleur: 7, ligne: 'CONTINUOUS' },
  reperage: { couleur: 1, ligne: 'CONTINUOUS' },
  cartouche: { couleur: 7, ligne: 'CONTINUOUS' },
  cadre: { couleur: 7, ligne: 'CONTINUOUS' },
};

const NOMS_CALQUES: Readonly<Record<Layer, string>> = {
  contour: 'CONTOUR',
  'contour-fin': 'CONTOUR_FIN',
  cachee: 'CACHEE',
  axe: 'AXE',
  cotation: 'COTATION',
  hachure: 'HACHURE',
  texte: 'TEXTE',
  reperage: 'REPERAGE',
  cartouche: 'CARTOUCHE',
  cadre: 'CADRE',
};

/**
 * @param noms renomme des calques : un fichier de DÉCOUPE attend ses contours
 *             sur « DECOUPE » et ses trous sur « PERCAGE », pas sur les calques
 *             d'un plan.
 */
export function sheetToDxf(sheet: Pick<Sheet, 'scene'>, noms: Partial<Record<Layer, string>> = {}): string {
  const nom = (c: Layer): string => noms[c] ?? NOMS_CALQUES[c];
  const l: string[] = [];
  const g = (code: number, valeur: string | number): void => {
    l.push(String(code), String(valeur));
  };

  /* --- En-tête : unités millimètre, dessin à l'échelle 1 --- */
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$INSUNITS');
  g(70, 4); // 4 = millimètres
  g(9, '$MEASUREMENT');
  g(70, 1); // système métrique
  g(0, 'ENDSEC');

  /* --- Tables : types de ligne et calques --- */
  g(0, 'SECTION');
  g(2, 'TABLES');

  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 3);
  typeDeLigne(g, 'CONTINUOUS', 'Trait continu', []);
  typeDeLigne(g, 'TIRETE', 'Trait interrompu', [4, -2]);
  typeDeLigne(g, 'AXE', 'Trait mixte', [12, -2, 2, -2]);
  g(0, 'ENDTAB');

  // Seuls les calques réellement employés sont déclarés : un fichier de
  // découpe ne doit pas arriver au poste de programmation avec un calque
  // « CARTOUCHE » vide qu'on se demandera s'il faut couper.
  const employes = new Set(sheet.scene.entities.map((e) => e.layer));
  const declares = (Object.entries(CALQUES) as [Layer, (typeof CALQUES)[Layer]][]).filter(([c]) => employes.has(c));
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, declares.length);
  for (const [calque, def] of declares) {
    g(0, 'LAYER');
    g(2, nom(calque));
    g(70, 0);
    g(62, def.couleur);
    g(6, def.ligne);
    // L'épaisseur de trait normalisée est transportée en centièmes de mm.
    g(370, Math.round(LAYER_STYLES[calque].width * 100));
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  /* --- Entités --- */
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const e of sheet.scene.entities) ecrireEntite(g, e, nom);
  g(0, 'ENDSEC');

  g(0, 'EOF');
  return l.join('\r\n') + '\r\n';
}

type Emit = (code: number, valeur: string | number) => void;

function typeDeLigne(g: Emit, nom: string, description: string, motif: number[]): void {
  g(0, 'LTYPE');
  g(2, nom);
  g(70, 0);
  g(3, description);
  g(72, 65);
  g(73, motif.length);
  g(40, motif.reduce((s, v) => s + Math.abs(v), 0));
  for (const v of motif) g(49, v);
}

function ecrireEntite(g: Emit, e: DrawEntity, nom: (c: Layer) => string): void {
  const calque = nom(e.layer);

  switch (e.kind) {
    case 'ligne':
      ligne(g, calque, e.a, e.b);
      break;

    case 'polyligne':
      polyligne(g, calque, e.points, e.fermee);
      break;

    case 'cercle':
      g(0, 'CIRCLE');
      g(8, calque);
      g(10, n(e.c.x));
      g(20, n(e.c.y));
      g(30, 0);
      g(40, n(e.r));
      break;

    case 'arc':
      // L'arc DXF se donne par ses angles en DEGRÉS, dans le sens trigonométrique.
      g(0, 'ARC');
      g(8, calque);
      g(10, n(e.c.x));
      g(20, n(e.c.y));
      g(30, 0);
      g(40, n(e.r));
      g(50, n(normaliserDeg((e.a0 * 180) / Math.PI)));
      g(51, n(normaliserDeg((e.a1 * 180) / Math.PI)));
      break;

    case 'remplissage':
      // Un masque blanc sous un repère n'a pas d'équivalent en R12 : un SOLID
      // s'y dessinerait en noir. On l'omet — la CAO superpose sans masquer.
      if (e.gris >= 0.999) break;
      // R12 n'a pas de polygone plein quelconque : on triangule en SOLID, ce qui
      // suffit aux flèches de cotation et aux petits symboles.
      for (let i = 1; i + 1 < e.contour.length; i++) {
        solide(g, calque, e.contour[0] as Pt, e.contour[i] as Pt, e.contour[i + 1] as Pt);
      }
      break;

    case 'hachure':
      for (const s of hatchLines(e.contour, e.trous, e.pas, e.angle)) {
        ligne(g, NOMS_CALQUES.hachure, s.a, s.b);
      }
      break;

    case 'texte':
      texte(g, calque, e);
      break;
  }
}

function ligne(g: Emit, calque: string, a: Pt, b: Pt): void {
  g(0, 'LINE');
  g(8, calque);
  g(10, n(a.x));
  g(20, n(a.y));
  g(30, 0);
  g(11, n(b.x));
  g(21, n(b.y));
  g(31, 0);
}

/** Polyligne R12 : une entité POLYLINE, ses VERTEX, puis SEQEND. */
function polyligne(g: Emit, calque: string, points: readonly Pt[], fermee: boolean): void {
  if (points.length < 2) return;
  g(0, 'POLYLINE');
  g(8, calque);
  g(66, 1); // des sommets suivent
  g(10, 0);
  g(20, 0);
  g(30, 0);
  g(70, fermee ? 1 : 0);
  for (const p of points) {
    g(0, 'VERTEX');
    g(8, calque);
    g(10, n(p.x));
    g(20, n(p.y));
    g(30, 0);
  }
  g(0, 'SEQEND');
  g(8, calque);
}

/** Triangle plein : SOLID attend ses sommets en Z, d'où le doublement du 3ᵉ. */
function solide(g: Emit, calque: string, a: Pt, b: Pt, c: Pt): void {
  g(0, 'SOLID');
  g(8, calque);
  g(10, n(a.x));
  g(20, n(a.y));
  g(30, 0);
  g(11, n(b.x));
  g(21, n(b.y));
  g(31, 0);
  g(12, n(c.x));
  g(22, n(c.y));
  g(32, 0);
  g(13, n(c.x));
  g(23, n(c.y));
  g(33, 0);
}

function texte(g: Emit, calque: string, e: Extract<DrawEntity, { kind: 'texte' }>): void {
  g(0, 'TEXT');
  g(8, calque);
  g(10, n(e.at.x));
  g(20, n(e.at.y));
  g(30, 0);
  g(40, n(e.hauteur));
  g(1, versCp1252(e.texte));
  g(50, n(normaliserDeg(e.rotation)));
  // Justification : 72 pour l'horizontale, 73 pour la verticale.
  g(72, { gauche: 0, centre: 1, droite: 2 }[e.ancrage]);
  g(73, { bas: 0, milieu: 2, haut: 3 }[e.ligneDeBase]);
  // Dès qu'une justification est donnée, c'est le second point qui positionne.
  g(11, n(e.at.x));
  g(21, n(e.at.y));
  g(31, 0);
}

/** Trois décimales : le micron n'a pas de sens sur un plan. */
function n(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function normaliserDeg(a: number): number {
  const m = a % 360;
  return m < 0 ? m + 360 : m;
}

/** Aplatit un arc, exposé pour les moteurs qui ne savent pas en tracer. */
export { flattenArc };
