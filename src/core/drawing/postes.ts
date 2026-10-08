import { dessinerCadre, fenetreDe, PAGE_A_NUMEROTER, type CartoucheData } from './layout';
import { DrawScene, pt } from './scene';
import type { Sheet } from './sheet';
import { dessinerTableau, HAUTEUR_LIGNE, HAUTEUR_TETE, type Colonne } from './sheets/nomenclature';

/**
 * DIFFUSION DU DOSSIER — quelle planche va à quel poste.
 *
 * ⚠ Un dossier d'exécution n'est pas lu d'un bout à l'autre par une seule
 * personne. Le débiteur a besoin des plans de pièce et du calepinage, pas de la
 * note de calcul ; le soudeur, des plans d'assemblage ; le peintre, de son bon
 * de traitement. Remettre à chacun les soixante planches, c'est lui laisser
 * trouver seul les cinq qui le concernent — et lui laisser travailler sur une
 * planche périmée qu'il aura gardée d'un envoi précédent.
 *
 * La table est écrite UNE FOIS, ici : la liste des planches de chaque poste et
 * son bordereau d'envoi en découlent, et ne peuvent pas se contredire.
 */
export type Poste =
  | 'bureau'
  | 'approvisionnement'
  | 'debit'
  | 'percage'
  | 'tolerie'
  | 'assemblage'
  | 'peinture'
  | 'controle'
  | 'expedition'
  | 'montage'
  | 'genie-civil';

export interface DefinitionPoste {
  readonly id: Poste;
  readonly libelle: string;
  /** Ce que le poste fait de son dossier — imprimé sur le bordereau. */
  readonly objet: string;
  /** Fichiers machine qui accompagnent les planches, s'il y en a. */
  readonly fichiers?: string;
}

/** Les postes, dans l'ordre où la pièce les traverse. */
export const POSTES: readonly DefinitionPoste[] = [
  { id: 'bureau', libelle: 'Bureau d’études', objet: 'Contrôle et approbation du dossier complet' },
  { id: 'approvisionnement', libelle: 'Approvisionnement', objet: 'Commande des barres, des tôles et de la boulonnerie' },
  {
    id: 'debit',
    libelle: 'Débit (scie)',
    objet: 'Coupe des barres à longueur et aux angles, dans l’ordre du calepinage',
  },
  {
    id: 'percage',
    libelle: 'Perçage',
    objet: 'Perçage des barres, face par face',
    fichiers: 'Lot de fichiers DSTV (.nc1), un par repère de pièce',
  },
  {
    id: 'tolerie',
    libelle: 'Tôlerie (oxycoupage / plasma)',
    objet: 'Découpe et perçage des platines, goussets et éclisses',
    fichiers: 'Fichiers DXF de découpe, un par repère de tôle',
  },
  {
    id: 'assemblage',
    libelle: 'Assemblage et soudage',
    objet: 'Pointage des tôles et pièces soudées, puis soudage',
  },
  { id: 'peinture', libelle: 'Traitement de surface', objet: 'Préparation, protection et finition' },
  { id: 'controle', libelle: 'Contrôle', objet: 'Contrôle dimensionnel et visuel avant expédition (EN 1090-2)' },
  { id: 'expedition', libelle: 'Expédition', objet: 'Colisage et chargement, dans l’ordre du montage' },
  { id: 'montage', libelle: 'Montage (chantier)', objet: 'Levage, assemblage et réglage sur site' },
  { id: 'genie-civil', libelle: 'Génie civil', objet: 'Implantation des massifs et des tiges d’ancrage' },
];

/**
 * Postes destinataires d'une planche.
 *
 * Une planche qui déclare elle-même ses destinataires est crue ; sinon on les
 * déduit de son identifiant. ⚠ Une planche qu'aucune règle ne reconnaît va au
 * bureau d'études, et à lui seul : mieux vaut qu'il la voie et la reclasse
 * qu'elle parte vers un poste qui ne saurait pas quoi en faire.
 */
export function destinataires(s: Sheet): readonly Poste[] {
  return regleDe(s) ?? ['bureau'];
}

/** Destinataires que la planche déclare ou que la table lui donne ; `null` sinon. */
export function regleDe(s: Sheet): readonly Poste[] | null {
  if (s.postes && s.postes.length > 0) return s.postes;
  const id = s.id;
  const regle: [RegExp, Poste[]][] = [
    [/^(plan|elevations|facade-|coupe-)/, ['bureau', 'montage']],
    [/^detail-/, ['bureau', 'montage', 'assemblage']],
    [/^montage-/, ['montage', 'expedition']],
    [/^fondations/, ['genie-civil', 'montage', 'bureau']],
    [/^debit-/, ['debit', 'percage']],
    [/^fabrication-/, ['assemblage', 'controle']],
    [/^nomenclature-debit/, ['debit', 'approvisionnement', 'bureau']],
    [/^nomenclature-toles/, ['tolerie', 'approvisionnement', 'bureau']],
    [/^nomenclature-boulons/, ['montage', 'approvisionnement', 'bureau']],
    [/^nomenclature-synthese/, ['bureau', 'approvisionnement']],
    [/^note-/, ['bureau']],
    [/^calepinage/, ['debit', 'approvisionnement']],
    [/^commande/, ['approvisionnement', 'bureau']],
    [/^tolerie/, ['tolerie']],
    [/^peinture/, ['peinture']],
    [/^controle/, ['controle']],
    [/^colisage/, ['expedition', 'montage']],
  ];
  for (const [motif, postes] of regle) if (motif.test(id)) return postes;
  return null;
}

