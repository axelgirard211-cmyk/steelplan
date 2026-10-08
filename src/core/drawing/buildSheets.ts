import type { StructuralModel } from '../build/types';
import { frameStations } from '../model/grid';
import { lettreDeCoupe } from './coupeRepere';
import type { ProjectParams } from '../model/project';
import { sheetDebit } from './sheets/debit';
import { sheetsCalepinage } from './sheets/calepinage';
import { calepiner } from '../bom/calepinage';
import { imbriquer } from '../bom/imbrication';
import { sheetsTolerie } from './sheets/tolerie';
import { sheetsCommande } from './sheets/commande';
import { sheetsPeinture } from './sheets/peinture';
import { sheetsControle } from './sheets/controle';
import { sheetsExpedition } from './sheets/expedition';
import { colisage } from '../bom/colisage';
import { elementsAFabriquer, piecesDeDebit } from './sheets/element';
import { PAGE_A_NUMEROTER } from './layout';
import { sheetFabrication, sheetsTolesAPlat } from './sheets/fabrication';
import { sheetsGammes } from './sheets/gammes';
import { fileDesDetails, sheetDetail, zoneDeDetail, type DetailKind } from './sheets/detail';
import { sheetFondations } from './sheets/fondations';
import { sheetsMontage } from './sheets/montage';
import { sheetCoupe, sheetPlan, type CoupeRepere } from './sheets/ensemble';
import { sheetElevations } from './sheets/elevations';
import { sheetFacade, type Face } from './sheets/facades';
import { sheetsNomenclature } from './sheets/nomenclature';
import { sheetsNote } from './sheets/note';
import type { ChecksReport } from '../checks/types';
import type { Bom } from '../bom/index';
import type { Sheet } from './sheet';

/**
 * Constitution du DOSSIER DE PLANS complet.
 *
 * Comme le reste, c'est une fonction pure du modèle : le dossier n'est pas
 * stocké, il est reconstruit. Modifier une portée régénère donc toutes les
 * planches, cotations comprises, sans risque qu'une planche reste en arrière.
 *
 * Ordre du dossier, celui d'un dossier d'exécution : les plans d'ensemble
 * d'abord pour situer, les plans de débit ensuite pour fabriquer.
 */
