import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import { fbRd, ftRd, fvRd, interactionVT, GAMMA_M2 } from '../boulons';
import { fvwd, gorgeNecessaire, tauxCordon } from '../soudures';
import { longueurEfficace, troncon } from '../assemblages/troncon';
import { runChecks } from '../index';

/**
 * VÉRIFICATION DES ASSEMBLAGES.
 *
 * ⚠ Les résistances élémentaires sont comparées à des valeurs calculées À LA
 * MAIN depuis l'EN 1993-1-8, pas à ce que le code produit aujourd'hui. Un test
 * qui fige la sortie actuelle ne vérifie rien : il garantit seulement qu'on
 * reproduira fidèlement l'erreur.
 */

describe('résistance des boulons — EN 1993-1-8 tableau 3.4', () => {
  it('cisaille un M20 8.8 à 94,1 kN par plan', () => {
    // 0,6 × 800 × 245 / 1,25
    expect(fvRd({ d: 20, cls: '8.8' }) / 1000).toBeCloseTo(94.08, 2);
  });

  it('cisaille un M20 10.9 à 98,0 kN : αv tombe à 0,50', () => {
    /*
     * ⚠ Le boulon le plus résistant a le coefficient le plus faible. Un M20 10.9
     * ne cisaille que 4 % de plus qu'un 8.8, là où sa traction gagne 25 %.
     * Retenir αv = 0,6 partout le surestimerait de 20 %.
     */
    expect(fvRd({ d: 20, cls: '10.9' }) / 1000).toBeCloseTo(98.0, 2);
    const gain = fvRd({ d: 20, cls: '10.9' }) / fvRd({ d: 20, cls: '8.8' });
    expect(gain).toBeLessThan(1.1);
  });

  it('tend un M20 10.9 à 176,4 kN', () => {
    // 0,9 × 1000 × 245 / 1,25
    expect(ftRd({ d: 20, cls: '10.9' }) / 1000).toBeCloseTo(176.4, 2);
  });

  it('emploie γM2 = 1,25 et non γM0', () => {
    expect(GAMMA_M2).toBe(1.25);
  });

  it('fait dépendre la pression diamétrale des PINCES', () => {
    /*
     * C'est la seule vérification qui relie le calcul au dessin : déplacer un
     * trou change la résistance. Un test qui l'ignorerait laisserait passer un
     * fbRd constant, c'est-à-dire faux.
     */
    const b = { d: 20, cls: '8.8' } as const;
    const serre = fbRd(b, 10, 'S235', { e1: 30, e2: 30 });
    const large = fbRd(b, 10, 'S235', { e1: 60, e2: 60 });
    expect(large).toBeGreaterThan(serre * 1.5);
  });

  it('croît proportionnellement à l’épaisseur de la tôle', () => {
    const b = { d: 20, cls: '8.8' } as const;
    const a = fbRd(b, 10, 'S235', { e1: 40, e2: 40 });
    const c = fbRd(b, 20, 'S235', { e1: 40, e2: 40 });
    expect(c / a).toBeCloseTo(2, 3);
  });

  it('n’additionne pas bêtement cisaillement et traction', () => {
    // Le 1,4 du dénominateur : les deux ruines ne sont pas simultanées.
    const b = { d: 20, cls: '8.8' } as const;
    const t = interactionVT(0, ftRd(b), b);
    expect(t).toBeCloseTo(1 / 1.4, 3);
  });
});

describe('résistance des cordons — méthode simplifiée § 4.5.3.3', () => {
  it('donne fvw,d = 207,8 N/mm² en S235', () => {
    // 360 / √3 / (0,8 × 1,25)
    expect(fvwd('S235')).toBeCloseTo(207.85, 1);
  });

  it('fait croître βw avec la nuance, donc le gain moins vite que fu', () => {
    /*
     * ⚠ Souder du S355 ne fait pas gagner 42 % sur les cordons. Le facteur de
     * corrélation passe de 0,80 à 0,90 et mange une partie du gain.
     */
    const gainAcier = 510 / 360;
    const gainCordon = fvwd('S355') / fvwd('S235');
    expect(gainCordon).toBeLessThan(gainAcier);
    expect(gainCordon).toBeCloseTo(1.26, 2);
  });

  it('rend une gorge entière : un soudeur ne règle pas au dixième', () => {
    const a = gorgeNecessaire(900, 'S235');
    expect(Number.isInteger(a)).toBe(true);
    expect(tauxCordon(900, 1, a, 'S235')).toBeLessThanOrEqual(1);
  });
});

