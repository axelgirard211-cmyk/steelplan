import { getProfile } from '../../catalog/index';
import type { StructuralModel } from '../../build/types';
import { platePaintM2, plateMassKg } from '../../build/buildProject';
import { epaisseurParoi } from '../../build/bolts';
import {
  designationFinition,
  epaisseurTotale,
  zincExigible,
  type FinitionParams,
} from '../../model/finition';
import { fenetreDe, type CartoucheData } from '../layout';
import { pt } from '../scene';
import type { Sheet } from '../sheet';
import { Curseur, planchesDe } from './curseur';
import { elementsAFabriquer, tolesLibres, type ElementFabrication } from './element';
import { dessinerTableau, HAUTEUR_LIGNE, HAUTEUR_TETE, type Colonne } from './nomenclature';

/**
 * BON DE TRAITEMENT DE SURFACE — la feuille du peintre ou du galvanisateur.
 *
 * Le système, puis chaque élément à traiter avec sa surface et sa masse : le
 * peintre facture au mètre carré, le galvanisateur à la tonne, et chacun a
 * besoin du chiffre de l'élément pour organiser ses passages. Viennent ensuite
 * les CONSIGNES PARTICULIÈRES, celles qui ne se rattrapent pas une fois la pièce
 * traitée : faces de contact à réserver, trous d'évent des corps creux.
 */

/** Extrait sec en volume retenu pour estimer la consommation (hypothèse affichée). */
const EXTRAIT_SEC = 0.6;
/** Pertes de pulvérisation : ce qui part à côté de la pièce. */
const PERTES = 0.4;

const COLONNES: Colonne[] = [
  { titre: 'Repère', poids: 1.1 },
  { titre: 'Désignation', poids: 2.2 },
  { titre: 'Nb', poids: 0.6, aDroite: true },
  { titre: 'm²/pièce', poids: 1, aDroite: true },
  { titre: 'm² total', poids: 1, aDroite: true },
  { titre: 'kg total', poids: 1.1, aDroite: true },
  { titre: 'Consignes', poids: 4.4 },
];

const virgule = (v: number, d = 2): string => v.toFixed(d).replace('.', ',');

