import type { Node2 } from '../analysis/frame2d';

/**
 * DESCENTE DE CHARGES : ce que la charpente rend aux fondations.
 *
 * ⚠ Le solveur produisait déjà ces réactions à chaque combinaison, et personne
 * ne les lisait — `Frame2dResult.reactions` n'était référencé nulle part hors du
 * solveur lui-même. C'est pourtant le SEUL document que le bureau d'études béton
 * attend de la charpente : sans effort en pied, aucune semelle ne se calcule et
 * rien ne se coule.
 *
 * L'enveloppe est retenue par extrême SIGNÉ, jamais en valeur absolue : la
 * compression maximale et le soulèvement maximal sont deux cas de fondation
 * distincts. Une semelle se dimensionne à la compression, et se vérifie au
 * soulèvement — confondre les deux revient à ne vérifier ni l'un ni l'autre.
 */

/** Réaction d'un pied de poteau sous une combinaison donnée (kN, kN·m). */
export interface Reaction {
  /**
   * Effort vertical rendu PAR la fondation À la charpente.
   *
   * ⚠ POSITIF = la semelle pousse vers le haut, donc le poteau la COMPRIME.
   * NÉGATIF = la semelle retient, donc le poteau l'ARRACHE. Le sens n'est pas
   * une convention libre : l'avoir lu à l'envers faisait annoncer 81 kN de
   * soulèvement sous « 1,35 G + 1,50 Q », c'est-à-dire sous le cas le plus
   * gravitaire qui soit. Une semelle dimensionnée sur cette lecture aurait été
   * calculée à l'arrachement là où elle travaille en compression.
   */
  readonly fz: number;
  /** Effort horizontal dans le plan du portique. */
  readonly fy: number;
  /** Moment d'encastrement ; nul sur un pied articulé. */
  readonly m: number;
  readonly combinaison: string;
}

/** Enveloppe des réactions d'un appui, tous cas confondus. */
export interface EnveloppeAppui {
  /** Repère de l'appui, du type « A1 » : file transversale et abscisse. */
  readonly repere: string;
  /** Position dans le plan du portique (mm) et abscisse longitudinale (mm). */
  readonly y: number;
  readonly x: number;
  /** Compression maximale : la réaction dont fz est le plus POSITIF. */
  readonly compression: Reaction;
  /** Soulèvement maximal : la réaction dont fz est le plus NÉGATIF. */
  readonly soulevement: Reaction;
  /** Effort horizontal maximal en valeur absolue, et le cas qui le produit. */
  readonly horizontal: Reaction;
  /** Moment maximal en valeur absolue. */
  readonly moment: Reaction;
  /**
   * Toutes les réactions, combinaison par combinaison, N, V et M CONCOMITANTS.
   * Les extrêmes ci-dessus suffisent au tableau des fondations ; une
   * vérification qui croise N et M doit lire ceci, faute de quoi elle associe
   * des efforts qui ne coexistent jamais.
   */
  readonly cas?: readonly Reaction[];
}

/** Accumulateur : on lui donne les réactions cas par cas, il garde les extrêmes. */
export class EnveloppeReactions {
  private readonly parAppui = new Map<
    string,
    { y: number; x: number; cas: Reaction[] }
  >();

  ajouter(
    repere: string,
    noeud: Node2,
    x: number,
    r: readonly [number, number, number],
    combinaison: string,
  ): void {
    const entree = this.parAppui.get(repere) ?? { y: noeud.y, x, cas: [] };
    // Le solveur rend des newtons et des N·mm ; le rapport se lit en kN et kN·m.
    entree.cas.push({
      fy: (r[0] as number) / 1000,
      fz: (r[1] as number) / 1000,
      m: (r[2] as number) / 1e6,
      combinaison,
    });
    this.parAppui.set(repere, entree);
  }

  /** Enveloppes, triées par position pour que le tableau suive le bâtiment. */
  resultat(): EnveloppeAppui[] {
    const out: EnveloppeAppui[] = [];
    for (const [repere, e] of this.parAppui) {
      if (e.cas.length === 0) continue;
      const pire = (choix: (a: Reaction, b: Reaction) => Reaction): Reaction =>
        e.cas.reduce(choix);
      out.push({
        repere,
        y: e.y,
        x: e.x,
        compression: pire((a, b) => (b.fz > a.fz ? b : a)),
        soulevement: pire((a, b) => (b.fz < a.fz ? b : a)),
        horizontal: pire((a, b) => (Math.abs(b.fy) > Math.abs(a.fy) ? b : a)),
        moment: pire((a, b) => (Math.abs(b.m) > Math.abs(a.m) ? b : a)),
        cas: e.cas,
      });
    }
    return out.sort((a, b) => a.x - b.x || a.y - b.y);
  }
}

/**
 * Y a-t-il un vrai soulèvement, c'est-à-dire un cas où le pied TIRE sur sa
 * semelle ? C'est la question qui décide du volume de béton, et elle mérite
 * d'être posée explicitement plutôt que d'être lue entre les lignes d'un tableau.
 */
export function souleve(e: EnveloppeAppui): boolean {
  return e.soulevement.fz < 0;
}
