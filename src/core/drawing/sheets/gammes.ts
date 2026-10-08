import { getProfile } from '../../catalog/index';
import type { FinitionParams } from '../../model/finition';
import { fenetreDe, type CartoucheData } from '../layout';
import { pt } from '../scene';
import type { Sheet } from '../sheet';
import { Curseur, planchesDe } from './curseur';
import type { ElementFabrication } from './element';
import { couper } from './fabricationBlocs';
import { gammeDeFabrication } from './gamme';

/**
 * GAMMES DE FABRICATION — la fiche qui suit chaque élément d'un poste à l'autre.
 *
 * ⚠ Elle occupait le tiers droit de chaque plan d'assemblage, et c'est la vue de
 * l'élément qui en payait le prix. Un plan dit OÙ ; une gamme dit DANS QUEL
 * ORDRE : on les lit à deux moments différents, et l'atelier les classe
 * séparément. Chaque gamme porte le repère d'assemblage, celui de son plan.
 */

const H_TITRE = 2.6;
const H_POSTE = 2.2;
const H_TEXTE = 2.0;
const PAS = 3.2;
const COLONNES = 2;
const GOUTTIERE = 10;

export function sheetsGammes(
  elements: readonly ElementFabrication[],
  finition: FinitionParams,
  meta: CartoucheData['meta'],
): Sheet[] {
  const fenetre = fenetreDe('A3');
  const k = new Curseur(fenetre);
  const largeur = (fenetre.max.x - fenetre.min.x - GOUTTIERE * (COLONNES - 1)) / COLONNES;
  let colonne = 0;
  const x = (): number => fenetre.min.x + colonne * (largeur + GOUTTIERE);
  // Place pour `h` mm dans la colonne courante ; sinon la suivante, ou une planche neuve.
  const place = (h: number): void => {
    if (k.y - h >= fenetre.min.y) return;
    if (colonne < COLONNES - 1) {
      colonne += 1;
      k.y = fenetre.max.y - 4;
    } else {
      colonne = 0;
      k.ouvrir();
    }
  };

  for (const e of elements) {
    const etapes = gammeDeFabrication(e, finition);
    const blocs = etapes.map((g) => ({
      titre: `${g.numero}. ${g.poste}`,
      lignes: g.lignes.flatMap((t) => couper(t, largeur - 4, H_TEXTE)),
    }));
    // Un élément ne se coupe pas entre deux colonnes s'il tient dans une.
    const hauteur = 8 + blocs.reduce((t, b) => t + PAS * (1 + b.lignes.length) + 1.2, 0);
    place(Math.min(hauteur, fenetre.max.y - fenetre.min.y - 8));
    k.s.texte(
      pt(x(), k.y),
      `Assemblage ${e.repere} — ${getProfile(e.membre.profileId).id} — ${e.quantite} pièce${e.quantite > 1 ? 's' : ''}`,
      { hauteur: H_TITRE, gras: true },
    );
    k.y -= 1.6;
    k.s.ligne(pt(x(), k.y), pt(x() + largeur, k.y), 'cotation');
    k.y -= 4.2;
    for (const b of blocs) {
      place(PAS * 2);
      k.s.texte(pt(x(), k.y), b.titre, { hauteur: H_POSTE, gras: true });
      k.y -= PAS;
      for (const l of b.lignes) {
        place(PAS);
        k.s.texte(pt(x() + 2, k.y), `— ${l}`, { hauteur: H_TEXTE });
        k.y -= PAS;
      }
      k.y -= 1.2;
    }
    k.y -= 4;
  }
  return planchesDe(k, 'gammes', 'Gammes de fabrication', meta).map((s) => ({
    ...s,
    postes: ['assemblage', 'debit', 'percage', 'controle'],
  }));
}
