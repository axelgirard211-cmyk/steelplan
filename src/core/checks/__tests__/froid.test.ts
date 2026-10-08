import { describe, expect, it } from 'vitest';
import { getProfile, PROFILES } from '../../catalog/index';
import type { ColdProfile } from '../../catalog/types';
import { sectionEfficace, semelleLibre } from '../froid';
import { classer, mcRd } from '../section';
import { buildProject } from '../../build/buildProject';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import { runChecks } from '../index';

const FROIDS = PROFILES.filter((p): p is ColdProfile => p.shape === 'Z' || p.shape === 'C');
const FY = 350;

describe('section efficace EN 1993-1-3', () => {
  it('ne dépasse JAMAIS la section brute', () => {
    /*
     * ⚠ L'INVARIANT DE SÛRETÉ. Une section amputée de ce qui a voilé ne peut pas
     * être plus résistante que la section pleine. La première version violait
     * cette évidence sur deux profils — 101 % et 103 % du module brut — parce
     * que les rectangles efficaces se recouvraient dans l'âme et que la lèvre
     * ressortait une demi-épaisseur trop longue. Aucune vérification interne ne
     * l'aurait dit : seul l'absurde du résultat le disait.
     */
    for (const p of FROIDS) {
      for (const sens of ['haute', 'basse'] as const) {
        const e = sectionEfficace(p, FY, sens);
        expect(e.Weff, `${p.id} ${sens}`).toBeLessThanOrEqual(p.Wely * 1.000001);
        expect(e.Aeff, `${p.id} ${sens}`).toBeLessThanOrEqual(p.A * 1.000001);
      }
    }
  });

  it('redonne EXACTEMENT la section brute quand rien ne voile', () => {
    /*
     * ⚠ Le test qui rend le défaut précédent impossible. À très basse limite
     * d'élasticité, toutes les réductions valent 1 : la section efficace doit
     * alors coïncider avec la brute au dernier chiffre. Toute erreur de
     * recomposition — un rectangle décalé, une largeur notionnelle appliquée à
     * la place d'une cote brute — se voit ici et nulle part ailleurs.
     */
    for (const p of FROIDS) {
      const e = sectionEfficace(p, 20, 'haute');
      expect(e.chiD, p.id).toBeCloseTo(1, 9);
      expect(e.Aeff, p.id).toBeCloseTo(p.A, 6);
      expect(e.Weff, p.id).toBeCloseTo(p.Wely, 6);
    }
  });

  it('reste dans la plage d’efficacité des profils du marché', () => {
    // Entre 80 et 100 % du module brut : au-delà le calcul ne réduirait rien,
    // en deçà il condamnerait des profils que les fabricants vendent.
    for (const p of FROIDS) {
      const r = sectionEfficace(p, FY).Weff / p.Wely;
      expect(r, p.id).toBeGreaterThan(0.8);
      // Les petites sections ressortent entièrement efficaces : le ratio vaut 1
      // à l'arrondi près, et c'est un résultat, pas une tolérance de confort.
      expect(r, p.id).toBeLessThanOrEqual(1.000001);
    }
  });

  it('pénalise d’autant plus que la tôle est mince', () => {
    /*
     * Le voilement est affaire d'ÉLANCEMENT : à hauteur égale, une tôle deux
     * fois plus mince voile deux fois plus tôt. Si l'ordre s'inversait, c'est
     * que le rapport largeur/épaisseur serait pris à l'envers quelque part.
     */
    const mince = sectionEfficace(getProfile('Z 200x1.5') as ColdProfile, FY);
    const epais = sectionEfficace(getProfile('Z 200x3.0') as ColdProfile, FY);
    expect(mince.Weff / (getProfile('Z 200x1.5').Wely)).toBeLessThan(
      epais.Weff / getProfile('Z 200x3.0').Wely,
    );
  });

  it('retrouve le χd calculé à la main sur le Z 200×2,0 en S350', () => {
    /*
     * ⚠ Contrôle par RECALCUL EXTÉRIEUR, le seul qui vaille sur une formule
     * aussi enchevêtrée : une erreur dans l'un des cinq termes ne se verrait pas
     * dans un résultat qui « a l'air plausible ».
     *
     * Repris pas à pas du § 5.5.3, aile comprimée de 69 mm, ε = 0,819 :
     *   ρ aile = 0,965      ⇒ beff = 64,7 mm, be2 = 32,3 mm
     *   ceff   = 19,0 mm    (lèvre entièrement efficace, kσ = 0,5)
     *   As     = 102,7 mm²  Is = 3805 mm⁴
     *   K      = 1,80 N/mm² σcr,s = 738 N/mm²
     *   λd     = 0,689      ⇒ χd = 1,47 − 0,723 × 0,689 = 0,972
     */
    const e = sectionEfficace(getProfile('Z 200x2.0') as ColdProfile, FY);
    expect(e.chiD).toBeCloseTo(0.972, 3);
  });

  it('nomme ce qui gouverne la réduction', () => {
    for (const p of FROIDS) {
      expect(sectionEfficace(p, FY).gouverne, p.id).toMatch(/\S/);
    }
  });
});

