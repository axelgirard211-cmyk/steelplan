import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { positionsDesAncrages, type BasePlateParams } from '../../model/connections';
import { resistancesTige, verifierPiedPoteau } from '../assemblages/piedPoteau';
import type { Reaction } from '../reactions';

/**
 * PIED DE POTEAU — un cas calculé à la main, vérification par vérification.
 *
 * Platine 400 × 300 × 20 en S235 sous un HEA 200 (h = 190 mm), quatre tiges
 * M20 classe 8.8, béton C25/30, sans bêche. Sollicitations CONCOMITANTES (une
 * même combinaison) : N = 200 kN de compression, M = 60 kN·m, V = 30 kN.
 *
 * ⚠ Mis à jour avec la revue Eurocode : (1) le pied se vérifie désormais sous
 * des couples (N, V, M) concomitants — l'ancienne forme, qui prenait N dans
 * une réaction et M dans une autre, croisait des efforts qui ne coexistent
 * pas ; (2) le bras des tiges vient de leur implantation réelle
 * (`positionsDesAncrages`) et non plus de L − 1,5·d ; (3) le cisaillement d'une
 * tige suit EN 1993-1-8 § 6.2.2(7), αbc = 0,44 − 0,0003·fyb, et non αv = 0,6.
 *
 * Béton :
 *   fcd = fck / γc = 25 / 1,5 = 16,667 N/mm²
 *   fjd = βj · fcd = 2/3 × 16,667 = 11,111 N/mm²
 *   Nmax = fjd · b · L = 11,111 × 300 × 400 = 1 333 333 N
 *
 * Excentrement e = M / N = 60·10⁶ / 200·10³ = 300 mm > L/6 = 66,7 mm :
 * GRAND excentrement, bloc comprimé de longueur x contre une rive, tiges
 * tendues sur l'autre.
 *   pince = max(1,5 × (d0 + 4) ; 1,2·d0) = max(1,5 × 26 ; 26,4) = 39 mm
 *   dT  = L − pince = 400 − 39 = 361 mm (bras de la rangée tendue)
 *   k   = fjd · b = 3 333,3 N/mm
 *   rhs = N·(dT − L/2) + M = 200·10³ × 161 + 60·10⁶ = 92,2·10⁶ N·mm
 *   x   = dT − √(dT² − 2·rhs/k) = 361 − √(130 321 − 55 320) = 361 − 273,863
 *       = 87,137 mm
 *   C   = k · x = 290 457 N         → taux béton 290,46 / 1 333,33 = 0,2178
 *
 * Tiges :
 *   T = C − N = 90 457 N, sur la rangée tendue de 2 tiges : 45,23 kN par tige
 *   Ft,Rd = 0,9 · fub · As / γM2 = 0,9 × 800 × 245 / 1,25 = 141,12 kN
 *   → taux 45,23 / 141,12 = 0,3205
 *
 * Cisaillement (sans bêche, les tiges seules, frottement ignoré) :
 *   30 kN / 4 = 7,5 kN par tige
 *   αbc = 0,44 − 0,0003 × 640 = 0,248
 *   Fvb,Rd = αbc · fub · As / γM2 = 0,248 × 800 × 245 / 1,25 = 38,886 kN
 *   → taux 7,5 / 38,886 = 0,1929
 *   interaction 0,1929 + 45,23 / (1,4 × 141,12) = 0,1929 + 0,2289 = 0,4218
 *
 * Flexion de la platine en console au-delà de la semelle :
 *   débord = (400 − 190) / 2 = 105 mm, bras retenu min(105 ; x) = 87,137 mm
 *   σ = C / (b · x) = fjd = 11,111 N/mm²
 *   m_Ed = σ · 87,137² / 2 = 42 182 N·mm/mm
 *   m_Rd = t² · fy / 4 / γM0 = 20² × 235 / 4 = 23 500 N·mm/mm
 *   → taux 42 182 / 23 500 = 1,795 : c'est elle qui gouverne, la platine de
 *     20 mm est trop mince pour ce moment.
 */

const CB: BasePlateParams = {
  thickness: 20,
  width: 300,
  length: 400,
  anchorDiameter: 20,
  anchorCount: 4,
  anchorEmbedment: 500,
  groutThickness: 30,
  shearKey: false,
  concrete: 'C25/30',
  anchorClass: '8.8',
};
const R = (fz: number, fy: number, m: number): Reaction => ({ fz, fy, m, combinaison: '1,35 G + 1,5 W' });

