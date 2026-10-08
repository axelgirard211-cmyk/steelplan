import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { runChecks } from '../../checks/index';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import { chargesClimatiques, chargesEffectives } from '../index';
import { chargeNeige, coefficientForme, majorationAltitude, neigeAuSol } from '../neige';
import {
  coefficientsParoi,
  coefficientsToiture,
  CPI_POSITIF,
  pressionDynamique,
  succionMaximale,
  zonageToiture,
} from '../vent';

/**
 * CHARGES CLIMATIQUES.
 *
 * ⚠ Les valeurs sont comparées à des références EXTÉRIEURES — les tableaux de
 * la norme et des cas de calcul classiques — et non à ce que le code produit
 * aujourd'hui. Ces charges gouvernent le dimensionnement de presque toute la
 * charpente : figer une sortie fausse la rendrait durablement fausse.
 */

describe('neige — EN 1991-1-3 et annexe française', () => {
  it('ne majore rien sous 200 m, puis majore par paliers de pente croissante', () => {
    expect(majorationAltitude(150)).toBe(0);
    expect(majorationAltitude(200)).toBe(0);
    // 300 m : 300/1000 − 0,20 = 0,10
    expect(majorationAltitude(300)).toBeCloseTo(0.1, 6);
    // 800 m : 1,5 × 0,8 − 0,45 = 0,75
    expect(majorationAltitude(800)).toBeCloseTo(0.75, 6);
    // 1500 m : 3,5 × 1,5 − 2,45 = 2,80
    expect(majorationAltitude(1500)).toBeCloseTo(2.8, 6);
  });

  it('reste CONTINUE aux changements de pente', () => {
    /*
     * ⚠ Les trois formules doivent se raccorder. Un saut à 500 ou à 1000 m
     * ferait qu'un bâtiment à 999 m et son voisin à 1001 m ne recevraient pas la
     * même neige — et personne ne comprendrait pourquoi.
     */
    for (const seuil of [500, 1000]) {
      expect(majorationAltitude(seuil - 0.001)).toBeCloseTo(majorationAltitude(seuil + 0.001), 4);
    }
  });

  it('donne sk = 0,75 kN/m² en région C2 à 300 m', () => {
    // 0,65 au sol + 0,10 de majoration.
    expect(neigeAuSol('C2', 300).sk).toBeCloseTo(0.75, 6);
  });

  it('n’impose une neige ACCIDENTELLE que là où la carte en prévoit une', () => {
    /*
     * ⚠ Ce n'est pas un supplément de sécurité mais une chute exceptionnelle,
     * vérifiée sous combinaison accidentelle. L'ignorer en C2 revient à sauter le
     * cas qui gouverne.
     */
    expect(neigeAuSol('A1', 0).sAd).toBe(0);
    expect(neigeAuSol('E', 0).sAd).toBe(0);
    expect(neigeAuSol('C2', 0).sAd).toBeCloseTo(1.35, 6);
    expect(neigeAuSol('D', 0).sAd).toBeCloseTo(1.8, 6);
  });

  it('ne majore PAS la neige accidentelle avec l’altitude', () => {
    // La carte la donne telle quelle ; la majorer cumulerait deux fois le même
    // caractère exceptionnel.
    expect(neigeAuSol('C2', 1500).sAd).toBe(neigeAuSol('C2', 0).sAd);
  });

  it('allège les toitures raides et vide celles au-delà de 60°', () => {
    expect(coefficientForme(0)).toBeCloseTo(0.8, 6);
    expect(coefficientForme(30)).toBeCloseTo(0.8, 6);
    expect(coefficientForme(45)).toBeCloseTo(0.4, 6);
    expect(coefficientForme(60)).toBe(0);
    expect(coefficientForme(75)).toBe(0);
  });

  it('donne 0,60 kN/m² en toiture en C2 à 300 m sous 5,7° de pente', () => {
    expect(chargeNeige('C2', 300, 5.71).s).toBeCloseTo(0.6, 3);
  });
});

