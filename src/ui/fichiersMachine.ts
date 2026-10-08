import type { StructuralModel } from '../core/build/types';
import { piecesDeDebit } from '../core/drawing/sheets/element';
import type { ProjectMeta } from '../core/model/project';
import { lotDstv, type LotDstv } from '../export/dstv';
import { lotDxfToles } from '../export/dxfTole';
import { zip } from '../export/zip';

/**
 * FICHIERS MACHINE — les archives que reçoivent la ligne de perçage et la table
 * de découpe.
 *
 * ⚠ Une seule écriture pour les deux endroits qui les proposent — la
 * nomenclature et le dossier du poste : deux boutons qui fabriqueraient chacun
 * leur archive finiraient par ne pas livrer les mêmes fichiers.
 *
 * Une ARCHIVE et non un fichier unique : la commande numérique lit un fichier
 * par pièce, et des fichiers concaténés ne se découpent plus.
 */
export interface Archive {
  readonly blob: Blob;
  readonly nom: string;
  readonly nombre: number;
}

export function lotDstvDuModele(model: StructuralModel, meta: ProjectMeta): LotDstv {
  return lotDstv(piecesDeDebit(model), { meta });
}

export function archiveDstv(lot: LotDstv, projet: string): Archive {
  return {
    blob: zip(lot.fichiers.map((f) => ({ nom: f.nom, contenu: f.contenu }))),
    nom: `${projet}-dstv.zip`,
    nombre: lot.fichiers.length,
  };
}

export function archiveDxfToles(model: StructuralModel, projet: string): Archive {
  const fichiers = lotDxfToles(model);
  return {
    blob: zip(fichiers.map((f) => ({ nom: f.nom, contenu: f.contenu }))),
    nom: `${projet}-toles-dxf.zip`,
    nombre: fichiers.length,
  };
}