describe('intégration au calcul', () => {
  it('classe tout profil formé à froid en 4, jamais en plastique', () => {
    /*
     * ⚠ LE DÉFAUT QUI RENDAIT CES PROFILS DANGEREUX. Les élancements de
     * l'EN 1993-1-1 ne décrivent ni les lèvres ni la distorsion : un Z ne
     * tombait dans aucune de leurs branches et ressortait en classe 1, « section
     * pleine ». Une tôle de 2 mm était vérifiée en plastique, avec Wpl — de
     * l'ordre de 20 % de résistance offerts sans que rien ne le signale.
     */
    for (const p of FROIDS) {
      for (const n of [0, -50_000, 50_000]) {
        expect(classer(p, FY, n).cls, `${p.id} sous N=${n}`).toBe(4);
      }
    }
  });

  it('le moment résistant passe par la section efficace, pas par Wely', () => {
    for (const p of FROIDS) {
      const attendu = sectionEfficace(p, FY).McRd;
      expect(mcRd(p, FY, 4), p.id).toBeCloseTo(attendu, 6);
      // Et il est bien INFÉRIEUR au moment élastique brut, sauf section
      // entièrement efficace où les deux coïncident.
      expect(mcRd(p, FY, 4), p.id).toBeLessThanOrEqual(p.Wely * FY * 1.000001);
    }
  });

  it('un Z pèse moitié moins qu’un IPE pour un moment résistant voisin', () => {
    /*
     * La comparaison qui justifie tout le lot, faite sur la résistance RÉELLE
     * des deux — efficace pour le Z, plastique pour l'IPE — et non sur les
     * modules bruts qui flatteraient le profil mince.
     */
    const z = getProfile('Z 200x2.0') as ColdProfile;
    const ipe = getProfile('IPE 120');
    expect(mcRd(z, FY, 4)).toBeGreaterThan(mcRd(ipe, 235, 1));
    expect(z.G).toBeLessThan(ipe.G * 0.6);
  });
});

/* ================================================================== */
/* Semelle libre sous soulèvement — EN 1993-1-3 § 10.1.4               */
/* ================================================================== */

describe('semelle libre comprimée', () => {
  const Z = getProfile('Z 200x2.0') as ColdProfile;

  it('retrouve λfz et χLT calculés à la main sur le Z 200×2,0', () => {
    /*
     * Recalcul pas à pas : semelle 71×2, lèvre 18×2 et cinquième d'âme 40×2,
     * soit A = 258 mm², I latérale = 198 200 mm⁴, d'où ifz = 27,7 mm. Sur 3 m
     * entre maintiens en S235 : λfz = 3000 / 27,7 / 93,9 = 1,15, et sur la
     * courbe b, χLT = 0,505.
     */
    const s = semelleLibre(Z, 235, 3000, 'basse');
    expect(s.ifz).toBeCloseTo(27.7, 1);
    expect(s.lambdaFz).toBeCloseTo(1.153, 2);
    expect(s.chiLT).toBeCloseTo(0.505, 2);
  });

  it('se raccourcit avec les maintiens : plus de liernes, moins de réduction', () => {
    const longue = semelleLibre(Z, 235, 6000, 'basse').chiLT;
    const moyenne = semelleLibre(Z, 235, 3000, 'basse').chiLT;
    const courte = semelleLibre(Z, 235, 1500, 'basse').chiLT;
    expect(longue).toBeLessThan(moyenne);
    expect(moyenne).toBeLessThan(courte);
    expect(courte).toBeLessThanOrEqual(1);
  });
});