describe('tronçon en T — EN 1993-1-8 § 6.2.4', () => {
  const boulon = { d: 24, cls: '10.9' } as const;

  it('fait plier la platine mince avant de casser les boulons', () => {
    /*
     * ⚠ L'erreur la plus commune du calcul de platine : compter les boulons et
     * s'arrêter là. Une platine de 12 mm ne développe PAS deux M24 10.9.
     */
    const g = { leff: 120, tp: 12, m: 40, e: 35, nBoulons: 2 };
    const r = troncon(g, boulon, 'S235');
    expect(r.mode).not.toBe('boulons');
    expect(r.ftRd).toBeLessThan(2 * ftRd(boulon));
  });

  it('laisse les boulons gouverner sous une platine épaisse', () => {
    const g = { leff: 120, tp: 40, m: 40, e: 35, nBoulons: 2 };
    const r = troncon(g, boulon, 'S235');
    expect(r.mode).toBe('boulons');
    expect(r.ftRd).toBeCloseTo(2 * ftRd(boulon), 0);
  });

  it('croît avec le carré de l’épaisseur tant que la platine gouverne', () => {
    const base = { leff: 120, m: 40, e: 35, nBoulons: 2 };
    const a = troncon({ ...base, tp: 10 }, boulon, 'S235').ftRd;
    const b = troncon({ ...base, tp: 20 }, boulon, 'S235').ftRd;
    expect(b / a).toBeGreaterThan(3.5);
  });

  it('limite la longueur efficace à l’entraxe des rangées voisines', () => {
    // Deux rangées trop proches se partagent la tôle : elles ne peuvent pas
    // développer chacune sa propre ligne de plastification.
    expect(longueurEfficace(40, 35, 90)).toBe(90);
    // Rangée isolée : la plus petite des deux lignes de plastification,
    // circulaire 2πm = 251 ou non circulaire 4m + 1,25e = 203,75.
    expect(longueurEfficace(40, 35)).toBeCloseTo(203.75, 2);
  });

  it('ne renvoie jamais l’infini sur une géométrie dégénérée', () => {
    // Le dimensionnement automatique explore des configurations que personne
    // n'aurait dessinées : m négatif quand le boulon tombe dans l'âme.
    const r = troncon({ leff: 100, tp: 15, m: -5, e: 30, nBoulons: 2 }, boulon, 'S235');
    expect(Number.isFinite(r.ftRd)).toBe(true);
  });
});

