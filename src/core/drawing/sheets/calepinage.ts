import { getProfile } from '../../catalog/index';
import { tauxDeChute, type CalepinageProfil, type Schema } from '../../bom/calepinage';
import { roundMm } from '../../math/tolerance';
import { fenetreDe, type CartoucheData } from '../layout';
import { pt, type DrawScene } from '../scene';
import type { Sheet } from '../sheet';
import { Curseur, planchesDe } from './curseur';

/**
 * PLANCHES DE CALEPINAGE — la feuille du scieur.
 *
 * Profil par profil, chaque SCHÉMA DE COUPE est dessiné comme la barre qu'il
 * décrit : les coupes bout à bout, à l'échelle de la barre, avec leur repère et
 * leur longueur, puis la chute hachurée. Le scieur lit « schéma 2 × 6 » et sort
 * six barres qu'il coupe toutes de la même façon : il ne recompose rien.
 */

const TEXTE = 2.0;
const HAUTEUR_BARRE = 6;
const PAS_SCHEMA = 13;
const ENTETE_PROFIL = 9;

export interface OptionsCalepinage {
  readonly meta: CartoucheData['meta'];
}

/** Une ou plusieurs planches A3, selon le nombre de schémas. */
export function sheetsCalepinage(calepinage: readonly CalepinageProfil[], opts: OptionsCalepinage): Sheet[] {
  const format = 'A3' as const;
  const fenetre = fenetreDe(format);
  const k = new Curseur(fenetre);

  for (const c of calepinage) {
    if (c.schemas.length === 0 && c.aLongueur.length === 0) continue;
    // Le titre du profil ne reste jamais seul en bas de planche.
    k.reserver(ENTETE_PROFIL + PAS_SCHEMA);
    enteteProfil(k, c, '');

    const xBarre = fenetre.min.x + 40;
    const largeurMaxi = fenetre.max.x - xBarre - 4;
    const plusLongue = Math.max(...c.schemas.map((x) => x.barre), 1);
    for (const sch of c.schemas) {
      if (k.reserver(PAS_SCHEMA)) enteteProfil(k, c, ' (suite)');
      dessinerSchema(k.s, sch, xBarre, k.y, (largeurMaxi * sch.barre) / plusLongue, fenetre.min.x);
      k.y -= PAS_SCHEMA;
    }

    if (c.aLongueur.length > 0) {
      // Les coupes qu'aucune barre ne contient, et les profils livrés à longueur.
      const parLongueur = new Map<string, number>();
      for (const x of c.aLongueur) {
        const cle = `${x.mark} × ${roundMm(x.longueur)} mm`;
        parLongueur.set(cle, (parLongueur.get(cle) ?? 0) + 1);
      }
      const liste = [...parLongueur.entries()].map(([cle, nb]) => `${nb} × ${cle}`).join(' ; ');
      k.reserver(6);
      k.s.texte(pt(fenetre.min.x, k.y), `À commander à longueur : ${liste}`, { hauteur: TEXTE, gras: true });
      k.y -= 6;
    }
    k.y -= 4;
  }

  return planchesDe(k, 'calepinage', 'Calepinage de débit', opts.meta);
}

function enteteProfil(k: Curseur, c: CalepinageProfil, suite: string): void {
  const f = k.fenetre;
  const taux = (tauxDeChute(c) * 100).toFixed(1).replace('.', ',');
  const barres = c.barres > 0 ? `${c.barres} barre${c.barres > 1 ? 's' : ''}` : 'aucune barre';
  k.s.texte(pt(f.min.x, k.y), `${getProfile(c.profil).id} — ${c.grade}${suite}`, { hauteur: 3, gras: true });
  k.s.texte(pt(f.max.x, k.y), `${barres} — ${roundMm(c.masseCommandee)} kg commandés — chute ${taux} %`, {
    hauteur: 2.4,
    ancrage: 'droite',
  });
  k.s.ligne(pt(f.min.x, k.y - 2), pt(f.max.x, k.y - 2), 'contour');
  k.y -= ENTETE_PROFIL;
}

/** Une barre, ses coupes bout à bout, et sa chute hachurée. */
function dessinerSchema(s: DrawScene, sch: Schema, x0: number, y: number, largeur: number, xLegende: number): void {
  const k = largeur / sch.barre;
  s.texte(pt(xLegende, y - 1), `Schéma ${sch.numero}`, { hauteur: 2.4, gras: true });
  s.texte(pt(xLegende, y - 4.6), `× ${sch.nombre} — barre ${sch.barre / 1000} m`, { hauteur: TEXTE });

  const yb = y - HAUTEUR_BARRE;
  s.rectangle(pt(x0, yb), pt(x0 + largeur, y), 'contour');
  let x = x0;
  for (const c of sch.coupes) {
    const l = c.longueur * k;
    s.ligne(pt(x + l, yb), pt(x + l, y), 'contour');
    // Repère et longueur dans la coupe, ou au-dessus quand elle est trop courte.
    const libelle = `${c.mark} · ${roundMm(c.longueur)}`;
    const dedans = l > libelle.length * TEXTE * 0.6 + 2;
    s.texte(pt(x + l / 2, dedans ? yb + 1.6 : y + 0.8), dedans ? libelle : c.mark, {
      hauteur: dedans ? TEXTE : 1.6,
      ancrage: 'centre',
    });
    x += l;
  }
  // La chute, hachurée : ce qui part au stock ou à la ferraille.
  if (sch.chute > 0.5) {
    const xf = x0 + largeur;
    s.hachure([pt(x, yb), pt(xf, yb), pt(xf, y), pt(x, y)], [], 1.4, 45);
    s.texte(pt(xf + 1, yb - 3), `chute ${roundMm(sch.chute)}`, { hauteur: 1.7, ancrage: 'droite' });
  }
}
