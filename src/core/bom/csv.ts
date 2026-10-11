import { roundMm, roundTo } from '../math/tolerance';
import type { BoltLine } from './boulonnerie';
import type { Colisage } from './colisage';
import { masseALivrer } from './colisage';
import type { DebitLine, ToleLine } from './debit';
import type { ProjectTotals, WeldLine } from './totals';
import type { Valorisation } from './valorisation';

/**
 * Export CSV des nomenclatures.
 *
 * ⚠ Conventions FRANÇAISES, sans lesquelles le fichier est inexploitable dans un
 * tableur configuré en français : séparateur POINT-VIRGULE et virgule décimale.
 * Un CSV à virgules avec des points décimaux s'ouvre en une seule colonne, ou
 * transforme « 6,5 » en deux cellules — dans les deux cas la nomenclature est
 * bonne à jeter.
 *
 * Le fichier est préfixé du marqueur d'ordre des octets UTF-8, faute de quoi les
 * accents sortent en mojibake sur les tableurs qui devinent l'encodage.
 */
const BOM_UTF8 = '﻿';
const SEP = ';';

/** Formate un nombre à la française : virgule décimale, pas de séparateur de milliers. */
function nb(v: number, decimales = 0): string {
  return roundTo(v, decimales).toFixed(decimales).replace('.', ',');
}

