import { getProfile } from '../../catalog/index';
import type { StructuralModel } from '../../build/types';
import { cutLengths } from '../../geometry/member';
import { designationSoudure } from '../../geometry/weld';
import { roundMm } from '../../math/tolerance';
import type { AtelierParams } from '../../model/atelier';
import { designationFinition, epaisseurTotale, type FinitionParams } from '../../model/finition';
import { fenetreDe, type CartoucheData } from '../layout';
import { pt } from '../scene';
import type { Sheet } from '../sheet';
import { Curseur, planchesDe } from './curseur';
import { elementsAFabriquer, implantations, type ElementFabrication } from './element';
import { dessinerTableau, HAUTEUR_LIGNE, HAUTEUR_TETE, type Colonne } from './nomenclature';

/**
 * FICHE DE CONTRÔLE — le procès-verbal que le contrôleur remplit avant
 * expédition.
 *
 * Pour chaque élément : ce qu'il faut mesurer, la valeur attendue — lue dans le
 * modèle, comme toute cote du dossier —, la tolérance, puis des cases VIDES pour
 * la mesure, la conformité et le visa. Une pièce sans PV n'est pas une pièce
 * contrôlée, et une fiche à remplir de mémoire n'est pas un PV.
 *
 * ⚠ Les tolérances retenues sont des tolérances d'atelier courantes, alignées
 * sur l'annexe B de l'EN 1090-2. Elles ne remplacent pas le PLAN QUALITÉ du
 * fabricant, qui seul les fixe pour un chantier donné — la fiche le dit en tête.
 */

const COLONNES: Colonne[] = [
  { titre: 'Repère', poids: 0.9 },
  { titre: 'Point de contrôle', poids: 3 },
  { titre: 'Attendu', poids: 2.2 },
  { titre: 'Tolérance', poids: 1.6 },
  { titre: 'Mesuré', poids: 1.3 },
  { titre: 'Conforme', poids: 1 },
  { titre: 'Visa', poids: 0.9 },
];

export function sheetsControle(
  model: StructuralModel,
  atelier: AtelierParams,
  finition: FinitionParams,
  meta: CartoucheData['meta'],
): Sheet[] {
  const fenetre = fenetreDe('A3');
  const k = new Curseur(fenetre);

  k.s.texte(pt(fenetre.min.x, k.y), `Classe d’exécution ${atelier.classeExecution} — NF EN 1090-2`, { hauteur: 3.2, gras: true });
  k.y -= 5.5;
  k.s.texte(
    pt(fenetre.min.x, k.y),
    'Tolérances d’atelier usuelles (EN 1090-2, annexe B), à confirmer ou remplacer par le plan qualité du fabricant.',
    { hauteur: 2.2 },
  );
  k.y -= 4.2;
  k.s.texte(pt(fenetre.min.x, k.y), 'Contrôleur : ………………………   Date : ……………   Plan qualité n° : ……………', { hauteur: 2.4 });
  k.y -= 7;

  const lignes = elementsAFabriquer(model).flatMap((e) => pointsDeControle(e, finition));
  let reste = lignes;
  while (reste.length > 0) {
    const place = Math.max(1, Math.floor((k.y - fenetre.min.y - HAUTEUR_TETE) / HAUTEUR_LIGNE));
    const tranche = reste.slice(0, place);
    dessinerTableau(k.s, COLONNES, tranche, { min: pt(fenetre.min.x, fenetre.min.y), max: pt(fenetre.max.x, k.y) });
    reste = reste.slice(place);
    if (reste.length > 0) k.ouvrir();
    else k.y -= HAUTEUR_TETE + tranche.length * HAUTEUR_LIGNE;
  }
  return planchesDe(k, 'controle', 'Fiche de contrôle avant expédition', meta);
}

/** Les points à contrôler sur un élément, dans l'ordre où on les vérifie. */
function pointsDeControle(e: ElementFabrication, f: FinitionParams): string[][] {
  const m = e.membre;
  const l = cutLengths(m);
  const vide = ['', '', ''];
  const rep = `${e.repere} ×${e.quantite}`;
  const out: string[][] = [
    // ± (2 + L/5000) : la tolérance de longueur des pièces fabriquées.
    [rep, 'Longueur hors-tout', `${roundMm(l.max)} mm`, `± ${(2 + l.max / 5000).toFixed(1).replace('.', ',')} mm`, ...vide],
    ['', 'Rectitude', '—', `L/750 = ${Math.round(l.max / 750)} mm`, ...vide],
  ];
  if (m.holes.length > 0) {
    out.push(['', `Perçages (${m.holes.length} trous) — position`, 'plan de pièce', '± 2 mm', ...vide]);
  }
  for (const im of implantations(e)) {
    const nomAbout = im.about === 'origine' ? 'origine' : 'extrémité';
    out.push([
      '',
      `Implantation ${im.pl.mark}`,
      im.fente
        ? `saillie ${roundMm(im.fente.saillie)} hors de l’about ${nomAbout}`
        : im.about === null
          ? `à ${roundMm(im.depuisAbout)} de l’about`
          : `sur l’about ${nomAbout}`,
      im.about === null || im.fente ? '± 2 mm' : 'équerrage',
      ...vide,
    ]);
  }
  const pieces = new Map<string, number>();
  for (const x of e.pieces) pieces.set(x.mark, (pieces.get(x.mark) ?? 0) + 1);
  for (const [mark, n] of pieces) {
    out.push(['', `Implantation ${mark} × ${n}`, 'cotes cumulées du plan', '± 2 mm', ...vide]);
  }
  const cordons = [...new Set(e.soudures.map((w) => designationSoudure(w)))];
  for (const c of cordons) out.push(['', `Soudure ${c}`, 'contrôle visuel', 'gorge ≥ nominale', ...vide]);
  if (f.type !== 'brut') {
    out.push([
      '',
      'Traitement de surface',
      designationFinition(f).split(' — ')[0] ?? '',
      f.type === 'peinture' ? `${epaisseurTotale(f)} µm (règle 80/20)` : `${f.zincMicrons} µm mini`,
      ...vide,
    ]);
  }
  out.push(['', `Marquage du repère ${e.repere}`, getProfile(m.profileId).id, 'lisible', ...vide]);
  return out;
}
