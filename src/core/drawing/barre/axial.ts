import { ECHELLES } from '../scale';

/**
 * VUE INTERROMPUE — la correspondance entre l'abscisse d'une barre et le papier.
 *
 * ⚠ Une traverse de dix mètres au 1:100 tient sur un A3 et ne se lit pas : son
 * profil fait trois millimètres de haut, ses trous un demi-millimètre, et six
 * rangées de boulons à 122 mm d'entraxe s'écrasent sur deux centimètres de
 * papier. Le dessinateur d'atelier ne fait pas ça : il INTERROMPT la pièce là où
 * il n'y a rien à voir, et dessine à grande échelle là où l'on perce, coupe et
 * soude. Les cotes, elles, restent les vraies.
 *
 * On construit des ZONES autour de tout ce qui doit se lire — perçages, tôles,
 * pièces soudées, grugeages, abouts —, puis on cherche la plus grande échelle
 * normalisée à laquelle ces zones, séparées par des interruptions de longueur
 * fixe sur le papier, tiennent dans la largeur disponible.
 */

/** Intervalle d'abscisses à rendre lisible (mm modèle). */
export interface Interet {
  readonly a: number;
  readonly b: number;
}

export interface Axial {
  /** Dénominateur d'échelle normalisé des zones dessinées. */
  readonly echelle: number;
  /** Abscisse papier (mm), depuis le début de la barre dessinée. */
  readonly x: (s: number) => number;
  /** Longueur papier totale de la barre dessinée (mm). */
  readonly longueur: number;
  /** Zones dessinées à l'échelle, en abscisses modèle. */
  readonly zones: readonly Interet[];
  /** Interruptions : leurs bornes papier. */
  readonly coupures: readonly { readonly x0: number; readonly x1: number }[];
}

/** Longueur papier d'une interruption (mm). */
export const LONGUEUR_COUPURE = 12;
/** En deçà de cette longueur papier, un vide se dessine sans interruption. */
const VIDE_MINI = 3 * LONGUEUR_COUPURE;
/**
 * Hauteur papier au-delà de laquelle un profil ne gagne plus rien à grandir :
 * un tube de 60 mm au 1:1 occupe la planche sans montrer davantage. On reste
 * sous ce plafond — 25 mm, de quoi lire un trou de 13 mm à son échelle.
 */
const HAUTEUR_PROFIL_MAXI = 25;
/** Écart papier minimal entre deux abscisses à coter côte à côte. */
export const ECART_LISIBLE = 3.2;

export interface OptionsAxial {
  /** Étendue du métal (mm modèle). */
  readonly sMin: number;
  readonly sMax: number;
  readonly interets: readonly Interet[];
  /** Largeur papier disponible (mm). */
  readonly largeur: number;
  /** Plus grande dimension transversale du profil (mm modèle). */
  readonly hauteurProfil: number;
  /** Hauteur papier qu'un profil peut occuper au plus (mm). */
  readonly hauteurMaxi: number;
  /** Marge autour de chaque point d'intérêt (mm modèle). */
  readonly marge: number;
  /**
   * Hauteur papier au-delà de laquelle le dessin ne gagne plus rien à grandir
   * (mm) — 25 par défaut, celle d'un plan de pièce. Un plan d'assemblage, qui
   * montre aussi les tôles débordant du profil, en accepte davantage.
   */
  readonly plafond?: number;
}

/**
 * Mise en page axiale : la PLUS GRANDE échelle normalisée qui tient. Les
 * échelles sont essayées de la plus grande à la plus petite : la première qui
 * tient est donc aussi celle où les cotes sont le moins serrées — en prendre une
 * plus petite ne ferait que les rapprocher.
 */
export function miseEnPageAxiale(o: OptionsAxial): Axial {
  let repli: Axial | null = null;
  for (const d of ECHELLES) {
    const axial = construire(o, d);
    repli = axial;
    const hauteurPapier = o.hauteurProfil / d;
    if (axial.longueur <= o.largeur && hauteurPapier <= Math.min(o.hauteurMaxi, o.plafond ?? HAUTEUR_PROFIL_MAXI)) return axial;
  }
  return repli as Axial;
}

function construire(o: OptionsAxial, d: number): Axial {
  // 1. Intervalles d'intérêt, élargis de la marge et bornés au métal.
  const bruts = o.interets
    .map((i) => ({
      a: Math.max(o.sMin, Math.min(i.a, i.b) - o.marge),
      b: Math.min(o.sMax, Math.max(i.a, i.b) + o.marge),
    }))
    .filter((i) => i.b > i.a)
    .sort((x, y) => x.a - y.a);
  if (bruts.length === 0) bruts.push({ a: o.sMin, b: o.sMax });

  // 2. Fusion : deux zones dont le vide tiendrait sans interruption se rejoignent.
  const zones: { a: number; b: number }[] = [];
  for (const z of bruts) {
    const der = zones[zones.length - 1];
    if (der && (z.a - der.b) / d <= VIDE_MINI) der.b = Math.max(der.b, z.b);
    else zones.push({ ...z });
  }
  // Les abouts du métal appartiennent toujours à une zone : sans eux, la barre
  // commencerait par une interruption, ce qu'aucun plan ne fait.
  const premiere = zones[0] as { a: number; b: number };
  if ((premiere.a - o.sMin) / d <= VIDE_MINI) premiere.a = o.sMin;
  else zones.unshift({ a: o.sMin, b: o.sMin });
  const derniere = zones[zones.length - 1] as { a: number; b: number };
  if ((o.sMax - derniere.b) / d <= VIDE_MINI) derniere.b = o.sMax;
  else zones.push({ a: o.sMax, b: o.sMax });

  // 3. Abscisses papier de début de chaque zone.
  const debuts: number[] = [];
  const coupures: { x0: number; x1: number }[] = [];
  let x = 0;
  zones.forEach((z, i) => {
    if (i > 0) {
      coupures.push({ x0: x, x1: x + LONGUEUR_COUPURE });
      x += LONGUEUR_COUPURE;
    }
    debuts.push(x);
    x += (z.b - z.a) / d;
  });

  const versPapier = (s: number): number => {
    // Dans une zone : à l'échelle. Dans une interruption : interpolé, pour que
    // rien ne saute — mais aucune cote ne s'y pose.
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i] as { a: number; b: number };
      if (s <= z.b || i === zones.length - 1) {
        if (s >= z.a || i === 0) return (debuts[i] as number) + (s - z.a) / d;
        const prec = zones[i - 1] as { a: number; b: number };
        const x0 = (debuts[i - 1] as number) + (prec.b - prec.a) / d;
        const t = (s - prec.b) / Math.max(1e-9, z.a - prec.b);
        return x0 + t * LONGUEUR_COUPURE;
      }
    }
    return x;
  };

  return { echelle: d, x: versPapier, longueur: x, zones, coupures };
}