/** Échappe une cellule : guillemets doublés si elle contient un caractère gênant. */
function cellule(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function tableau(entetes: readonly string[], lignes: readonly (readonly string[])[]): string {
  return [entetes, ...lignes].map((l) => l.map(cellule).join(SEP)).join('\r\n');
}

/** Liste de débit : une ligne par repère, prête pour la scie. */
export function debitToCsv(lignes: readonly DebitLine[]): string {
  return (
    BOM_UTF8 +
    tableau(
      [
        'Repère',
        'Désignation',
        'Profil',
        'Nuance',
        'Quantité',
        'Longueur (mm)',
        'Longueur maxi (mm)',
        'Coupe origine (°)',
        'Coupe extrémité (°)',
        'Perçages',
        'Grugeages',
        'Masse unitaire (kg)',
        'Masse totale (kg)',
      ],
      lignes.map((l) => [
        l.mark,
        l.designation,
        l.profileId,
        l.grade,
        String(l.quantity),
        nb(roundMm(l.length)),
        nb(roundMm(l.lengthMax)),
        nb(l.angleStart, 1),
        nb(l.angleEnd, 1),
        String(l.holes),
        String(l.notches),
        nb(l.massUnit, 2),
        nb(l.massTotal, 2),
      ]),
    ) +
    '\r\n'
  );
}

/** Liste des tôles d'assemblage. */
export function tolesToCsv(lignes: readonly ToleLine[]): string {
  return (
    BOM_UTF8 +
    tableau(
      [
        'Repère',
        'Désignation',
        'Nuance',
        'Largeur (mm)',
        'Hauteur (mm)',
        'Épaisseur (mm)',
        'Perçages',
        'Diamètre (mm)',
        'Quantité',
        'Masse unitaire (kg)',
        'Masse totale (kg)',
      ],
      lignes.map((l) => [
        l.mark,
        l.designation,
        l.grade,
        nb(roundMm(l.width)),
        nb(roundMm(l.height)),
        nb(l.thickness, 1),
        String(l.holes),
        l.holes > 0 ? nb(l.holeDiameter, 1) : '—',
        String(l.quantity),
        nb(l.massUnit, 2),
        nb(l.massTotal, 2),
      ]),
    ) +
    '\r\n'
  );
}

/** Liste de boulonnerie, avec la longueur commandée. */
export function boulonnerieToCsv(lignes: readonly BoltLine[]): string {
  return (
    BOM_UTF8 +
    tableau(
      [
        'Désignation',
        'Diamètre (mm)',
        'Classe',
        'Longueur (mm)',
        'Serrage (mm)',
        'Quantité',
        'Emploi',
        'Masse unitaire (kg)',
        'Masse totale (kg)',
      ],
      lignes.map((l) => [
        l.designation,
        nb(l.diameter),
        l.cls,
        nb(l.length),
        nb(l.grip, 1),
        String(l.count),
        l.usage,
        nb(l.massUnit, 3),
        nb(l.massTotal, 2),
      ]),
    ) +
    '\r\n'
  );
}

/** Nomenclature de soudure. */
export function souduresToCsv(lignes: readonly WeldLine[]): string {
  return (
    BOM_UTF8 +
    tableau(
      ['Désignation', 'Nombre de cordons', 'Longueur (m)', 'Emploi'],
      lignes.map((l) => [l.designation, String(l.count), nb(l.metres, 2), l.note]),
    ) +
    '\r\n'
  );
}

/**
 * Colisage : une ligne par repère chargé, le colis en première colonne.
 *
 * ⚠ Les pièces HORS GABARIT figurent dans le même tableau, colis « — ». Les
 * mettre à part, ou les omettre parce qu'elles ne montent pas sur le camion,
 * ferait un bon de chargement dont le total ne correspond à rien : une pièce
 * écartée reste une pièce à livrer.
 */
export function colisageToCsv(c: Colisage): string {
  const lignes: string[][] = [];
  for (const colis of c.colis) {
    for (const l of colis.lignes) {
      lignes.push([
        String(colis.numero),
        colis.phase,
        l.mark,
        l.profileId,
        String(l.nombre),
        nb(roundMm(l.longueur)),
        nb(l.masse, 1),
      ]);
    }
  }
  for (const h of c.horsGabarit) {
    lignes.push(['—', 'HORS GABARIT', h.mark, '', '', nb(roundMm(h.longueur)), nb(h.masse, 1)]);
  }
  lignes.push(['', 'TOTAL À LIVRER', '', '', '', '', nb(masseALivrer(c), 1)]);

  return (
    BOM_UTF8 +
    tableau(
      ['Colis', 'Phase de montage', 'Repère', 'Profil', 'Nombre', 'Longueur (mm)', 'Masse (kg)'],
      lignes,
    ) +
    '\r\n'
  );
}

/** Chiffrage : une ligne par poste, plus le total et le ratio au kilo. */
export function chiffrageToCsv(v: Valorisation): string {
  const lignes: string[][] = [];
  for (const [i, l] of v.lignes.entries()) {
    if (l.taux && !v.lignes[i - 1]?.taux) lignes.push(['Déboursé sec', '', '', '', nb(v.deboursSec, 2)]);
    lignes.push([l.poste, nb(l.quantite, l.taux ? 2 : 1), l.unite, l.taux ? `${nb(l.prixUnitaire, 2)} %` : nb(l.prixUnitaire, 2), nb(l.montant, 2)]);
  }
  lignes.push(['TOTAL HT', '', '', '', nb(v.total, 2)]);
  lignes.push(['Ratio', nb(v.masseKg, 1), 'kg', '', nb(v.parKg, 3)]);
  /*
   * ⚠ L'avertissement voyage AVEC le chiffre. Un tableau de prix détaché de sa
   * réserve devient un devis dans la boîte mail de celui qui le reçoit.
   */
  if (v.nonChiffres.length > 0) {
    lignes.push([`Non chiffrés : ${v.nonChiffres.join(', ')}. Ce n’est pas un devis.`, '', '', '', '']);
  }
  return (
    BOM_UTF8 +
    tableau(['Poste', 'Quantité', 'Unité', 'Prix unitaire', 'Montant (€)'], lignes) +
    '\r\n'
  );
}

/** Synthèse : deux colonnes, grandeur et valeur. */
export function totauxToCsv(t: ProjectTotals): string {
  const lignes: [string, string][] = [
    ['Masse des barres (kg)', nb(t.massMembers, 1)],
    ['Masse des tôles (kg)', nb(t.massPlates, 1)],
    ['Masse d’acier de charpente (kg)', nb(t.massSteel, 1)],
    ['Masse de boulonnerie (kg)', nb(t.massBolts, 1)],
    ['Masse totale à livrer (kg)', nb(t.massTotal, 1)],
    ...Object.entries(t.massByGrade).map(
      ([nuance, masse]) => [`dont ${nuance} (kg)`, nb(masse ?? 0, 1)] as [string, string],
    ),
    ['Nombre de pièces', String(t.pieceCount)],
    ['Nombre de repères', String(t.markCount)],
    ['Nombre de boulons', String(t.boltCount)],
    ['Longueur de cordon (m)', nb(t.weldMetres, 1)],
    ['Métal d’apport (kg)', nb(t.weldMassKg, 2)],
    ['Emprise au sol (m²)', nb(t.footprintM2, 1)],
    ['Toiture développée (m²)', nb(t.roofM2, 1)],
    ['Surface à peindre ou galvaniser (m²)', nb(t.paintM2, 1)],
    ['Ratio de charpente (kg/m²)', nb(t.kgPerM2, 1)],
  ];
  return BOM_UTF8 + tableau(['Grandeur', 'Valeur'], lignes) + '\r\n';
}
