import type { StructuralModel } from '../build/types';
import { plateMassKg } from '../build/buildProject';
import { elementsAFabriquer, tolesLibres } from '../drawing/sheets/element';
import { cutLengths, type MemberRole } from '../geometry/member';

/**
 * COLISAGE — comment l'ouvrage monte sur le camion.
 *
 * ⚠ Deux contraintes physiques décident, et le logiciel les connaissait toutes
 * les deux sans jamais les confronter : la LONGUEUR transportable et la CHARGE
 * utile. Une halle de 30 m sort des pièces de 11,3 m ; un plateau standard fait
 * 13,60 m. Sans colisage, on découvre au chargement qu'une pièce ne rentre pas —
 * et elle est déjà peinte.
 *
 * Le regroupement suit l'ORDRE DE MONTAGE, pas la seule optimisation du
 * remplissage : un camion qui arrive avec les pannes avant les poteaux fait
 * attendre la grue. Remplir au mieux et livrer dans le désordre coûte plus cher
 * qu'un camion à moitié vide.
 */

export interface ContraintesTransport {
  /** Longueur utile du plateau (mm). */
  readonly longueurUtile: number;
  /** Charge utile (kg). */
  readonly chargeUtile: number;
  readonly libelle: string;
}

/** Plateau standard : la remorque la plus courante en charpente. */
export const PLATEAU_STANDARD: ContraintesTransport = {
  longueurUtile: 13_600,
  chargeUtile: 26_000,
  libelle: 'Plateau standard 13,60 m',
};

export interface LigneColis {
  readonly mark: string;
  readonly profileId: string;
  readonly nombre: number;
  readonly longueur: number;
  readonly masse: number;
}

export interface Colis {
  readonly numero: number;
  /** Phase de montage que ce colis alimente. */
  readonly phase: string;
  readonly lignes: readonly LigneColis[];
  readonly masse: number;
  /** Pièce la plus longue du colis : elle décide du véhicule. */
  readonly longueurMax: number;
  /** Pièce la plus lourde : elle décide de l'engin de levage. */
  readonly masseUnitaireMax: number;
}

export interface Colisage {
  readonly colis: readonly Colis[];
  readonly masseTotale: number;
  /**
   * Repères qui NE TIENNENT PAS sur le véhicule choisi.
   *
   * ⚠ Nommés et sortis du colisage, jamais répartis en silence. Une pièce de
   * 15 m qu'on aurait glissée dans un colis « parce qu'il restait de la charge »
   * arrive au portail de l'usine et n'en sort pas.
   */
  readonly horsGabarit: readonly {
    readonly mark: string;
    readonly longueur: number;
    /** Masse du lot écarté : elle manque au camion, elle doit rester comptée. */
    readonly masse: number;
  }[];
  readonly transport: ContraintesTransport;
}

/**
 * Phases de montage, dans l'ordre où la grue les prend.
 *
 * Elles reprennent celles du plan de repérage : un colisage qui suivrait un
 * autre ordre ferait mentir le plan de montage.
 */
const PHASES: readonly { readonly titre: string; readonly roles: readonly MemberRole[] }[] = [
  { titre: '1 — Poteaux et potelets', roles: ['poteau', 'potelet'] },
  {
    titre: '2 — Traverses et fermes',
    roles: ['traverse', 'console', 'jarret', 'membrure-sup', 'membrure-inf', 'montant', 'diagonale'],
  },
  { titre: '3 — Contreventements', roles: ['contreventement'] },
  // Les chevêtres d'ouverture partent avec les lisses qu'ils reçoivent.
  { titre: '4 — Pannes, lisses et liernes', roles: ['panne', 'lisse', 'chevetre', 'lierne', 'attache', 'equerre'] },
  { titre: '5 — Pièces ajoutées au projet', roles: ['libre'] },
];