/** Taux de la vérification nommée, à ±1 % de la valeur attendue. */
function taux(nom: RegExp, attendu: number, verifs: ReturnType<typeof verifierPiedPoteau>['verifs']): void {
  const v = verifs.find((x) => nom.test(x.nom));
  expect(v, `vérification ${nom} absente`).toBeDefined();
  expect(Math.abs(v!.ratio / attendu - 1), `${v!.nom} : ${v!.ratio.toFixed(4)} au lieu de ${attendu}`).toBeLessThanOrEqual(0.01);
}

describe('pied de poteau calculé à la main', () => {
  it('part des données du calcul : HEA 200 de 190 mm, rangée tendue à 161 mm du centre', () => {
    expect(getProfile('HEA 200').h).toBe(190);
    // dT = L/2 + zMax = 200 + 161 = 361 mm.
    expect(Math.max(...positionsDesAncrages(CB).map((q) => q.z))).toBeCloseTo(161, 6);
    const t = resistancesTige(20, '8.8');
    expect(t.ftRd / 1000).toBeCloseTo(141.12, 2);
    expect(t.alphaBc).toBeCloseTo(0.248, 6);
    expect(t.fvbRd / 1000).toBeCloseTo(38.886, 2);
  });

  it('en classe 4.6, la plus courante, retrouve Ft,Rd = 70,56 kN et Fvb,Rd = 28,85 kN', () => {
    // αbc = 0,44 − 0,0003 × 240 = 0,368 ; Ft,Rd = 0,9 × 400 × 245 / 1,25 ;
    // Fvb,Rd = 0,368 × 400 × 245 / 1,25.
    const t = resistancesTige(20, '4.6');
    expect(t.ftRd / 1000).toBeCloseTo(70.56, 2);
    expect(t.fvbRd / 1000).toBeCloseTo(28.851, 2);
    // Même cas : 45,23 / 70,56 = 0,641 en traction, la flexion gouverne toujours.
    const r46 = verifierPiedPoteau(
      { id: 'PP', libelle: 'Pied', cb: { ...CB, anchorClass: '4.6' }, profilPoteau: 'HEA 200', nuance: 'S235' },
      R(200, 30, 60),
    );
    taux(/^traction des tiges/, 0.641, r46.verifs);
    taux(/^cisaillement des tiges/, 0.26, r46.verifs);
    taux(/traction et cisaillement/, 0.7178, r46.verifs);
  });

  it('rend le plus défavorable des cas, sans mêler leurs efforts', () => {
    // N = 100 kN centré : σ = 0,833 N/mm², platine à 0,833 × 105² / 2 / 23 500 = 0,195.
    const ctx = { id: 'PP', libelle: 'Pied', cb: CB, profilPoteau: 'HEA 200', nuance: 'S235' as const };
    const doux: Reaction = { fz: 100, fy: 0, m: 0, combinaison: 'gravitaire' };
    expect(Math.abs(verifierPiedPoteau(ctx, doux).ratio / 0.1955 - 1)).toBeLessThanOrEqual(0.01);
    const p = verifierPiedPoteau(ctx, doux, R(200, 30, 60));
    expect(p.combinaison).toBe('1,35 G + 1,5 W');
    expect(Math.abs(p.ratio / 1.795 - 1)).toBeLessThanOrEqual(0.01);
  });

  const r = verifierPiedPoteau(
    { id: 'PP', libelle: 'Pied de poteau', cb: CB, profilPoteau: 'HEA 200', nuance: 'S235' },
    R(200, 30, 60),
  );

  it('retrouve la pression sur le béton sous grand excentrement', () => {
    taux(/pression sur béton C25\/30/, 0.2178, r.verifs);
    const v = r.verifs.find((x) => /pression/.test(x.nom))!;
    expect(v.ed).toBeCloseTo(290.46, 0);
    expect(v.rd).toBeCloseTo(1333.33, 1);
  });

  it('fait tirer les tiges alors que l’effort normal reste une compression', () => {
    taux(/traction des tiges/, 0.3205, r.verifs);
    const v = r.verifs.find((x) => /traction des tiges/.test(x.nom))!;
    expect(v.ed).toBeCloseTo(45.23, 1);
    expect(v.rd).toBeCloseTo(141.12, 2);
  });

  it('cisaille les quatre tiges avec αbc, sans compter le frottement', () => {
    taux(/^cisaillement des tiges/, 0.1929, r.verifs);
    taux(/traction et cisaillement/, 0.4218, r.verifs);
  });

  it('fait gouverner la flexion de la platine, à 1,795', () => {
    taux(/flexion de la platine/, 1.795, r.verifs);
    expect(r.gouverne).toBe('flexion de la platine');
    expect(Math.abs(r.ratio / 1.795 - 1)).toBeLessThanOrEqual(0.01);
  });

  it('dit ce qu’il ne vérifie pas : l’ancrage dans le béton', () => {
    expect(r.nonCouvert.some((t) => /EN 1992-4/.test(t))).toBe(true);
  });

  it('passe au petit excentrement sans traction des tiges', () => {
    /*
     * N = 1 000 kN, M = 50 kN·m : e = 50 mm ≤ L/6 = 66,7 mm, toute la platine
     * est comprimée. Contrainte de rive :
     *   σ = N/(b·L) + M/(b·L²/6) = 10⁶/120 000 + 50·10⁶/8·10⁶ = 8,333 + 6,25
     *     = 14,583 N/mm²
     * Résultante retenue σ·b·L = 1 750 kN → taux 1 750 / 1 333,33 = 1,3125.
     */
    const p = verifierPiedPoteau(
      { id: 'PP', libelle: 'Pied', cb: CB, profilPoteau: 'HEA 200', nuance: 'S235' },
      R(1000, 0, 50),
    );
    taux(/pression sur béton/, 1.3125, p.verifs);
    expect(p.verifs.some((v) => /traction/.test(v.nom))).toBe(false);
  });
});

