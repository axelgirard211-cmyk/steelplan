import { getProfile } from '../../catalog/index';
import { tauxDeChute, type CalepinageProfil } from '../../bom/calepinage';
import type { ImbricationEpaisseur } from '../../bom/imbrication';
import type { BoltLine } from '../../bom/index';
import { roundMm } from '../../math/tolerance';
import { fenetreDe, type CartoucheData } from '../layout';
import { pt } from '../scene';
import type { Sheet } from '../sheet';
import { Curseur, planchesDe } from './curseur';
import { dessinerTableau, HAUTEUR_LIGNE, HAUTEUR_TETE, type Colonne } from './nomenclature';

/**
 * COMMANDE MATIÈRE — ce que l'approvisionnement achète.
 *
 * ⚠ Pas la nomenclature : la nomenclature dit ce que pèse l'OUVRAGE, la
 * commande ce qu'il faut ACHETER pour le fabriquer — barres entières, tôles
 * entières, boulons de réserve. La différence, c'est la chute ; c'est elle qui
 * se paie sans se voir, et elle n'apparaissait nulle part.
 */

/** Réserve de boulonnerie : on en perd, on en casse, on en refuse au contrôle. */
const RESERVE_BOULONS = 0.05;

const COL_BARRES: Colonne[] = [
  { titre: 'Profil', poids: 2.2 },
  { titre: 'Nuance', poids: 1 },
  { titre: 'Barres', poids: 2.6 },
  { titre: 'À longueur', poids: 2.4 },
  { titre: 'Masse (kg)', poids: 1.3, aDroite: true },
  { titre: 'Chute', poids: 1, aDroite: true },
];
const COL_TOLES: Colonne[] = [
  { titre: 'Épaisseur', poids: 1.4 },
  { titre: 'Nuance', poids: 1 },
  { titre: 'Format (mm)', poids: 2 },
  { titre: 'Tôles', poids: 1, aDroite: true },
  { titre: 'Masse (kg)', poids: 1.3, aDroite: true },
  { titre: 'Hors format', poids: 3 },
];
const COL_BOULONS: Colonne[] = [
  { titre: 'Désignation', poids: 2.4 },
  { titre: 'Usage', poids: 3 },
  { titre: 'Net', poids: 1, aDroite: true },
  { titre: 'À commander', poids: 1.4, aDroite: true },
];

export function sheetsCommande(
  barres: readonly CalepinageProfil[],
  toles: readonly ImbricationEpaisseur[],
  boulons: readonly BoltLine[],
  masseNette: number,
  meta: CartoucheData['meta'],
): Sheet[] {
  const fenetre = fenetreDe('A3');
  const k = new Curseur(fenetre);

  const section = (titre: string, colonnes: Colonne[], lignes: string[][]): void => {
    if (lignes.length === 0) return;
    k.reserver(8 + HAUTEUR_TETE + HAUTEUR_LIGNE * Math.min(3, lignes.length));
    k.s.texte(pt(fenetre.min.x, k.y), titre, { hauteur: 3, gras: true });
    k.y -= 5;
    // Le tableau se coupe sur plusieurs planches s'il le faut.
    let reste = lignes;
    while (reste.length > 0) {
      const place = Math.max(1, Math.floor((k.y - fenetre.min.y - HAUTEUR_TETE) / HAUTEUR_LIGNE));
      const tranche = reste.slice(0, place);
      dessinerTableau(k.s, colonnes, tranche, { min: pt(fenetre.min.x, fenetre.min.y), max: pt(fenetre.max.x, k.y) });
      k.y -= HAUTEUR_TETE + tranche.length * HAUTEUR_LIGNE + 8;
      reste = reste.slice(place);
      if (reste.length > 0) k.ouvrir();
    }
  };

  section(
    'BARRES ET PROFILÉS',
    COL_BARRES,
    barres.map((c) => {
      const parLongueur = new Map<number, number>();
      for (const s of c.schemas) parLongueur.set(s.barre, (parLongueur.get(s.barre) ?? 0) + s.nombre);
      const enBarres = [...parLongueur.entries()].map(([l, n]) => `${n} × ${l / 1000} m`).join(' + ') || '—';
      const aLongueur =
        c.aLongueur.length > 0
          ? `${c.aLongueur.length} × (${[...new Set(c.aLongueur.map((x) => roundMm(x.longueur)))].join(', ')})`
          : '—';
      return [
        getProfile(c.profil).id,
        c.grade,
        enBarres,
        aLongueur,
        String(roundMm(c.masseCommandee)),
        `${(tauxDeChute(c) * 100).toFixed(1).replace('.', ',')} %`,
      ];
    }),
  );
  section(
    'TÔLES',
    COL_TOLES,
    toles.map((e) => [
      `${e.epaisseur} mm`,
      e.grade,
      `${e.longueur} × ${e.largeur}`,
      String(e.toles),
      String(roundMm(e.masseCommandee)),
      e.horsFormat.length > 0 ? [...new Set(e.horsFormat)].join(', ') : '—',
    ]),
  );
  section(
    'BOULONNERIE ET TIGES D’ANCRAGE',
    COL_BOULONS,
    boulons.map((b) => [b.designation, b.usage, String(b.count), String(Math.ceil(b.count * (1 + RESERVE_BOULONS)))]),
  );

  // Bilan : ce qu'on achète, ce qu'on livre, et la différence.
  const achete =
    barres.reduce((t, c) => t + c.masseCommandee, 0) + toles.reduce((t, e) => t + e.masseCommandee, 0);
  k.reserver(14);
  k.s.texte(pt(fenetre.min.x, k.y), `Acier commandé : ${roundMm(achete)} kg — acier livré : ${roundMm(masseNette)} kg`, {
    hauteur: 2.8,
    gras: true,
  });
  k.y -= 5;
  k.s.texte(
    pt(fenetre.min.x, k.y),
    `Chutes et tombées : ${roundMm(achete - masseNette)} kg (${(((achete - masseNette) / Math.max(1, achete)) * 100).toFixed(1).replace('.', ',')} %) — ` +
      `boulonnerie : réserve de ${RESERVE_BOULONS * 100} % incluse`,
    { hauteur: 2.2 },
  );

  return planchesDe(k, 'commande', 'Commande matière', meta);
}
