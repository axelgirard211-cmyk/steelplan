import type { Plate, StructuralModel } from '../../build/types';
import { getProfile } from '../../catalog/index';
import type { FinitionParams } from '../../model/finition';
import { dessinerCadre, fenetreDe, type CartoucheData, type SheetFormat } from '../layout';
import { DrawScene, pt, type Bbox } from '../scene';
import type { Sheet } from '../sheet';
import { dessinerCoupe, planDeVues } from './coupes';
import { dessinerVue3D } from './vue3d';
import { encombrementTole, type ElementFabrication } from './element';
import { dessinerNomenclature, dessinerNotes } from './fabricationBlocs';
import { dessinerVuesAssemblage } from './fabricationVues';
import { dessinerToleAPlat, largeurNecessaire } from './toleAPlat';

/**
 * PLAN D'ASSEMBLAGE D'ÉLÉMENT — ce que l'assembleur pointe et soude.
 *
 * ⚠ Il devait tout porter sur une feuille — vues, tôles à plat, nomenclature,
 * gamme — et ne montrait plus rien : un poteau de six mètres au 1:100, six
 * centimètres de papier où goussets, platine et équerres se recouvraient, sous
 * un éventail de symboles de soudure. On ne s'y repérait pas à l'atelier.
 *
 * Il est désormais tracé comme un plan d'atelier :
 *  - VUE DE FACE de l'élément, interrompue là où il n'y a rien à souder, à
 *    l'échelle des pièces qu'il reçoit ; VUE DE DESSUS projetée sous elle, sur le
 *    même alignement, quand des pièces se posent sur la semelle (projection
 *    européenne) ;
 *  - BULLES DE REPÈRE rangées au-dessus de la vue, une par repère ;
 *  - un TRAIT DE COUPE à chaque pièce soudée, et la COUPE correspondante en bas
 *    de planche, à grande échelle : profil tranché, pièce à sa place, cotes
 *    depuis l'axe du profil, symbole de soudure au joint ;
 *  - la NOMENCLATURE et les NOTES — tolérances, soudage, traitement.
 *
 * Les tôles à plat ont leurs planches de découpe ; la gamme a sa fiche. Chacune
 * à sa place, et la vue de l'élément a toute la sienne.
 */

/** Largeur de la colonne écrite, à droite des vues. */
const LARGEUR_TEXTE = 122;
/** Hauteur gardée aux vues de l'élément (mm papier). */
const HAUTEUR_VUES = 104;

export interface FabricationOptions {
  readonly format?: SheetFormat;
  readonly page: number;
  readonly total: number;
  readonly meta: CartoucheData['meta'];
  /** Traitement de surface du projet : il figure aux notes. */
  readonly finition: FinitionParams;
}

export function sheetFabrication(e: ElementFabrication, opts: FabricationOptions): Sheet {
  const format = opts.format ?? 'A3';
  const m = e.membre;
  const profil = getProfile(m.profileId);
  const fenetre = fenetreDe(format);
  const s = new DrawScene();
  const xTexte = fenetre.max.x - LARGEUR_TEXTE;
  const droite = xTexte - 6;

  /*
   * --- En bas : la vue de l'about d'origine à GAUCHE, sous lui ; les coupes
   * nécessaires au milieu ; la vue de l'about d'extrémité à DROITE, sous lui.
   * On regarde sous une extrémité pour voir sa vue de bout.
   */
  const plan = planDeVues(e);
  const cases = [
    ...(plan.gauche
      ? [{ c: plan.gauche, titre: `VUE ${plan.gauche.lettre} — ${plan.deuxBouts ? 'aux deux abouts' : 'about d’origine'}` }]
      : []),
    ...plan.coupes.map((c) => ({ c, titre: undefined as string | undefined })),
    ...(plan.droite ? [{ c: plan.droite, titre: `VUE ${plan.droite.lettre} — about d’extrémité` }] : []),
  ];
  const hBas = cases.length > 0 ? Math.min(72, fenetre.max.y - fenetre.min.y - HAUTEUR_VUES - 4) : 0;
  if (cases.length > 0) {
    const largeur = (droite - fenetre.min.x) / Math.max(cases.length, 3);
    // Une vue de bout seule se place sous SON extrémité, pas au milieu.
    const x0De = (i: number): number =>
      cases[i]?.c === plan.droite ? droite - largeur : fenetre.min.x + i * largeur;
    s.texte(pt(fenetre.min.x, fenetre.min.y + hBas - 1), 'VUES DE BOUT ET COUPES — cotes depuis l’axe du profil', {
      hauteur: 2.4,
      gras: true,
    });
    s.ligne(pt(fenetre.min.x, fenetre.min.y + hBas + 1.5), pt(droite, fenetre.min.y + hBas + 1.5), 'cotation');
    for (const [i, { c, titre }] of cases.entries()) {
      const x0 = x0De(i);
      dessinerCoupe(s, e, c, { min: pt(x0 + 1, fenetre.min.y + 1), max: pt(x0 + largeur - 1, fenetre.min.y + hBas - 6) }, titre ? { titre } : {});
      if (i > 0) s.ligne(pt(x0, fenetre.min.y + 4), pt(x0, fenetre.min.y + hBas - 8), 'contour-fin');
    }
  }

  const { echelle, raccourci } = dessinerVuesAssemblage(
    s,
    e,
    { min: pt(fenetre.min.x, fenetre.min.y + hBas + 4), max: pt(droite, fenetre.max.y) },
    plan,
  );

  const bas = dessinerNomenclature(s, e, { min: pt(xTexte, fenetre.min.y), max: fenetre.max });
  const sousNotes = dessinerNotes(s, e, opts.finition, { min: pt(xTexte, fenetre.min.y), max: pt(fenetre.max.x, bas - 4) });
  // Sous les notes, la pièce en 3D : pour la reconnaître, pas pour la mesurer.
  if (sousNotes - fenetre.min.y >= 45) {
    dessinerVue3D(s, e, { min: pt(xTexte, fenetre.min.y + 2), max: pt(fenetre.max.x, sousNotes - 2) }, raccourci);
  }
  // La colonne écrite est séparée des vues par un filet : sans lui, les titres
  // des blocs se lisent comme des légendes du dessin voisin.
  s.ligne(pt(xTexte - 3, fenetre.min.y), pt(xTexte - 3, fenetre.max.y), 'cotation');

  // ⚠ Le repère d'ASSEMBLAGE, celui qu'on peint sur la pièce finie — et non
  // celui de la barre, que partagent la traverse de gauche et celle de droite.
  const titre = `Assemblage ${e.repere} — ${profil.id} (${e.quantite} pièce${e.quantite > 1 ? 's' : ''})`;
  dessinerCadre(s, format, { meta: opts.meta, titre, echelle, page: opts.page, total: opts.total });

  return {
    id: `fabrication-${e.repere}`,
    kind: 'fabrication',
    titre: `Assemblage ${e.repere}`,
    format,
    echelle,
    scene: s,
  };
}