export function buildSheets(
  model: StructuralModel,
  p: ProjectParams,
  bom?: Bom,
  checks?: ChecksReport,
): Sheet[] {
  /*
   * Deux coupes transversales : une file COURANTE, qui est le cas général de
   * fabrication, et le PIGNON, qui porte les potelets et son contreventement.
   * Ne donner que le pignon — la file 1 — donnerait une coupe atypique.
   *
   * Chacune reçoit sa LETTRE ici, une seule fois : c'est elle qui relie le trait
   * de coupe tracé sur la vue en plan au titre de la planche. Les attribuer des
   * deux côtés séparément, c'est se donner l'occasion de les faire diverger.
   */
  const fileCourante = fileDesDetails(p);
  const avecPignon = p.grid.nBays >= 2;
  const stations = frameStations(p.grid);
  const coupes: { station: number; repere: CoupeRepere }[] = [
    { station: fileCourante, repere: { lettre: lettreDeCoupe(0), x: stations[fileCourante] ?? 0 } },
    ...(avecPignon
      ? [{ station: 0, repere: { lettre: lettreDeCoupe(1), x: stations[0] ?? 0 } }]
      : []),
  ];

  /*
   * LES QUATRE FAÇADES. Le dossier n'en portait qu'une, et la « coupe de
   * pignon » n'en tenait pas lieu : une coupe montre ce qu'il y a dedans, une
   * façade ce qu'on voit du dehors.
   */
  const faces: Face[] = ['avant', 'arriere', 'ouest', 'est'];

  /*
   * Détails d'assemblage : ceux qui existent RÉELLEMENT dans ce modèle, chacun
   * avec sa LETTRE de renvoi.
   *
   * ⚠ Les lettres CONTINUENT la série des coupes (A, B pour les coupes, puis C,
   * D, E…) : sur un même dossier, « A » ne doit désigner qu'une chose. La
   * planche BEM prise pour modèle mêle « Coupe A-A » et « Détail A » sur la même
   * feuille, et il faut alors deviner lequel des deux on cherche.
   *
   * ⚠⚠ On ne garde que les nœuds présents AVANT de compter les planches. Le
   * total était calculé sur les détails possibles, puis réduit d'une page à
   * chaque détail absent : les cartouches annonçaient alors « 12/56 » sur un
   * dossier de 55 planches.
   */
  const candidats: DetailKind[] = [
    ...(p.frame.enabled ? (['genou', 'faitage'] as const) : []),
    'pied',
    ...(p.bracing.wall.enabled ? (['palee'] as const) : []),
  ];
  const details = candidats
    .map((kind) => ({ kind, zone: zoneDeDetail(model, p, kind) }))
    .filter((d): d is { kind: DetailKind; zone: NonNullable<typeof d.zone> } => d.zone !== null)
    .map((d, i) => ({ ...d, lettre: lettreDeCoupe(coupes.length + i) }));

  /*
   * ATELIER — un plan de PIÈCE par repère de débit, un plan d'ASSEMBLAGE par
   * élément qui porte quelque chose de soudé.
   *
   * ⚠ Le dossier éditait un plan de débit ET un plan de fabrication pour chaque
   * repère, y compris pour une panne qui n'a rien de soudé : la même barre, les
   * mêmes trous, deux fois — dix-sept planches sur cinquante-cinq. Une pièce
   * nue n'a besoin que de son plan de pièce ; l'assemblage n'a de plan que s'il
   * assemble quelque chose.
   */
  const pieces = piecesDeDebit(model);
  const assemblages = elementsAFabriquer(model).filter(
    (e) => e.toles.length + e.jarrets.length + e.pieces.length > 0,
  );

  // Numérotation en fin de dossier : chaque planche est construite « à
  // numéroter », puis reçoit son rang une fois le dossier entier connu.
  const sansNumero = { page: 0, total: 0, meta: p.meta };

  const sheets: Sheet[] = [sheetPlan(model, p, coupes.map((c) => c.repere), sansNumero)];
  /*
   * ⚠ La PLANCHE D'ÉLÉVATION vient avant les façades détaillées, et ne les
   * remplace pas. Elle porte les quatre faces côte à côte à la même échelle :
   * c'est le document de compréhension d'ensemble, celui qu'on étale pour voir
   * comment les faces se répondent. Les planches par façade restent le document
   * de travail du bardeur, avec leurs cotes et leurs niveaux.
   */
  sheets.push(sheetElevations(model, p, sansNumero));
  // Le renvoi de l'attache de palée va sur la façade où elle se voit.
  const renvoisDeFacade = (face: Face) =>
    face === 'avant'
      ? details.filter((d) => d.kind === 'palee').map((d) => ({ lettre: d.lettre, point: d.zone.point, rayon: d.zone.rayon }))
      : [];
  for (const face of faces) sheets.push(sheetFacade(model, p, face, sansNumero, renvoisDeFacade(face)));
  for (const c of coupes) {
    // Les renvois vont sur la coupe de la file détaillée, et sur elle seule.
    const renvois =
      c.station === fileCourante
        ? details
            .filter((d) => d.kind !== 'palee')
            .map((d) => ({ lettre: d.lettre, point: d.zone.point, rayon: d.zone.rayon }))
        : [];
    sheets.push(sheetCoupe(model, p, c.station, c.repere.lettre, sansNumero, renvois));
  }
  for (const d of details) {
    const planche = sheetDetail(model, p, d.kind, { ...sansNumero, lettre: d.lettre });
    if (planche) sheets.push(planche);
  }

  /*
   * Plans de repérage : ils suivent les détails d'assemblage et précèdent
   * l'atelier. Ils s'adressent au CHANTIER, pas à l'atelier — c'est le seul
   * document qui dise quelle pièce va à quelle file, et dans quel ordre lever.
   */
  sheets.push(...sheetsMontage(model, p, sansNumero));

  /*
   * ⚠ L'implantation des ancrages vient AVANT les plans d'atelier, et ce n'est
   * pas un détail d'ordre : c'est la première planche que le chantier utilise.
   * Les semelles se coulent des semaines avant que l'acier n'arrive.
   */
  if (checks) {
    const f = sheetFondations(model, checks, sansNumero);
    if (f) sheets.push(f);
  }

  /*
   * L'atelier commence par l'ACHAT : la commande matière se passe des semaines
   * avant le premier coup de scie. Puis le débit, avec son calepinage — ce
   * qu'il sort du parc, et comment il le coupe.
   */
  const calepinage = calepiner(model, p.atelier);
  const imbrication = imbriquer(model, p.atelier);
  if (bom) sheets.push(...sheetsCommande(calepinage, imbrication, bom.bolts, model.stats.massKg, p.meta));
  sheets.push(...sheetsCalepinage(calepinage, { meta: p.meta }));
  for (const { membre, quantite } of pieces) {
    sheets.push(sheetDebit(membre, { ...sansNumero, quantite }));
  }
  // La tôlerie découpe les platines avant que l'assemblage ne les soude.
  if (model.plates.length > 0) {
    sheets.push(...sheetsTolerie(imbrication, model.plates, p.meta));
    // Puis chaque repère de tôle en vraie forme, coté : le plan de découpe.
    sheets.push(...sheetsTolesAPlat(model, { ...sansNumero, finition: p.finition }));
  }
  for (const e of assemblages) {
    sheets.push(sheetFabrication(e, { ...sansNumero, finition: p.finition }));
  }
  // La gamme de chaque élément, sur sa fiche : un plan dit où, la gamme dans quel ordre.
  if (assemblages.length > 0) sheets.push(...sheetsGammes(assemblages, p.finition, p.meta));
  /*
   * Puis la pièce quitte l'assemblage dans l'ordre de l'atelier : traitement de
   * surface, contrôle — qui mesure aussi l'épaisseur du revêtement —, et
   * expédition, camion par camion.
   */
  if (p.finition.type !== 'brut') sheets.push(...sheetsPeinture(model, p.finition, p.meta));
  sheets.push(...sheetsControle(model, p.atelier, p.finition, p.meta));
  sheets.push(...sheetsExpedition(colisage(model), p.meta));

  // Les nomenclatures ferment le dossier, avec le même cartouche et le même
  // indice que les plans : imprimées à part, elles finiraient désynchronisées.
  if (bom) sheets.push(...sheetsNomenclature(bom, sansNumero));

  // La note de pré-dimensionnement ferme le dossier, elle aussi au même indice :
  // des taux de travail détachés des plans qui les ont produits ne se recoupent
  // plus.
  if (checks) sheets.push(...sheetsNote(checks, sansNumero));

  return numeroter(sheets);
}

/** Écrit sur chaque cartouche son rang dans le dossier, une fois le dossier complet. */
function numeroter(sheets: Sheet[]): Sheet[] {
  for (const [i, s] of sheets.entries()) {
    s.scene.remplacerTexte(PAGE_A_NUMEROTER, `${i + 1}/${sheets.length}`);
  }
  return sheets;
}