describe('vent — EN 1991-1-4 et annexe française', () => {
  it('donne qp ≈ 0,83 kN/m² en région 2, terrain II, à 10 m', () => {
    /*
     * ⚠ Le cas de référence le plus courant de la littérature française. Il fixe
     * d'un coup vb, kr, cr, Iv et ρ : si l'un d'eux est faux, ce contrôle le dit.
     */
    const q = pressionDynamique('2', 'II', 10);
    expect(q.vb).toBe(24);
    expect(q.vm).toBeCloseTo(24.16, 1);
    expect(q.iv).toBeCloseTo(0.1887, 3);
    expect(q.qp).toBeCloseTo(0.83, 2);
  });

  it('décroît quand le terrain devient rugueux', () => {
    // De la mer à la ville dense, la pression tombe de moitié : c'est le terrain
    // qui pèse le plus dans le calcul, davantage que la région.
    const q = (t: Parameters<typeof pressionDynamique>[1]): number =>
      pressionDynamique('2', t, 10).qp;
    expect(q('0')).toBeGreaterThan(q('II'));
    expect(q('II')).toBeGreaterThan(q('IIIa'));
    expect(q('IIIa')).toBeGreaterThan(q('IIIb'));
    expect(q('IV')).toBeLessThan(q('0') * 0.6);
  });

  it('croît avec le carré de la vitesse de région', () => {
    // qp ∝ vb². Entre la région 1 (22 m/s) et la 4 (28 m/s) : (28/22)² = 1,62.
    const r = pressionDynamique('4', 'II', 10).qp / pressionDynamique('1', 'II', 10).qp;
    expect(r).toBeCloseTo((28 / 22) ** 2, 2);
  });

  it('PLAFONNE la hauteur par le bas à zmin', () => {
    /*
     * ⚠ Sous zmin le profil logarithmique donnerait une vitesse nulle puis
     * négative : un auvent de 3 m en terrain IV serait calculé sans vent.
     */
    const bas = pressionDynamique('2', 'IV', 3);
    expect(bas.ze).toBe(15);
    expect(bas.qp).toBeGreaterThan(0);
    expect(bas.qp).toBe(pressionDynamique('2', 'IV', 15).qp);
  });

  it('interpole les coefficients de paroi SANS discontinuité', () => {
    /*
     * ⚠ Une première version passait E de −0,30 à −0,50 d'un coup au
     * franchissement de h/d = 0,25 : un hangar de h/d = 0,26 était calculé comme
     * un h/d = 1. Un tableau interpolé ne doit jamais sauter.
     */
    const e = (r: number): number => coefficientsParoi(r * 20, 20).E;
    expect(e(0.25)).toBeCloseTo(-0.3, 6);
    expect(e(1)).toBeCloseTo(-0.5, 6);
    expect(e(5)).toBeCloseTo(-0.7, 6);
    for (const r of [0.25, 1]) {
      expect(e(r - 0.001)).toBeCloseTo(e(r + 0.001), 3);
    }
    // D croît de 0,70 à 0,80 puis reste constante.
    expect(coefficientsParoi(0, 20).D).toBeCloseTo(0.7, 6);
    expect(coefficientsParoi(20, 20).D).toBeCloseTo(0.8, 6);
    expect(coefficientsParoi(100, 20).D).toBeCloseTo(0.8, 6);
  });

  it('aspire beaucoup plus la RIVE que la partie courante', () => {
    /*
     * C'est le fait physique que la valeur unique saisie à la main effaçait : en
     * zone F la succion vaut près de trois fois celle de la zone H. C'est en rive
     * que le bac s'arrache.
     */
    const c = coefficientsToiture(5);
    expect(c.F[0]).toBeCloseTo(-1.7, 6);
    expect(c.H[0]).toBeCloseTo(-0.6, 6);
    expect(Math.abs(c.F[0] / c.H[0])).toBeGreaterThan(2.5);
    expect(succionMaximale(c)).toBe(c.F[0]);
  });

  it('retrouve les valeurs tabulées aux angles du tableau 7.4a', () => {
    expect(coefficientsToiture(15).G[0]).toBeCloseTo(-0.8, 6);
    expect(coefficientsToiture(30).H[1]).toBeCloseTo(0.4, 6);
    expect(coefficientsToiture(45).I[0]).toBeCloseTo(-0.2, 6);
  });
});

describe('zonage de toiture — figure 7.8', () => {
  // Hangar de référence : 30 m de long, 20 m de portée, 7 m au faîtage.
  const c = coefficientsToiture(5.71);
  const z = zonageToiture(c, 30, 20, 7);

  it('découpe la toiture sans perdre ni inventer de surface', () => {
    const total = Object.values(z.aires).reduce((s, a) => s + a, 0);
    expect(total).toBeCloseTo(30 * 20, 6);
  });

  it('donne à la RIVE une part minuscule de la toiture', () => {
    /*
     * ⚠ Le fait qui change tout. La zone F couvre dix mètres carrés sur six
     * cents. Lui donner toute la toiture — ce que faisait la première version de
     * ce module — triplait le soulèvement d'ensemble et condamnait un hangar
     * parfaitement correct : le taux de travail passait de 0,90 à 1,15.
     */
    expect(z.e).toBeCloseTo(14, 6);
    expect(z.aires.F).toBeCloseTo(10, 0);
    expect(z.aires.F / (30 * 20)).toBeLessThan(0.02);
  });

  it('sépare le coefficient MOYEN de celui de POINTE', () => {
    // L'un dimensionne l'ossature, l'autre la fixation du bac. Les confondre est
    // l'erreur, dans un sens comme dans l'autre.
    expect(z.cpePointe).toBeCloseTo(succionMaximale(c), 6);
    expect(Math.abs(z.cpeMoyen)).toBeLessThan(Math.abs(z.cpePointe) / 2);
    expect(z.cpeMoyen).toBeCloseTo(-0.63, 2);
  });

  it('reste borné par les coefficients extrêmes de la toiture', () => {
    // Une moyenne pondérée ne peut pas sortir de l'intervalle des valeurs
    // pondérées : ce contrôle attrape toute erreur de pondération.
    const valeurs = [c.F[0], c.G[0], c.H[0], c.I[0], c.J[0]];
    expect(z.cpeMoyen).toBeGreaterThanOrEqual(Math.min(...valeurs));
    expect(z.cpeMoyen).toBeLessThanOrEqual(Math.max(...valeurs));
  });
});

