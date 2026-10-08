import type { Colisage } from '../../bom/colisage';
import { roundMm } from '../../math/tolerance';
import { fenetreDe, type CartoucheData } from '../layout';
import { pt } from '../scene';
import type { Sheet } from '../sheet';
import { Curseur, planchesDe } from './curseur';
import { dessinerTableau, HAUTEUR_LIGNE, HAUTEUR_TETE, type Colonne } from './nomenclature';

/**
 * BORDEREAUX D'EXPÉDITION — un par colis, dans l'ordre du montage.
 *
 * Le chef d'expédition coche chaque ligne au chargement ; le chauffeur signe en
 * bas ; le chef de chantier recoche au déchargement. Une pièce oubliée à
 * l'atelier se voit avant que le camion ne parte, pas devant la grue.
 */

const COLONNES: Colonne[] = [
  { titre: 'Repère', poids: 1.2 },
  { titre: 'Profil', poids: 2 },
  { titre: 'Nb', poids: 0.7, aDroite: true },
  { titre: 'Longueur (mm)', poids: 1.4, aDroite: true },
  { titre: 'Masse (kg)', poids: 1.3, aDroite: true },
  { titre: 'Chargé', poids: 1 },
  { titre: 'Reçu', poids: 1 },
];

export function sheetsExpedition(c: Colisage, meta: CartoucheData['meta']): Sheet[] {
  const fenetre = fenetreDe('A3');
  const k = new Curseur(fenetre);

  k.s.texte(
    pt(fenetre.min.x, k.y),
    `${c.colis.length} colis — ${roundMm(c.masseTotale)} kg — ${c.transport.libelle} (${c.transport.longueurUtile / 1000} m, ${c.transport.chargeUtile / 1000} t)`,
    { hauteur: 3, gras: true },
  );
  k.y -= 8;

  for (const colis of c.colis) {
    k.reserver(10 + HAUTEUR_TETE + HAUTEUR_LIGNE * Math.min(4, colis.lignes.length) + 8);
    k.s.texte(pt(fenetre.min.x, k.y), `Colis ${colis.numero} — ${colis.phase}`, { hauteur: 2.8, gras: true });
    k.s.texte(
      pt(fenetre.max.x, k.y),
      `${roundMm(colis.masse)} kg — pièce la plus longue ${roundMm(colis.longueurMax)} mm — la plus lourde ${roundMm(colis.masseUnitaireMax)} kg`,
      { hauteur: 2.2, ancrage: 'droite' },
    );
    k.y -= 4;
    const lignes = colis.lignes.map((l) => [l.mark, l.profileId, String(l.nombre), String(roundMm(l.longueur)), String(roundMm(l.masse)), '', '']);
    let reste = lignes;
    while (reste.length > 0) {
      const place = Math.max(1, Math.floor((k.y - fenetre.min.y - HAUTEUR_TETE - 8) / HAUTEUR_LIGNE));
      const tranche = reste.slice(0, place);
      dessinerTableau(k.s, COLONNES, tranche, { min: pt(fenetre.min.x, fenetre.min.y), max: pt(fenetre.max.x, k.y) });
      k.y -= HAUTEUR_TETE + tranche.length * HAUTEUR_LIGNE + 4;
      reste = reste.slice(place);
      if (reste.length > 0) k.ouvrir();
    }
    k.s.texte(pt(fenetre.min.x, k.y), 'Camion : ……………   Chauffeur : ……………   Départ le : ……………   Signature : ……………', { hauteur: 2.1 });
    k.y -= 8;
  }

  if (c.horsGabarit.length > 0) {
    k.reserver(12);
    k.s.texte(pt(fenetre.min.x, k.y), 'HORS GABARIT — convoi spécial à organiser', { hauteur: 2.8, gras: true });
    k.y -= 5;
    for (const h of c.horsGabarit) {
      k.reserver(4.5);
      k.s.texte(pt(fenetre.min.x + 4, k.y), `${h.mark} — ${roundMm(h.longueur)} mm — ${roundMm(h.masse)} kg`, { hauteur: 2.3 });
      k.y -= 4.5;
    }
  }
  return planchesDe(k, 'colisage', 'Bordereaux d’expédition', meta);
}
