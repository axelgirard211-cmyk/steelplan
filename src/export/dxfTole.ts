import type { Plate, StructuralModel } from '../core/build/types';
import { contourDeTrou } from '../core/geometry/holes';
import { DrawScene, pt } from '../core/drawing/scene';
import { sheetToDxf } from './dxf';
import { nomFichierTole } from '../core/bom/imbrication';

/**
 * DXF DE DÉCOUPE — un fichier par repère de tôle, pour la table d'oxycoupage ou
 * de plasma.
 *
 * ⚠ À l'ÉCHELLE 1, en millimètres, sans cadre ni cartouche : c'est la pièce
 * elle-même que lit la machine, pas un plan de la pièce. Le contour va sur le
 * calque DECOUPE, les trous sur PERCAGE — les postes de programmation les
 * distinguent ainsi pour choisir l'outil et l'ordre de coupe (les trous
 * d'abord, le contour ensuite, sans quoi la pièce bouge en tombant) —, le
 * repère sur MARQUAGE, pour le pointeau ou le marqueur.
 *
 * Origine au coin inférieur gauche de l'encombrement : les programmes
 * d'imbrication s'y attendent.
 */
export interface FichierDxf {
  readonly nom: string;
  readonly contenu: string;
}

export function toleToDxf(pl: Plate, nombre: number): string {
  const ys = pl.outline.map((q) => q.y);
  const zs = pl.outline.map((q) => q.z);
  const x0 = Math.min(...ys);
  const y0 = Math.min(...zs);
  const s = new DrawScene();
  s.polyligne(
    pl.outline.map((q) => pt(q.y - x0, q.z - y0)),
    true,
    'contour',
  );
  for (const h of pl.holes) {
    // Un oblong se découpe suivant son contour ; un trou rond reste un cercle,
    // que la machine perce ou découpe d'un seul tenant.
    if (h.oblong) s.polyligne(contourDeTrou(h).map((q) => pt(q.y - x0, q.z - y0)), true, 'contour-fin');
    else s.cercle(pt(h.at.y - x0, h.at.z - y0), h.d / 2, 'contour-fin');
  }
  // Marquage au centre de la tôle, hors des trous autant que possible : la
  // machine le grave, le soudeur le lit.
  const cx = (Math.max(...ys) - x0) / 2;
  const cy = (Math.max(...zs) - y0) / 2;
  s.texte(pt(cx, cy), `${pl.mark} ep${pl.thickness} ${pl.grade} x${nombre}`, {
    hauteur: Math.min(12, Math.max(4, (Math.max(...ys) - x0) / 20)),
    ancrage: 'centre',
    ligneDeBase: 'milieu',
    layer: 'reperage',
  });
  return sheetToDxf({ scene: s }, { contour: 'DECOUPE', 'contour-fin': 'PERCAGE', reperage: 'MARQUAGE' });
}

/** Un fichier par repère de tôle, nommé comme elle et portant sa quantité. */
export function lotDxfToles(model: StructuralModel): FichierDxf[] {
  const parRepere = new Map<string, { pl: Plate; nombre: number }>();
  for (const pl of model.plates) {
    const deja = parRepere.get(pl.mark);
    if (deja) deja.nombre += 1;
    else parRepere.set(pl.mark, { pl, nombre: 1 });
  }
  return [...parRepere.values()].map(({ pl, nombre }) => ({
    nom: nomFichierTole(pl, nombre),
    contenu: toleToDxf(pl, nombre),
  }));
}
