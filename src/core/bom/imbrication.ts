import type { SteelGradeId } from '../catalog/types';
import type { Plate, StructuralModel } from '../build/types';
import { RHO_ACIER } from '../math/tolerance';
import type { AtelierParams } from '../model/atelier';

/**
 * IMBRICATION DES TÔLES — combien de tôles du commerce, et où découper chaque
 * platine.
 *
 * ⚠ La liste des tôles dit « douze platines 260 × 742 × 20 » ; l'acheteur, lui,
 * commande des TÔLES de 3 000 × 1 500, et une platine qui ne se range dans
 * aucune chute se paie au prix d'une tôle entière. L'imbrication donne le
 * nombre de tôles par épaisseur, et le chef de la table de découpe la position
 * de chaque pièce.
 *
 * Rangement en ÉTAGÈRES : les pièces, triées par hauteur décroissante, se
 * posent côte à côte le long de la tôle ; une étagère pleine, on ouvre la
 * suivante au-dessus. Chaque pièce est couchée de sorte que son grand côté
 * suive la longueur de la tôle. Les contours sont pris à leur rectangle
 * englobant — exact pour des platines rectangulaires, prudent pour le reste.
 */

/**
 * Nom du fichier de découpe d'un repère de tôle. ⚠ Une seule écriture, lue par
 * l'export DXF ET par la planche de tôlerie : la ligne de la planche et le
 * fichier de la machine doivent porter le même nom, au caractère près.
 */
export function nomFichierTole(pl: Pick<Plate, 'mark' | 'thickness' | 'grade'>, nombre: number): string {
  return `${pl.mark}-ep${pl.thickness}-${pl.grade}-x${nombre}.dxf`;
}

export interface Placement {
  readonly mark: string;
  /** Coin inférieur gauche, dans la tôle (mm). */
  readonly x: number;
  readonly y: number;
  readonly largeur: number;
  readonly hauteur: number;
  /** Vrai si la pièce a été tournée d'un quart de tour. */
  readonly tournee: boolean;
}

export interface Disposition {
  readonly numero: number;
  readonly placements: readonly Placement[];
  /** Nombre de tôles découpées selon cette disposition. */
  readonly nombre: number;
  /** Part de la tôle transformée en pièces. */
  readonly utilisation: number;
}

export interface ImbricationEpaisseur {
  readonly epaisseur: number;
  readonly grade: SteelGradeId;
  readonly longueur: number;
  readonly largeur: number;
  readonly dispositions: readonly Disposition[];
  readonly toles: number;
  /** Pièces plus grandes que la tôle : à commander en tôle forte ou à part. */
  readonly horsFormat: readonly string[];
  readonly masseCommandee: number;
  readonly masseUtile: number;
}

interface Piece {
  readonly mark: string;
  readonly l: number;
  readonly h: number;
  /** La pièce est couchée d'un quart de tour par rapport à son dessin. */
  readonly tournee: boolean;
}

export function imbriquer(model: StructuralModel, a: AtelierParams): ImbricationEpaisseur[] {
  const groupes = new Map<string, { epaisseur: number; grade: SteelGradeId; pieces: Piece[] }>();
  for (const pl of model.plates) {
    const cle = `${pl.thickness}|${pl.grade}`;
    const g = groupes.get(cle) ?? { epaisseur: pl.thickness, grade: pl.grade, pieces: [] };
    g.pieces.push(pieceDe(pl));
    groupes.set(cle, g);
  }
  return [...groupes.values()]
    .map((g) => imbriquerEpaisseur(g.epaisseur, g.grade, g.pieces, a))
    .sort((x, y) => x.epaisseur - y.epaisseur);
}

function pieceDe(pl: Plate): Piece {
  const ys = pl.outline.map((q) => q.y);
  const zs = pl.outline.map((q) => q.z);
  const w = Math.max(...ys) - Math.min(...ys);
  const h = Math.max(...zs) - Math.min(...zs);
  // Grand côté le long de la tôle.
  return { mark: pl.mark, l: Math.max(w, h), h: Math.min(w, h), tournee: h > w };
}

export type { Piece as PieceAImbriquer };

export function imbriquerEpaisseur(
  epaisseur: number,
  grade: SteelGradeId,
  pieces: readonly Piece[],
  a: AtelierParams,
): ImbricationEpaisseur {
  const L = Math.max(a.toleLongueur, a.toleLargeur);
  const H = Math.min(a.toleLongueur, a.toleLargeur);
  const j = a.jeuDecoupe;
  const tient = (p: Piece): boolean => p.l + 2 * j <= L && p.h + 2 * j <= H;
  const horsFormat = pieces.filter((p) => !tient(p)).map((p) => p.mark);
  const aPlacer = pieces.filter(tient).sort((x, y) => y.h - x.h || y.l - x.l);

  type Etagere = { y: number; hauteur: number; x: number };
  type Tole = { placements: Placement[]; etageres: Etagere[] };
  const toles: Tole[] = [];

  for (const p of aPlacer) {
    let pose = false;
    for (const t of toles) {
      // Dans une étagère existante, à la suite des pièces déjà posées.
      for (const e of t.etageres) {
        if (p.h <= e.hauteur && e.x + p.l + j <= L) {
          t.placements.push({ mark: p.mark, x: e.x, y: e.y, largeur: p.l, hauteur: p.h, tournee: p.tournee });
          e.x += p.l + j;
          pose = true;
          break;
        }
      }
      if (pose) break;
      // Sinon une étagère neuve au-dessus de la dernière, s'il reste la hauteur.
      const derniere = t.etageres[t.etageres.length - 1];
      const yNeuve = derniere ? derniere.y + derniere.hauteur + j : j;
      if (yNeuve + p.h + j <= H) {
        t.etageres.push({ y: yNeuve, hauteur: p.h, x: j + p.l + j });
        t.placements.push({ mark: p.mark, x: j, y: yNeuve, largeur: p.l, hauteur: p.h, tournee: p.tournee });
        pose = true;
        break;
      }
    }
    if (!pose) {
      toles.push({
        placements: [{ mark: p.mark, x: j, y: j, largeur: p.l, hauteur: p.h, tournee: p.tournee }],
        etageres: [{ y: j, hauteur: p.h, x: j + p.l + j }],
      });
    }
  }

  // Tôles identiques regroupées en dispositions.
  const parSignature = new Map<string, { placements: Placement[]; nombre: number }>();
  for (const t of toles) {
    const sig = t.placements.map((q) => `${q.mark}@${Math.round(q.x)},${Math.round(q.y)}`).join(';');
    const deja = parSignature.get(sig);
    if (deja) deja.nombre += 1;
    else parSignature.set(sig, { placements: t.placements, nombre: 1 });
  }
  const surface = L * H;
  const dispositions = [...parSignature.values()]
    .sort((x, y) => y.nombre - x.nombre)
    .map((d, i) => ({
      numero: i + 1,
      placements: d.placements,
      nombre: d.nombre,
      utilisation: d.placements.reduce((s, q) => s + q.largeur * q.hauteur, 0) / surface,
    }));

  const masse = (aire: number): number => aire * epaisseur * RHO_ACIER;
  return {
    epaisseur,
    grade,
    longueur: L,
    largeur: H,
    dispositions,
    toles: toles.length,
    horsFormat,
    masseCommandee: masse(toles.length * surface),
    masseUtile: masse(pieces.reduce((s, p) => s + p.l * p.h, 0)),
  };
}