/** Les planches d'un poste, avec leur numéro dans le dossier complet. */
export function planchesDuPoste(sheets: readonly Sheet[], poste: Poste): { sheet: Sheet; numero: number }[] {
  return sheets
    .map((sheet, i) => ({ sheet, numero: i + 1 }))
    .filter(({ sheet }) => destinataires(sheet).includes(poste));
}

const COLONNES: Colonne[] = [
  { titre: 'N°', poids: 0.7 },
  { titre: 'Planche', poids: 6 },
  { titre: 'Format', poids: 1 },
  { titre: 'Échelle', poids: 1 },
  { titre: 'Indice', poids: 0.9 },
];

/**
 * BORDEREAU D'ENVOI d'un poste : la page de garde de son dossier.
 *
 * Il dit ce que le poste reçoit, à quel indice, et sur combien de planches : le
 * chef de poste coche ce qu'il a en main, et une planche manquante se voit
 * avant le travail plutôt qu'après.
 *
 * ⚠ Les numéros sont ceux du DOSSIER COMPLET : la planche 14 est la planche 14
 * pour tout le monde, au bureau comme à l'atelier.
 *
 * ⚠ La liste est COMPLÈTE : A4 si elle y tient, A3 sur deux colonnes sinon, et
 * autant de pages qu'il faut. Un bordereau qui s'arrêtait à « … et 60 autres
 * planches » laissait au poste le soin de deviner lesquelles il devait avoir.
 */
export function sheetsBordereau(
  poste: Poste,
  sheets: readonly Sheet[],
  meta: CartoucheData['meta'],
): Sheet[] {
  const def = POSTES.find((x) => x.id === poste) as DefinitionPoste;
  const liste = planchesDuPoste(sheets, poste);
  const ligne = ({ sheet, numero }: { sheet: Sheet; numero: number }): string[] => [
    String(numero),
    sheet.titre,
    sheet.format,
    sheet.echelle > 1 ? `1:${sheet.echelle}` : '—',
    meta.indice || 'A',
  ];

  // Place disponible pour le tableau, sous l'en-tête.
  const ENTETE = def.fichiers ? 26.5 : 22;
  const capacite = (format: 'A4' | 'A3'): number => {
    const f = fenetreDe(format);
    return Math.floor((f.max.y - f.min.y - ENTETE - HAUTEUR_TETE - 2) / HAUTEUR_LIGNE);
  };
  const format: 'A4' | 'A3' = liste.length <= capacite('A4') ? 'A4' : 'A3';
  const colonnes = format === 'A4' ? 1 : 2;
  const parPage = capacite(format) * colonnes;
  const pages = Math.max(1, Math.ceil(liste.length / parPage));

  const out: Sheet[] = [];
  for (let n = 0; n < pages; n++) {
    const fenetre = fenetreDe(format);
    const s = new DrawScene();
    let y = fenetre.max.y - 4;
    s.texte(pt(fenetre.min.x, y), `BORDEREAU D’ENVOI — ${def.libelle.toUpperCase()}`, { hauteur: 4, gras: true });
    y -= 7;
    s.texte(pt(fenetre.min.x, y), def.objet, { hauteur: 2.6 });
    y -= 5;
    s.texte(
      pt(fenetre.min.x, y),
      `${liste.length} planche${liste.length > 1 ? 's' : ''} — indice ${meta.indice || 'A'} — à détruire à réception de l’indice suivant` +
        (pages > 1 ? ` — page ${n + 1}/${pages}` : ''),
      { hauteur: 2.2 },
    );
    if (def.fichiers) {
      y -= 4.5;
      s.texte(pt(fenetre.min.x, y), `Fichiers joints : ${def.fichiers}`, { hauteur: 2.2, gras: true });
    }
    y -= 6;

    const tranche = liste.slice(n * parPage, (n + 1) * parPage);
    const largeur = (fenetre.max.x - fenetre.min.x - (colonnes - 1) * 8) / colonnes;
    for (let c = 0; c < colonnes; c++) {
      const morceau = tranche.slice(c * capacite(format), (c + 1) * capacite(format));
      if (morceau.length === 0) continue;
      const x0 = fenetre.min.x + c * (largeur + 8);
      dessinerTableau(s, COLONNES, morceau.map(ligne), { min: pt(x0, fenetre.min.y), max: pt(x0 + largeur, y) });
    }

    const titre = pages > 1 ? `Bordereau — ${def.libelle} (${n + 1}/${pages})` : `Bordereau — ${def.libelle}`;
    dessinerCadre(s, format, { meta, titre, echelle: 1, page: 0, total: 0 });
    // Le bordereau n'appartient pas au dossier numéroté : il l'accompagne.
    s.remplacerTexte(PAGE_A_NUMEROTER, '—');
    out.push({ id: `bordereau-${poste}${pages > 1 ? `-${n + 1}` : ''}`, kind: 'bordereau', titre, format, echelle: 1, scene: s, postes: [poste] });
  }
  return out;
}