export function colisage(
  model: StructuralModel,
  transport: ContraintesTransport = PLATEAU_STANDARD,
): Colisage {
  /*
   * ⚠ On charge des ÉLÉMENTS FINIS, pas des barres nues. Un poteau part de
   * l'atelier avec sa platine de pied et sa platine d'about soudées : 454 kg au
   * lieu de 386. Peser la barre seule sous-estimait le camion de près de deux
   * tonnes sur ce hangar — et c'est le genre d'écart qui se découvre au pont
   * bascule, une fois chargé.
   *
   * `elementsAFabriquer` est la même source que les plans de fabrication et le
   * tableau de montage : les trois annoncent donc la même masse.
   */
  const elements = elementsAFabriquer(model);

  /*
   * Ce qu'on charge : un repère, combien, quelle longueur, quel poids. Les
   * TÔLES LIBRES — éclisses, goussets — y entrent comme les éléments : soudées à
   * rien, elles n'appartiennent à aucun, et n'étaient donc chargées sur aucun
   * camion. Sur une halle à fermes treillis, c'étaient deux tonnes et demie de
   * goussets qui ne partaient pas.
   */
  type ACharger = { mark: string; profileId: string; role: MemberRole; quantite: number; longueur: number; unitaire: number };
  const chargeables: ACharger[] = elements.map((e) => ({
    mark: e.repere,
    profileId: e.membre.profileId,
    role: e.membre.role,
    quantite: e.quantite,
    longueur: cutLengths(e.membre).max,
    unitaire: e.masseUnitaire,
  }));
  const libres = new Map<string, ACharger>();
  for (const pl of tolesLibres(model)) {
    const ys = pl.outline.map((q) => q.y);
    const zs = pl.outline.map((q) => q.z);
    const existant = libres.get(pl.mark);
    if (existant) {
      existant.quantite += 1;
      continue;
    }
    libres.set(pl.mark, {
      mark: pl.mark,
      profileId: `Tôle ép. ${pl.thickness}`,
      // Elles accompagnent les traverses éclissées et les fermes qu'elles assemblent.
      role: 'traverse',
      quantite: 1,
      longueur: Math.max(Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)),
      unitaire: plateMassKg(pl),
    });
  }
  chargeables.push(...libres.values());

  const horsGabarit: { mark: string; longueur: number; masse: number }[] = [];
  const colis: Colis[] = [];
  let numero = 0;

  for (const phase of PHASES) {
    /*
     * Les plus longues d'abord : elles fixent l'encombrement du colis, et les
     * courtes viennent ensuite remplir la charge restante. L'ordre inverse
     * fabriquerait des colis courts à moitié vides.
     */
    const aCharger = chargeables
      .filter((e) => phase.roles.includes(e.role))
      .sort((a, b) => b.longueur - a.longueur);

    let courant: LigneColis[] = [];
    let masse = 0;
    const fermer = (): void => {
      if (courant.length === 0) return;
      numero += 1;
      colis.push({
        numero,
        phase: phase.titre,
        lignes: courant,
        masse,
        longueurMax: Math.max(...courant.map((l) => l.longueur)),
        masseUnitaireMax: Math.max(...courant.map((l) => l.masse / l.nombre)),
      });
      courant = [];
      masse = 0;
    };

    for (const e of aCharger) {
      const n = e.quantite;
      const longueur = e.longueur;
      if (longueur > transport.longueurUtile) {
        horsGabarit.push({ mark: e.mark, longueur, masse: e.unitaire * n });
        continue;
      }
      const unitaire = e.unitaire;

      /*
       * ⚠ Un repère peut être SCINDÉ entre plusieurs colis : cinquante pannes
       * n'entrent pas dans un camion. On charge ce qui tient, on ferme, on
       * continue. Refuser de scinder ferait déborder le colis ou perdre la pièce.
       */
      let reste = n;
      while (reste > 0) {
        const place = Math.floor((transport.chargeUtile - masse) / Math.max(1, unitaire));
        if (place <= 0) {
          fermer();
          continue;
        }
        const pris = Math.min(reste, place);
        courant.push({
          mark: e.mark,
          profileId: e.profileId,
          nombre: pris,
          longueur,
          masse: unitaire * pris,
        });
        masse += unitaire * pris;
        reste -= pris;
        if (reste > 0) fermer();
      }
    }
    fermer();
  }

  return {
    colis,
    masseTotale: colis.reduce((s, c) => s + c.masse, 0),
    horsGabarit,
    transport,
  };
}

/**
 * Masse de TOUT ce qui doit partir : colisé plus hors gabarit.
 *
 * ⚠ Elle doit égaler la masse du modèle. Une pièce écartée du colisage reste une
 * pièce à livrer : ne pas la compter ferait croire à un ouvrage plus léger qu'il
 * n'est, et c'est exactement l'écart qui se découvre au pont bascule.
 */
export function masseALivrer(c: Colisage): number {
  return c.masseTotale + c.horsGabarit.reduce((s, h) => s + h.masse, 0);
}
