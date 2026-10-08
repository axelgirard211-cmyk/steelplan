import { nomFichierTole, type ImbricationEpaisseur } from '../../bom/imbrication';
import { designationDeTrou } from '../../geometry/holes';
import type { Plate } from '../../build/types';
import { roundMm } from '../../math/tolerance';
import { fenetreDe, type CartoucheData } from '../layout';
import { pt, type DrawScene } from '../scene';
import type { Sheet } from '../sheet';
import { Curseur, planchesDe } from './curseur';

/**
 * PLANCHES DE TÔLERIE — la feuille de la table de découpe.
 *
 * Épaisseur par épaisseur : combien de tôles, chaque disposition dessinée à
 * l'échelle de la tôle avec le repère de chaque pièce, puis la liste des
 * repères à découper — dimensions, trous, quantité. Le fichier DXF de chaque
 * repère porte le même nom que sa ligne : la planche et la machine parlent de
 * la même pièce.
 */

const TEXTE = 2.0;
const HAUTEUR_TOLE = 46;
const ENTETE = 9;

export function sheetsTolerie(
  imbrication: readonly ImbricationEpaisseur[],
  plates: readonly Plate[],
  meta: CartoucheData['meta'],
): Sheet[] {
  const fenetre = fenetreDe('A3');
  const k = new Curseur(fenetre);

  for (const e of imbrication) {
    k.reserver(ENTETE + HAUTEUR_TOLE + 10);
    const util =
      e.toles > 0 ? `${((e.masseUtile / e.masseCommandee) * 100).toFixed(0)} % utilisés` : 'aucune tôle';
    k.s.texte(pt(fenetre.min.x, k.y), `Tôle ép. ${e.epaisseur} mm — ${e.grade}`, { hauteur: 3, gras: true });
    k.s.texte(
      pt(fenetre.max.x, k.y),
      `${e.toles} tôle${e.toles > 1 ? 's' : ''} ${e.longueur} × ${e.largeur} — ${roundMm(e.masseCommandee)} kg — ${util}`,
      { hauteur: 2.4, ancrage: 'droite' },
    );
    k.s.ligne(pt(fenetre.min.x, k.y - 2), pt(fenetre.max.x, k.y - 2), 'contour');
    k.y -= ENTETE;

    // Les dispositions côte à côte, à la même échelle.
    const echelle = HAUTEUR_TOLE / e.largeur;
    const largeurTole = e.longueur * echelle;
    let x = fenetre.min.x;
    for (const d of e.dispositions) {
      if (x + largeurTole > fenetre.max.x) {
        x = fenetre.min.x;
        k.y -= HAUTEUR_TOLE + 10;
        k.reserver(HAUTEUR_TOLE + 10);
      }
      dessinerDisposition(k.s, d, x, k.y - HAUTEUR_TOLE, echelle, e.longueur, e.largeur);
      x += largeurTole + 8;
    }
    k.y -= HAUTEUR_TOLE + 10;

    // Les repères de cette épaisseur.
    const parRepere = new Map<string, { pl: Plate; n: number }>();
    for (const pl of plates.filter((p) => p.thickness === e.epaisseur && p.grade === e.grade)) {
      const deja = parRepere.get(pl.mark);
      if (deja) deja.n += 1;
      else parRepere.set(pl.mark, { pl, n: 1 });
    }
    for (const { pl, n } of parRepere.values()) {
      k.reserver(4.2);
      const ys = pl.outline.map((q) => q.y);
      const zs = pl.outline.map((q) => q.z);
      const diam = [...new Set(pl.holes.map((h) => designationDeTrou(h)))].join(', ');
      k.s.texte(
        pt(fenetre.min.x + 4, k.y),
        `${pl.mark} — ${roundMm(Math.max(...ys) - Math.min(...ys))} × ${roundMm(Math.max(...zs) - Math.min(...zs))} — ` +
          `${pl.holes.length} trou${pl.holes.length > 1 ? 's' : ''}${diam ? ` ${diam}` : ''} — ${n} pièce${n > 1 ? 's' : ''} — ` +
          `fichier ${nomFichierTole(pl, n)}`,
        { hauteur: TEXTE },
      );
      k.y -= 4.2;
    }
    if (e.horsFormat.length > 0) {
      k.reserver(5);
      k.s.texte(
        pt(fenetre.min.x + 4, k.y),
        `Hors format ${e.longueur} × ${e.largeur}, à commander à part : ${[...new Set(e.horsFormat)].join(', ')}`,
        { hauteur: TEXTE, gras: true },
      );
      k.y -= 5;
    }
    k.y -= 5;
  }
  return planchesDe(k, 'tolerie', 'Tôlerie — imbrication et découpe', meta);
}

function dessinerDisposition(
  s: DrawScene,
  d: ImbricationEpaisseur['dispositions'][number],
  x0: number,
  y0: number,
  k: number,
  L: number,
  H: number,
): void {
  s.rectangle(pt(x0, y0), pt(x0 + L * k, y0 + H * k), 'contour');
  for (const p of d.placements) {
    const a = pt(x0 + p.x * k, y0 + p.y * k);
    const b = pt(x0 + (p.x + p.largeur) * k, y0 + (p.y + p.hauteur) * k);
    s.rectangle(a, b, 'contour-fin');
    if (b.x - a.x > 5 && b.y - a.y > 2.4) {
      s.texte(pt((a.x + b.x) / 2, (a.y + b.y) / 2), p.mark, { hauteur: 1.8, ancrage: 'centre', ligneDeBase: 'milieu' });
    }
  }
  s.texte(pt(x0, y0 - 3.5), `Disposition ${d.numero} × ${d.nombre} — ${(d.utilisation * 100).toFixed(0)} %`, {
    hauteur: 1.9,
    gras: true,
  });
}