export function sheetsPeinture(model: StructuralModel, f: FinitionParams, meta: CartoucheData['meta']): Sheet[] {
  const fenetre = fenetreDe('A3');
  const k = new Curseur(fenetre);
  const elements = elementsAFabriquer(model);
  const libres = tolesLibres(model);

  /* --- Le système --- */
  k.s.texte(pt(fenetre.min.x, k.y), designationFinition(f), { hauteur: 3.2, gras: true });
  k.y -= 6;
  if (f.type === 'peinture') {
    k.s.texte(pt(fenetre.min.x, k.y), `Préparation ${f.preparation} (EN ISO 8501-1) — catégorie ${f.categorie} (EN ISO 12944-2)`, { hauteur: 2.4 });
    k.y -= 4.5;
    for (const [i, c] of f.couches.entries()) {
      k.s.texte(pt(fenetre.min.x + 4, k.y), `Couche ${i + 1} : ${c.nom} — ${c.epaisseur} µm sec${c.ral ? ` — ${c.ral}` : ''}`, { hauteur: 2.4 });
      k.y -= 4.2;
    }
  }
  if (f.note) {
    k.s.texte(pt(fenetre.min.x, k.y), `Consigne générale : ${f.note}`, { hauteur: 2.4, gras: true });
    k.y -= 5;
  }
  k.y -= 3;

  /* --- Les éléments --- */
  const lignes = elements.map((e) => [
    e.repere,
    designation(e),
    String(e.quantite),
    virgule(e.surfaceUnitaire),
    virgule(e.surfaceUnitaire * e.quantite),
    String(Math.round(e.masseUnitaire * e.quantite)),
    consignes(e, f),
  ]);
  const parTole = new Map<string, { n: number; m2: number; kg: number }>();
  for (const pl of libres) {
    const d = parTole.get(pl.mark) ?? { n: 0, m2: platePaintM2(pl), kg: plateMassKg(pl) };
    d.n += 1;
    parTole.set(pl.mark, d);
  }
  for (const [mark, d] of parTole) {
    lignes.push([mark, 'Tôle livrée libre', String(d.n), virgule(d.m2), virgule(d.m2 * d.n), String(Math.round(d.kg * d.n)), '']);
  }
  let reste = lignes;
  while (reste.length > 0) {
    const place = Math.max(1, Math.floor((k.y - fenetre.min.y - HAUTEUR_TETE - 22) / HAUTEUR_LIGNE));
    const tranche = reste.slice(0, place);
    dessinerTableau(k.s, COLONNES, tranche, { min: pt(fenetre.min.x, fenetre.min.y), max: pt(fenetre.max.x, k.y) });
    k.y -= HAUTEUR_TETE + tranche.length * HAUTEUR_LIGNE + 6;
    reste = reste.slice(place);
    if (reste.length > 0) k.ouvrir();
  }

  /* --- Totaux et consommation --- */
  const m2 =
    elements.reduce((t, e) => t + e.surfaceUnitaire * e.quantite, 0) +
    [...parTole.values()].reduce((t, d) => t + d.m2 * d.n, 0);
  const kg = model.stats.massKg;
  k.reserver(18);
  k.s.texte(pt(fenetre.min.x, k.y), `Total à traiter : ${virgule(m2, 1)} m² — ${Math.round(kg)} kg`, { hauteur: 2.8, gras: true });
  k.y -= 5;
  if (f.type === 'peinture') {
    for (const c of f.couches) {
      // Consommation théorique : surface × épaisseur sèche / extrait sec.
      const litres = (m2 * c.epaisseur) / 1000 / EXTRAIT_SEC;
      k.s.texte(
        pt(fenetre.min.x + 4, k.y),
        `${c.nom} : ${virgule(litres, 0)} L théoriques — ${virgule(litres * (1 + PERTES), 0)} L à commander`,
        { hauteur: 2.3 },
      );
      k.y -= 4.2;
    }
    k.s.texte(
      pt(fenetre.min.x, k.y),
      `Hypothèses : extrait sec ${EXTRAIT_SEC * 100} % en volume, pertes de pulvérisation ${PERTES * 100} % — à remplacer par les fiches techniques du fournisseur.`,
      { hauteur: 2 },
    );
  } else if (f.type === 'galvanisation') {
    k.s.texte(pt(fenetre.min.x, k.y), `Épaisseur totale exigée : ${epaisseurTotale(f)} µm — par élément, voir la colonne Consignes (EN ISO 1461).`, { hauteur: 2.3 });
  }

  return planchesDe(k, 'peinture', 'Bon de traitement de surface', meta);
}

function designation(e: ElementFabrication): string {
  const p = getProfile(e.membre.profileId);
  const extra = e.toles.length + e.jarrets.length + e.pieces.length;
  return `${p.id}${extra > 0 ? ' assemblé' : ''}`;
}

/**
 * Ce que le traitement doit respecter sur CET élément.
 *
 * ⚠ Les faces de contact des assemblages précontraints (boulons 10.9) se
 * réservent : une peinture sous la tête d'un boulon HR fait chuter le coefficient
 * de frottement, et l'assemblage glisse. ⚠ En galvanisation, un tube fermé sans
 * trou d'évent éclate dans le bain : le galvanisateur refuse la pièce, ou pire.
 */
function consignes(e: ElementFabrication, f: FinitionParams): string {
  const out: string[] = [];
  const aboutsBoulonnes = e.toles.some((pl) => pl.kind === 'platine-about' && pl.holes.length > 0);
  if (aboutsBoulonnes && f.type !== 'brut') out.push(`réserver les faces de contact ${[...new Set(e.toles.filter((pl) => pl.kind === 'platine-about').map((pl) => pl.mark))].join(', ')}`);
  const forme = getProfile(e.membre.profileId).shape;
  if (f.type === 'galvanisation') {
    if (forme === 'CHS' || forme === 'BOX' || forme === 'RECT') out.push('corps creux : percer les trous d’évent');
    const mince = Math.min(...[e.membre, ...e.pieces].map((m) => epaisseurMini(m.profileId)), ...e.toles.map((pl) => pl.thickness));
    out.push(`zinc ≥ ${zincExigible(mince)} µm sur la paroi la plus mince (${mince} mm)`);
  }
  return out.join(' ; ');
}

/** Paroi la plus mince d'un profil : la fonction de la boulonnerie, pas une copie. */
function epaisseurMini(profileId: string): number {
  const p = getProfile(profileId);
  return Math.min(epaisseurParoi(p, { through: 'y' }), epaisseurParoi(p, { through: 'z' }));
}