describe('pannes formées à froid sous soulèvement', () => {
  const avecPanne = (profile: string, rows: number): ProjectParams => {
    const pu = DEFAULT_PROJECT.secondary.purlins;
    return {
      ...DEFAULT_PROJECT,
      secondary: {
        ...DEFAULT_PROJECT.secondary,
        purlins: { ...pu, profile, sagBars: { ...pu.sagBars, rows } },
      },
    };
  };
  const pannes = (p: ProjectParams) => runChecks(p, buildProject(p)).lines.filter((x) => x.role === 'panne');

  it('vérifie la semelle libre DÈS que le moment s’inverse, et le dit', () => {
    /*
     * ⚠ Le défaut corrigé : un Z n'était « pas sujet au déversement », son
     * aile basse n'était jamais regardée, et le Z 200×2,0 du hangar par défaut
     * sortait à 0,88 sous vent ascendant. Il ne tient pas ce cas — l'aile libre
     * comprimée sur 3 m le fait sortir bien au-delà de 1,00.
     */
    const soul = pannes(avecPanne('Z 200x2.0', 1)).filter((x) => x.myEd < 0);
    expect(soul.length).toBeGreaterThan(0);
    const pire = soul.reduce((a, b) => (b.ratio > a.ratio ? b : a));
    expect(pire.ratio).toBeGreaterThan(1);
    expect(pire.avertissements.some((a) => /Semelle libre comprimée/.test(a))).toBe(true);
  });

  it('ne l’applique PAS sous la gravité : le bac tient l’aile haute', () => {
    const sousGravite = pannes(avecPanne('Z 250x2.5', 1)).filter((x) => x.myEd > 0);
    for (const l of sousGravite) {
      expect(l.avertissements.some((a) => /Semelle libre/.test(a)), l.combinaison).toBe(false);
    }
  });

  it('laisse les pannes laminées hors de ce contrôle', () => {
    for (const l of pannes(avecPanne('IPE 160', 1))) {
      expect(l.avertissements.some((a) => /Semelle libre/.test(a))).toBe(false);
    }
  });

  it('une seconde file de liernes soulage la panne, comme sur chantier', () => {
    const taux = (rows: number): number =>
      Math.max(...pannes(avecPanne('Z 200x2.0', rows)).map((x) => x.ratio));
    expect(taux(2)).toBeLessThan(taux(1));
  });
});

describe('note de calcul', () => {
  it('annonce la méthode et ses limites dès qu’un profil formé à froid est employé', () => {
    const pu = DEFAULT_PROJECT.secondary.purlins;
    const p: ProjectParams = {
      ...DEFAULT_PROJECT,
      secondary: { ...DEFAULT_PROJECT.secondary, purlins: { ...pu, profile: 'Z 200x2.0' } },
    };
    const h = runChecks(p, buildProject(p)).hypotheses.join('\n');
    expect(h).toMatch(/Z 200x2\.0/);
    expect(h).toMatch(/1993-1-3 § 10\.1\.4/);
    expect(h).toMatch(/flexion latérale de la semelle libre/);
  });

  it('n’en dit rien sur un ouvrage entièrement laminé', () => {
    const h = runChecks(DEFAULT_PROJECT, buildProject(DEFAULT_PROJECT)).hypotheses.join('\n');
    expect(h).not.toMatch(/formés à froid/);
  });
});