describe('assemblages du projet', () => {
  const P = DEFAULT_PROJECT;
  const R = runChecks(P, buildProject(P));

  it('vérifie le genou, le faîtage, le pied, chaque diagonale et chaque tête de potelet', () => {
    expect(R.assemblages.map((a) => a.id).sort()).toEqual([
      'cv-CV1', 'cv-CV2', 'cv-CV3', 'cv-CV4', 'faitage', 'genou', 'pied', 'tete-PT1', 'tete-PT2',
    ]);
  });

  it('FLÉCHIT PLUS LE GENOU QUE LE FAÎTAGE', () => {
    /*
     * ⚠ L'invariant qui a révélé le défaut. Le genou d'un portique est son point
     * le plus fléchi ; le faîtage l'est moins. Un genou moins chargé que le
     * faîtage signale que les efforts ne sont pas lus au bon endroit — c'était le
     * cas : le porte-à-faux d'égout, presque déchargé, aboutit au même nœud que
     * la traverse de portée, et c'est lui qu'on lisait. Le genou ressortait à
     * 0,3 kN·m au lieu de 206.
     */
    const genou = R.assemblages.find((a) => a.id === 'genou');
    const faitage = R.assemblages.find((a) => a.id === 'faitage');
    expect(genou && faitage).toBeTruthy();
    const m = (s: string): number => Number(/M = ([\d.-]+)/.exec(s)?.[1] ?? 0);
    expect(m(genou!.sollicitations)).toBeGreaterThan(m(faitage!.sollicitations));
  });

  it('reste sous le moment isostatique de la traverse', () => {
    // Borne haute physique : un portique ne peut pas être plus fléchi au genou
    // qu'une poutre simplement appuyée de même portée sous la même charge.
    const l = P.loads.loads;
    const k = P.loads.factors;
    const q = (k.gammaG * l.permanent + k.gammaQ * Math.max(l.exploitation, l.neige)) *
      (P.grid.baySpacing / 1000);
    const isostatique = (q * (P.grid.span / 1000) ** 2) / 8;
    const genou = R.assemblages.find((a) => a.id === 'genou');
    const m = Number(/M = ([\d.-]+)/.exec(genou?.sollicitations ?? '')?.[1] ?? 0);
    expect(m, `${m} kN·m pour ${isostatique.toFixed(0)} isostatique`).toBeLessThan(isostatique);
    expect(m).toBeGreaterThan(isostatique * 0.3);
  });

  it('NOMME ce qu’il ne couvre pas', () => {
    /*
     * Un assemblage annoncé « vérifié » alors qu'un mode entier n'a pas été
     * regardé est plus dangereux qu'un assemblage non vérifié : dans le second
     * cas, on sait qu'il reste à faire.
     */
    for (const a of R.assemblages) {
      expect(a.nonCouvert.length, a.libelle).toBeGreaterThan(0);
    }
    const pied = R.assemblages.find((a) => a.id === 'pied');
    expect(pied?.nonCouvert.join(' ')).toMatch(/1992-4|cône/);
  });

  it('donne à chaque vérification un taux fini et une unité', () => {
    for (const a of R.assemblages) {
      expect(a.verifs.length, a.libelle).toBeGreaterThan(2);
      for (const v of a.verifs) {
        expect(Number.isFinite(v.ratio), `${a.libelle} / ${v.nom}`).toBe(true);
        expect(v.unite.length).toBeGreaterThan(0);
      }
      expect(a.ratio).toBe(Math.max(...a.verifs.map((v) => v.ratio)));
    }
  });

  it('résout le pied ENCASTRÉ sous grand excentrement', () => {
    /*
     * ⚠ Le cas qui sortait un taux INFINI. Sous fort moment, la résultante quitte
     * la platine : le béton se concentre sur un bloc court et les tiges tirent,
     * alors même que l'effort normal reste une compression. C'est le
     * fonctionnement NORMAL d'un pied encastré, pas une anomalie — le traiter
     * comme impossible condamnait tous les portiques à pieds encastrés.
     */
    const encastre = { ...P, frame: { ...P.frame, baseFixity: 'encastre' as const } };
    const r = runChecks(encastre, buildProject(encastre));
    const pied = r.assemblages.find((a) => a.id === 'pied');
    expect(pied).toBeDefined();
    for (const v of pied!.verifs) {
      expect(Number.isFinite(v.ratio), `${v.nom} = ${v.ratio}`).toBe(true);
    }
    // Et l'ancrage doit être vérifié : c'est lui qui équilibre le moment.
    expect(pied!.verifs.some((v) => v.nom.includes('traction des tiges'))).toBe(true);
  });

  it('tient sur tous les gabarits', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      const r = runChecks(p, buildProject(p));
      for (const a of r.assemblages) {
        expect(Number.isFinite(a.ratio), `${t.id} / ${a.libelle}`).toBe(true);
      }
      // Un portique à âme pleine a forcément un genou à vérifier.
      if (p.frame.enabled) {
        expect(r.assemblages.some((a) => a.id === 'genou'), t.id).toBe(true);
      }
    }
  });
});

