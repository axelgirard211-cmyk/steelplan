/**
 * CHARGE DE NEIGE — EN 1991-1-3 et son annexe nationale française.
 *
 * ⚠ La neige était SAISIE À LA MAIN, en kN/m², sans que rien ne dise d'où venait
 * le nombre. C'est la charge qui gouverne le dimensionnement de la quasi-totalité
 * des charpentes françaises : la porter au jugé, c'est décider du tonnage au
 * jugé. Elle se calcule pourtant exactement, à partir de deux données que
 * l'utilisateur connaît toujours — la commune et son altitude.
 */

/** Régions de neige de la carte française, NF EN 1991-1-3/NA. */
export type ZoneNeige = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'D' | 'E';

export const ZONES_NEIGE: readonly ZoneNeige[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'E'];

/**
 * Valeur caractéristique au sol sk,0 (kN/m²) sous 200 m d'altitude, et charge
 * ACCIDENTELLE sAd là où la carte en impose une.
 *
 * ⚠ La charge accidentelle n'est PAS un supplément de sécurité : c'est une chute
 * exceptionnelle, d'un seul tenant, vérifiée sous combinaison accidentelle avec
 * γ = 1,0. Elle n'existe que dans certaines régions — les régions « 2 » et D —
 * et elle y dépasse largement la neige normale. L'ignorer sur un bâtiment situé
 * en C2 revient à sauter le cas qui gouverne.
 */
const CARTE: Readonly<Record<ZoneNeige, { sk0: number; sAd: number }>> = {
  A1: { sk0: 0.45, sAd: 0 },
  A2: { sk0: 0.45, sAd: 1.0 },
  B1: { sk0: 0.55, sAd: 0 },
  B2: { sk0: 0.55, sAd: 1.0 },
  C1: { sk0: 0.65, sAd: 1.35 },
  C2: { sk0: 0.65, sAd: 1.35 },
  D: { sk0: 0.9, sAd: 1.8 },
  E: { sk0: 1.4, sAd: 0 },
};

/**
 * Majoration d'altitude Δs1 (kN/m²), NF EN 1991-1-3/NA § 4.1.
 *
 * ⚠ Elle est CONTINUE mais sa pente change à 500 et à 1000 m : la neige
 * s'accumule d'autant plus vite qu'on monte. Retenir une pente unique donnerait
 * 0,80 kN/m² au lieu de 1,05 à 1000 m — un quart de la charge en moins sur un
 * bâtiment de montagne.
 */
export function majorationAltitude(altitude: number): number {
  const a = Math.max(0, altitude);
  if (a <= 200) return 0;
  if (a <= 500) return a / 1000 - 0.2;
  if (a <= 1000) return (1.5 * a) / 1000 - 0.45;
  return (3.5 * a) / 1000 - 2.45;
}

export interface NeigeAuSol {
  /** Valeur caractéristique au sol (kN/m²). */
  readonly sk: number;
  /** Charge accidentelle au sol, 0 là où la carte n'en impose pas (kN/m²). */
  readonly sAd: number;
  readonly zone: ZoneNeige;
  readonly altitude: number;
}

export function neigeAuSol(zone: ZoneNeige, altitude: number): NeigeAuSol {
  const c = CARTE[zone];
  return {
    sk: c.sk0 + majorationAltitude(altitude),
    // ⚠ La charge accidentelle ne reçoit PAS la majoration d'altitude : elle est
    // donnée telle quelle par la carte. La majorer serait cumuler deux fois le
    // même caractère exceptionnel.
    sAd: c.sAd,
    zone,
    altitude,
  };
}

/**
 * Coefficient de forme μ1 d'une toiture à versants, EN 1991-1-3 § 5.3.
 *
 * ⚠ Il DÉCROÎT quand la pente augmente : au-delà de 60° la neige ne tient plus.
 * C'est le seul endroit du calcul où une toiture plus pentue est moins chargée,
 * et l'oublier surcharge inutilement les toitures raides.
 */
export function coefficientForme(penteDeg: number): number {
  const a = Math.abs(penteDeg);
  if (a <= 30) return 0.8;
  if (a >= 60) return 0;
  return (0.8 * (60 - a)) / 30;
}

export interface ChargeNeige {
  readonly sol: NeigeAuSol;
  readonly mu1: number;
  /** Charge normale sur la toiture (kN/m² de projection horizontale). */
  readonly s: number;
  /** Charge accidentelle sur la toiture, 0 si la région n'en impose pas. */
  readonly sAccidentelle: number;
}

/**
 * Charge de neige sur la toiture.
 *
 * `ce` (exposition) et `ct` (thermique) valent 1,00 dans le cas courant. Les
 * faire varier demanderait de connaître l'environnement du bâtiment et son
 * isolation, que le logiciel ne modélise pas.
 */
export function chargeNeige(
  zone: ZoneNeige,
  altitude: number,
  penteDeg: number,
  ce = 1,
  ct = 1,
): ChargeNeige {
  const sol = neigeAuSol(zone, altitude);
  const mu1 = coefficientForme(penteDeg);
  return {
    sol,
    mu1,
    s: mu1 * ce * ct * sol.sk,
    sAccidentelle: sol.sAd > 0 ? mu1 * ce * ct * sol.sAd : 0,
  };
}