describe('pression intérieure', () => {
  it('AGGRAVE la dépression de toiture, elle ne la soulage pas', () => {
    /*
     * ⚠ Elle manquait entièrement. Sur une toiture aspirée, c'est la surpression
     * intérieure qui pousse de l'intérieur et s'ajoute à la succion extérieure.
     * L'omettre sous-estime l'enveloppe de 20 à 30 %.
     */
    const p: ProjectParams = {
      ...DEFAULT_PROJECT,
      site: { ...DEFAULT_PROJECT.site, mode: 'eurocode' },
    };
    const c = chargesClimatiques(p);
    const sansCpi = Math.abs(c.vent.qp * c.zonage.cpeMoyen);
    expect(c.valeurs.ventDepression).toBeGreaterThan(sansCpi);
    expect(c.valeurs.ventDepression).toBeCloseTo(
      Math.abs(c.vent.qp * (c.zonage.cpeMoyen - CPI_POSITIF)),
      2,
    );
  });
});

describe('branchement au calcul', () => {
  const site = (p: ProjectParams): ProjectParams => ({
    ...p,
    site: { ...p.site, mode: 'eurocode', zoneNeige: 'C2', zoneVent: '3', altitude: 400 },
  });

  it('NE CHANGE RIEN tant que le site est en mode manuel', () => {
    /*
     * ⚠ Le mode manuel est le défaut, et c'est délibéré : un fichier enregistré
     * avant ce module n'a pas de site, et ses charges ne doivent pas changer sous
     * son auteur au premier rechargement.
     */
    expect(DEFAULT_PROJECT.site.mode).toBe('manuel');
    expect(chargesEffectives(DEFAULT_PROJECT)).toEqual(DEFAULT_PROJECT.loads.loads);
  });

  it('remplace neige et vent en mode Eurocode, sans toucher au reste', () => {
    const p = site(DEFAULT_PROJECT);
    const avant = DEFAULT_PROJECT.loads.loads;
    const apres = chargesEffectives(p);

    expect(apres.permanent).toBe(avant.permanent);
    expect(apres.exploitation).toBe(avant.exploitation);
    expect(apres.includeSelfWeight).toBe(avant.includeSelfWeight);
    expect(apres.neige).not.toBe(avant.neige);
    expect(apres.neige).toBeCloseTo(chargesClimatiques(p).valeurs.neige, 6);
  });

  it('fait remonter les charges JUSQU’AU rapport de vérification', () => {
    /*
     * Le contrôle de bout en bout : durcir le site doit alourdir la structure.
     * Un branchement partiel — combinaisons alimentées d'un côté, intensités de
     * l'autre — passerait tous les contrôles unitaires et se verrait ici.
     */
    const doux = DEFAULT_PROJECT;
    const rude = site({
      ...DEFAULT_PROJECT,
      site: { ...DEFAULT_PROJECT.site, terrain: '0' },
    });
    const a = runChecks(doux, buildProject(doux)).maxRatio;
    const b = runChecks(rude, buildProject(rude)).maxRatio;
    expect(b, `doux ${a.toFixed(2)} → rude ${b.toFixed(2)}`).toBeGreaterThan(a);
  });

  it('inscrit le climat retenu dans les hypothèses', () => {
    const h = runChecks(site(DEFAULT_PROJECT), buildProject(site(DEFAULT_PROJECT))).hypotheses.join(
      '\n',
    );
    expect(h).toMatch(/EN 1991-1-3/);
    expect(h).toMatch(/EN 1991-1-4/);
    expect(h).toMatch(/qp = /);
    expect(h).toMatch(/région C2/);
  });

  it('avertit quand les charges sont saisies à la main', () => {
    const h = runChecks(DEFAULT_PROJECT, buildProject(DEFAULT_PROJECT)).hypotheses.join('\n');
    expect(h).toMatch(/SAISIS À LA MAIN/);
  });
});
