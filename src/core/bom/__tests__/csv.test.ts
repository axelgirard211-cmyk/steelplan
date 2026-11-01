import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { colisage, masseALivrer, PLATEAU_STANDARD, type Colisage } from '../colisage';
import { chiffrageToCsv, colisageToCsv, souduresToCsv, tolesToCsv } from '../csv';
import type { ToleLine } from '../debit';
import { buildBom } from '../index';
import type { WeldLine } from '../totals';
import { valoriser, type Valorisation } from '../valorisation';

/**
 * EXPORTS CSV — tôles, soudures, colisage, chiffrage.
 *
 * ⚠ Le fichier part dans un tableur réglé en français : point-virgule entre les
 * cellules, virgule décimale, guillemets doublés dans une cellule protégée. Une
 * seule de ces conventions manquée, et la nomenclature s'ouvre en une colonne
 * ou en cellules décalées. Les totaux, eux, doivent être la somme des lignes
 * qu'ils coiffent : c'est ce que vérifie celui qui reçoit le fichier.
 */

/** Relit un CSV à la française : cellules protégées, guillemets doublés. */
function lireCsv(csv: string): string[][] {
  expect(csv.charCodeAt(0), 'marqueur UTF-8 en tête').toBe(0xfeff);
  expect(csv.endsWith('\r\n'), 'fin de ligne finale').toBe(true);
  const corps = csv.slice(1, -2);
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let cell = '';
  let protege = false;
  for (let i = 0; i < corps.length; i++) {
    const c = corps[i] as string;
    if (protege) {
      if (c === '"' && corps[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') protege = false;
      else cell += c;
    } else if (c === '"') protege = true;
    else if (c === ';') {
      ligne.push(cell);
      cell = '';
    } else if (c === '\r' && corps[i + 1] === '\n') {
      ligne.push(cell);
      lignes.push(ligne);
      ligne = [];
      cell = '';
      i += 1;
    } else cell += c;
  }
  ligne.push(cell);
  lignes.push(ligne);
  return lignes;
}

/** Nombre écrit à la française. */
const fr = (s: string): number => {
  expect(s, `« ${s} » n’est pas un nombre à la française`).toMatch(/^-?\d+(,\d+)?$/);
  return Number(s.replace(',', '.'));
};

const P = DEFAULT_PROJECT;
const M = buildProject(P);
const BOM = buildBom(P, M);

describe('export CSV des tôles', () => {
  const lignes: ToleLine[] = [
    {
      mark: 'PL1',
      designation: 'Platine "about" ; jarret',
      grade: 'S355',
      width: 250.4,
      height: 600.6,
      thickness: 12.5,
      holes: 12,
      holeDiameter: 22,
      quantity: 4,
      massUnit: 14.734,
      massTotal: 58.936,
      paintM2: 1.288,
    },
    {
      mark: 'RAI1',
      designation: 'Raidisseur',
      grade: 'S235',
      width: 90,
      height: 180,
      thickness: 10,
      holes: 0,
      holeDiameter: 0,
      quantity: 8,
      massUnit: 1.27,
      massTotal: 10.16,
      paintM2: 0.302,
    },
  ];
  const t = lireCsv(tolesToCsv(lignes));

  it('nomme ses colonnes, unités comprises', () => {
    expect(t[0]).toEqual([
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
    ]);
    expect(t).toHaveLength(3);
    for (const l of t) expect(l).toHaveLength(11);
  });

  it('écrit à la française : point-virgule, virgule décimale, millimètre entier', () => {
    expect(t[1]).toEqual(['PL1', 'Platine "about" ; jarret', 'S355', '250', '601', '12,5', '12', '22,0', '4', '14,73', '58,94']);
    // Une tôle sans perçage n'a pas de diamètre : un tiret, pas « 0,0 ».
    expect(t[2]?.[7]).toBe('—');
  });

  it('protège une cellule à guillemet ou point-virgule en doublant ses guillemets', () => {
    expect(tolesToCsv(lignes)).toContain(';"Platine ""about"" ; jarret";');
  });

  it('garde, ligne par ligne, masse totale = quantité × masse unitaire', () => {
    for (const l of lireCsv(tolesToCsv(BOM.toles)).slice(1)) {
      expect(fr(l[10] as string), l[0]).toBeCloseTo(fr(l[8] as string) * fr(l[9] as string), 0);
    }
  });
});

describe('export CSV des soudures', () => {
  const lignes: WeldLine[] = [
    { designation: 'a5 ▷ angle', count: 24, metres: 12.345, note: 'Platines d’about' },
    { designation: 'a4', count: 3, metres: 0.5, note: 'Jarret ; âme' },
  ];
  const t = lireCsv(souduresToCsv(lignes));

  it('nomme ses colonnes et écrit les mètres au centimètre, virgule décimale', () => {
    expect(t[0]).toEqual(['Désignation', 'Nombre de cordons', 'Longueur (m)', 'Emploi']);
    expect(t[1]).toEqual(['a5 ▷ angle', '24', '12,35', 'Platines d’about']);
    expect(t[2]).toEqual(['a4', '3', '0,50', 'Jarret ; âme']);
  });

  it('rend, sommées, les longueurs de cordon de la nomenclature', () => {
    const t2 = lireCsv(souduresToCsv(BOM.welds)).slice(1);
    expect(t2).toHaveLength(BOM.welds.length);
    const somme = t2.reduce((s, l) => s + fr(l[2] as string), 0);
    const attendu = BOM.welds.reduce((s, w) => s + w.metres, 0);
    // Chaque ligne est arrondie au centimètre : au plus 5 mm d'écart par ligne.
    expect(Math.abs(somme - attendu)).toBeLessThanOrEqual(0.005 * t2.length + 1e-9);
  });
});

describe('export CSV du colisage', () => {
  const C: Colisage = {
    colis: [
      {
        numero: 1,
        phase: 'Portiques',
        lignes: [
          { mark: 'P1', profileId: 'HEA 300', nombre: 2, longueur: 6000.4, masse: 1059.12 },
          { mark: 'T1', profileId: 'IPE 400', nombre: 2, longueur: 10050, masse: 1336.65 },
        ],
        masse: 2395.77,
        longueurMax: 10050,
        masseUnitaireMax: 668.3,
      },
    ],
    masseTotale: 2395.77,
    horsGabarit: [{ mark: 'F1', longueur: 15200, masse: 812.4 }],
    transport: PLATEAU_STANDARD,
  };
  const t = lireCsv(colisageToCsv(C));

  it('nomme ses colonnes et met le colis en premier', () => {
    expect(t[0]).toEqual(['Colis', 'Phase de montage', 'Repère', 'Profil', 'Nombre', 'Longueur (mm)', 'Masse (kg)']);
    expect(t[1]).toEqual(['1', 'Portiques', 'P1', 'HEA 300', '2', '6000', '1059,1']);
  });

  it('garde le hors gabarit dans le tableau, colis « — »', () => {
    expect(t[3]).toEqual(['—', 'HORS GABARIT', 'F1', '', '', '15200', '812,4']);
  });

  it('termine par un total à livrer égal à la somme des lignes', () => {
    const total = t[t.length - 1] as string[];
    expect(total[1]).toBe('TOTAL À LIVRER');
    expect(fr(total[6] as string)).toBeCloseTo(1059.12 + 1336.65 + 812.4, 1);
  });

  it('fait de même sur le colisage réel du projet par défaut', () => {
    const reel = colisage(M);
    const t2 = lireCsv(colisageToCsv(reel)).slice(1);
    const total = t2.pop() as string[];
    expect(total[1]).toBe('TOTAL À LIVRER');
    const somme = t2.reduce((s, l) => s + fr(l[6] as string), 0);
    // Chaque ligne est arrondie au dixième de kilo.
    expect(Math.abs(somme - fr(total[6] as string))).toBeLessThanOrEqual(0.05 * (t2.length + 1));
    expect(fr(total[6] as string)).toBeCloseTo(masseALivrer(reel), 1);
  });
});

describe('export CSV du chiffrage', () => {
  const V: Valorisation = {
    lignes: [
      { poste: 'Acier S235', quantite: 1000, unite: 'kg', prixUnitaire: 1.15, montant: 1150 },
      { poste: 'Soudure', quantite: 12.5, unite: 'm de cordon', prixUnitaire: 30, montant: 375 },
      { poste: 'Frais "généraux"', quantite: 1525, unite: '€', prixUnitaire: 10, montant: 152.5, taux: true },
    ],
    deboursSec: 1525,
    total: 1677.5,
    nonChiffres: ['transport'],
    parKg: 1.6775,
    masseKg: 1000,
  };
  const t = lireCsv(chiffrageToCsv(V));

  it('nomme ses colonnes et écrit les montants au centime, virgule décimale', () => {
    expect(t[0]).toEqual(['Poste', 'Quantité', 'Unité', 'Prix unitaire', 'Montant (€)']);
    expect(t[1]).toEqual(['Acier S235', '1000,0', 'kg', '1,15', '1150,00']);
    expect(t[2]).toEqual(['Soudure', '12,5', 'm de cordon', '30,00', '375,00']);
  });

  it('intercale le déboursé sec avant les postes en pourcentage', () => {
    expect(t[3]).toEqual(['Déboursé sec', '', '', '', '1525,00']);
    expect(t[4]).toEqual(['Frais "généraux"', '1525,00', '€', '10,00 %', '152,50']);
    expect(chiffrageToCsv(V)).toContain('"Frais ""généraux"""');
  });

  it('termine par le total, le ratio au kilo, et la réserve des postes non chiffrés', () => {
    expect(t[5]).toEqual(['TOTAL HT', '', '', '', '1677,50']);
    expect(t[6]).toEqual(['Ratio', '1000,0', 'kg', '', '1,678']);
    expect(t[7]?.[0]).toMatch(/Non chiffrés : transport\. Ce n’est pas un devis\./);
  });

  it('donne un total HT égal à la somme des postes, sur le chiffrage réel', () => {
    const reel = valoriser(BOM, P.finition);
    const t2 = lireCsv(chiffrageToCsv(reel)).slice(1);
    const total = t2.find((l) => l[0] === 'TOTAL HT') as string[];
    // Les postes : tout ce qui précède le total, sauf le sous-total du déboursé.
    const postes = t2.slice(0, t2.indexOf(total)).filter((l) => l[0] !== 'Déboursé sec');
    expect(postes).toHaveLength(reel.lignes.length);
    const somme = postes.reduce((s, l) => s + fr(l[4] as string), 0);
    expect(Math.abs(somme - fr(total[4] as string))).toBeLessThanOrEqual(0.005 * (postes.length + 1));
    expect(fr(total[4] as string)).toBeCloseTo(reel.total, 2);
  });
});