describe('pied de poteau aux limites de l’équilibre', () => {
  const ctx = (cb: BasePlateParams = CB) => ({ id: 'PP', libelle: 'Pied', cb, profilPoteau: 'HEA 200', nuance: 'S235' as const });

  it('déclare ruiné le pied qu’aucun bloc ne peut équilibrer, d’autant plus que M croît', () => {
    /*
     * N = 1 000 kN. Le bloc le plus long, jusqu'à la rangée tendue, équilibre
     * au plus k·dT²/2 = 3 333,3 × 361² / 2 = 217,2 kN·m autour des tiges.
     *   M = 67 kN·m  : rhs = 10⁶ × 161 + 67·10⁶ = 228·10⁶ → taux 1,050
     *   M = 100 kN·m : rhs = 261·10⁶                   → taux 1,202
     * (l'ancienne « compression requise » restait sous N : taux 0,75, conforme.)
     */
    const a = verifierPiedPoteau(ctx(), R(1000, 0, 67));
    const b = verifierPiedPoteau(ctx(), R(1000, 0, 100));
    taux(/pression sur béton/, 1.0497, a.verifs);
    taux(/pression sur béton/, 1.2017, b.verifs);
    expect(b.ratio).toBeGreaterThan(a.ratio);
    expect(a.verifs.some((v) => /traction des tiges/.test(v.nom))).toBe(true);
  });

  it('impose C = N quand les tiges devraient pousser', () => {
    /*
     * N = 200 kN, M = 14 kN·m : e = 70 mm, juste au-delà de L/6. L'équation aux
     * moments donnerait x = 40,7 mm et C = 135,6 kN < N. Aucune tige ne tire :
     *   x = N / (fjd·b) = 200 000 / 3 333,3 = 60 mm, C = N = 200 kN
     *   béton 200 / 1 333,33 = 0,150
     *   platine : fjd × 60² / 2 = 20 000 N·mm/mm, / 23 500 = 0,851
     */
    const p = verifierPiedPoteau(ctx(), R(200, 0, 14));
    taux(/pression sur béton/, 0.15, p.verifs);
    taux(/flexion de la platine/, 0.851, p.verifs);
    expect(p.verifs.some((v) => /traction/.test(v.nom))).toBe(false);
  });

  it('ne fait pas baisser le taux quand M croît, à N fixé, hors du tiers central', () => {
    let avant = 0;
    for (let m = 14; m <= 80; m += 2) {
      const t = verifierPiedPoteau(ctx(), R(200, 0, m)).ratio;
      expect(t, `M = ${m} kN·m`).toBeGreaterThanOrEqual(avant - 1e-9);
      avant = t;
    }
  });

  it('charge une tige seule de tout le soulèvement', () => {
    const seule: BasePlateParams = { ...CB, anchorCount: 1 };
    expect(positionsDesAncrages(seule)).toHaveLength(1);
    const p = verifierPiedPoteau(ctx(seule), R(-60, 0, 0));
    const v = p.verifs.find((x) => /^traction des tiges/.test(x.nom))!;
    expect(v.ed).toBeCloseTo(60, 1);
    // Deux tiges sur une rangée centrale se partagent le même soulèvement.
    const deux = verifierPiedPoteau(ctx({ ...CB, anchorCount: 2 }), R(-60, 0, 0));
    expect(deux.verifs.find((x) => /^traction des tiges/.test(x.nom))!.ed).toBeCloseTo(30, 1);
  });
});