/* ------------------------------------------------------------------ */

/** Entre deux vues, la place d'un libellé de cote : celui d'une cote courte s'écrit hors de sa ligne. */
const ECART = 16;
/** Les tôles côte à côte, chacune dans la largeur qu'elle occupe à cette hauteur. */
function rangeeDeToles(
  s: DrawScene,
  distinctes: readonly { pl: Parameters<typeof dessinerToleAPlat>[1]; nombre: number }[],
  zone: Bbox,
): void {
  const hauteur = zone.max.y - zone.min.y;
  const utiles = distinctes.map(({ pl }) => {
    const d = encombrementTole(pl);
    return largeurNecessaire(d.largeur, d.hauteur, hauteur);
  });
  const somme = utiles.reduce((a, b) => a + b, 0) + ECART * (distinctes.length + 1);
  let x = zone.min.x + Math.max(0, (zone.max.x - zone.min.x - somme) / 2) + ECART;
  for (const [i, { pl, nombre }] of distinctes.entries()) {
    const largeur = utiles[i] as number;
    dessinerToleAPlat(s, pl, nombre, { min: pt(x, zone.min.y), max: pt(x + largeur, zone.max.y) });
    x += largeur + ECART;
  }
}

/**
 * TÔLES À PLAT — le plan de découpe de chaque repère de tôle, une vue cotée par
 * repère, avec la quantité totale à découper.
 *
 * ⚠ Les tôles n'avaient de vue cotée que dans la bande de détails de chaque
 * plan d'assemblage : six tôles s'y partageaient 180 mm et tombaient à un
 * contour de 0,4 mm, et un même gousset, posé sur dix traverses, était redessiné
 * dix fois. Le découpeur reçoit ici chaque repère une fois.
 */
export function sheetsTolesAPlat(model: StructuralModel, opts: FabricationOptions): Sheet[] {
  const format = opts.format ?? 'A3';
  const fenetre = fenetreDe(format);
  const parRepere = new Map<string, { pl: Plate; nombre: number }>();
  for (const pl of model.plates) {
    const d = parRepere.get(pl.mark);
    if (d) d.nombre += 1;
    else parRepere.set(pl.mark, { pl, nombre: 1 });
  }
  const toutes = [...parRepere.values()].sort((a, b) => a.pl.mark.localeCompare(b.pl.mark, 'fr', { numeric: true }));
  if (toutes.length === 0) return [];

  const RANGEES = 3;
  const hauteurRangee = (fenetre.max.y - fenetre.min.y - 8) / RANGEES;
  const largeurDe = (pl: Plate): number => {
    const d = encombrementTole(pl);
    return largeurNecessaire(d.largeur, d.hauteur, hauteurRangee - 8) + ECART;
  };
  // Rangées remplies dans l'ordre des repères, tant que la largeur le permet.
  const rangees: (typeof toutes)[] = [];
  let courante: typeof toutes = [];
  let largeur = ECART;
  for (const t of toutes) {
    const l = largeurDe(t.pl);
    if (courante.length > 0 && largeur + l > fenetre.max.x - fenetre.min.x) {
      rangees.push(courante);
      courante = [];
      largeur = ECART;
    }
    courante.push(t);
    largeur += l;
  }
  rangees.push(courante);

  const planches: Sheet[] = [];
  for (let n = 0; n * RANGEES < rangees.length; n++) {
    const s = new DrawScene();
    for (const [r, rangee] of rangees.slice(n * RANGEES, (n + 1) * RANGEES).entries()) {
      const haut = fenetre.max.y - 4 - r * hauteurRangee;
      rangeeDeToles(s, rangee, { min: pt(fenetre.min.x, haut - hauteurRangee + 8), max: pt(fenetre.max.x, haut) });
    }
    const total = Math.ceil(rangees.length / RANGEES);
    const titre = `Tôles à plat — plans de découpe${total > 1 ? ` (${n + 1}/${total})` : ''}`;
    dessinerCadre(s, format, { meta: opts.meta, titre, echelle: 1, page: opts.page, total: opts.total });
    planches.push({
      id: `toles-a-plat-${n + 1}`,
      kind: 'atelier',
      titre,
      format,
      echelle: 1,
      scene: s,
      postes: ['tolerie', 'assemblage', 'controle'],
    });
  }
  return planches;
}