describe('attaches de diagonales de contreventement', () => {
  const P = DEFAULT_PROJECT;
  const M = buildProject(P);
  const R = runChecks(P, M);
  const attache = (mark: string) => R.assemblages.find((a) => a.id === `cv-${mark}`);
  const ligne = (a: ReturnType<typeof attache>, nom: string) => a?.verifs.find((v) => v.nom === nom);

  it('vérifie sous la traction MAXIMALE de la diagonale, recalculée', () => {
    // La ligne de barre et l'attache lisent le même effort : la diagonale la
    // plus tendue de la note.
    for (const l of R.lines.filter((x) => x.role === 'contreventement')) {
      expect(attache(l.mark)?.sollicitations, l.mark).toContain(l.nEd.toFixed(1).replace('.', ','));
    }
  });

  it('retrouve à la main les résistances du détail type', () => {
    const a = attache('CV1');
    // 2 × M16 8.8 : 0,6 × 800 × 157 / 1,25 = 60,3 kN par boulon.
    expect(ligne(a, 'cisaillement des boulons')?.rd).toBeCloseTo(60.29, 1);
    /*
     * Plat de 10 en S235, pince 27 (1,5 d0), entraxe 54 (3 d0), demi-largeur 40 :
     * αb = min(27 / 54 ; 54 / 54 − 0,25 ; 800 / 360 ; 1) = 0,5, k1 = 2,5,
     * Fb = 2,5 × 0,5 × 360 × 16 × 10 / 1,25 = 57,6 kN.
     */
    expect(ligne(a, 'pression diamétrale sur le plat')?.rd).toBeCloseTo(57.6, 1);
    // Quatre cordons a3 de 100 mm dans la fente d'un Ø60,3 : 400 × 3 × 207,8 = 249,4 kN.
    expect(ligne(a, 'cordons du plat dans la fente')?.rd).toBeCloseTo(249.4, 0);
  });

  it('ampute la section du tube des deux lèvres de la fente', () => {
    // Ø48,3 × 3,2 : A = π × 45,1 × 3,2 = 453,4 mm² ; moins 2 × 12 × 3,2 = 76,8 ;
    // Nu = 0,9 × 376,6 × 360 / 1,25 = 97,6 kN.
    const a = attache('CV3');
    expect(ligne(a, 'section nette du tube à la fente')?.rd).toBeCloseTo(97.6, 0);
    expect(a?.nonCouvert.length).toBeGreaterThan(0);
  });
});

describe('attaches de tête de potelet', () => {
  const R = runChecks(DEFAULT_PROJECT, buildProject(DEFAULT_PROJECT));
  const tete = R.assemblages.find((a) => a.id === 'tete-PT1');

  it('reprend la réaction de tête : celle du pied, même vent', () => {
    const pied = R.piedsPotelets.find((a) => a.mark === 'PT1');
    expect(tete?.sollicitations).toContain((pied?.v ?? 0).toFixed(1).replace('.', ','));
  });

  it('réduit à 0,6 la pression diamétrale d’un oblong perpendiculaire à l’effort', () => {
    /*
     * Gousset de 160 × 130, ép. 10, S235 ; boulons M16 à ±53 : e1 = 27 vers la
     * rive, e2 = 64,2 − 25 de course = 39,2 en travers.
     * αb = min(27 / 54 ; 106 / 54 − 0,25 ; 1) = 0,5 ; k1 = 2,5 ;
     * Fb = 0,6 × 2,5 × 0,5 × 360 × 16 × 10 / 1,25 = 34,6 kN.
     */
    const v = tete?.verifs.find((x) => x.nom.startsWith('pression diamétrale sur le gousset'));
    expect(v?.rd).toBeCloseTo(34.56, 1);
  });

  it('vérifie que la course des oblongs couvre la flèche de la traverse de pignon', () => {
    /*
     * ⚠ Avec ±25 mm, la traverse de pignon — 44,9 mm de flèche sous G + Q au
     * droit du potelet de faîtage — venait buter au bout des oblongs : le
     * potelet portait la toiture. La course par défaut est passée à 50 mm.
     */
    const faitage = R.assemblages.find((a) => a.id === 'tete-PT2');
    const course = faitage?.verifs.find((x) => x.nom.startsWith('course des oblongs'));
    expect(course?.rd).toBe(50);
    expect(course?.ed).toBeGreaterThan(25);
    expect(course?.ratio).toBeLessThan(1);
  });
});
