import { chargerModele, currentFrameX, secondaryLoadKnM2 } from '../analysis/frameModel';
import { buildFrameModel, type FrameAnalysisModel, type Segment } from '../analysis/frameModel';
import {
  internalForces,
  solveFrame2d,
  type Frame2dInput,
  type Frame2dResult,
  type Node2,
} from '../analysis/frame2d';
import { combinations, intensities, type Combination } from '../analysis/loadCases';
import { modeleDeCharges } from '../climat/index';
import type { StructuralModel } from '../build/types';
import type { SteelGradeId } from '../catalog/types';
import type { MemberRole } from '../geometry/member';
import { frameStations } from '../model/grid';
import type { ProjectParams } from '../model/project';
import { longueurMaille, longueurMaintien, verifierElement } from './element';
import { kFlambementPlan } from './buckling';
import { effortsAuxNoeuds, verifierAssemblages } from './assemblages/index';
import type { EffortsAssemblage } from './assemblages/platineAbout';
import { sensibilite, type SensibiliteSecondOrdre } from '../analysis/secondOrdre';
import { EnveloppeReactions } from './reactions';
import { checkSecondary } from './secondary';
import { verifierAttachesDeContreventement } from './assemblages/contreventement';
import { releverCourses, verifierTetesDePotelets, type CoursePotelet } from './assemblages/potelets';
import { hypotheses } from './hypotheses';
import { fusionner, pire, type CheckLine, type ChecksReport } from './types';

/**
 * ORCHESTRATION DES VÉRIFICATIONS.
 *
 * Toutes les combinaisons sont calculées, et pour chacune TOUTES les
 * vérifications : on ne présume pas qu'une combinaison « gravitaire » gouverne la
 * résistance et qu'une combinaison de vent gouverne les flèches. C'est le taux le
 * plus élevé, quelle que soit sa provenance, qui est retenu et affiché avec la
 * combinaison qui l'a produit.
 */
export function runChecks(p: ProjectParams, model: StructuralModel): ChecksReport {
  const t0 = performance.now();
  /*
   * ⚠ Les charges climatiques passent par le SITE quand il est renseigné :
   * `modeleDeCharges` rend la neige et le vent déduits de la région et de
   * l'altitude, ou ceux saisis à la main si le projet est en mode manuel. Les
   * combinaisons et les intensités en sortent toutes deux — les alimenter
   * séparément permettrait de combiner une neige et d'en appliquer une autre.
   */
  const charges = modeleDeCharges(p);
  const combs = combinations(charges);
  const q = intensities(charges, secondaryLoadKnM2(p, model));

  /*
   * Portiques à vérifier, et la bande de toiture que chacun reprend.
   *
   * ⚠ Un portique COURANT reprend une travée entière — une demie de chaque côté.
   * Un portique de RIVE n'en reprend qu'une demie. Il faut donc vérifier les
   * deux : le courant est le plus chargé, celui de rive peut porter des profils
   * plus légers.
   *
   * Et il faut surtout ne pas inventer de portique courant là où il n'y en a
   * pas : un bâtiment d'UNE SEULE TRAVÉE n'a que deux files, toutes deux de
   * rive. Leur attribuer une travée entière doublait leur charge en silence, et
   * condamnait un bâtiment parfaitement correct sans que rien dans le rapport ne
   * permette de comprendre pourquoi.
   */
  const files = frameStations(p.grid);
  /*
   * Chaque portique analysé REPRÉSENTE plusieurs files réelles : le courant vaut
   * pour toutes les files intérieures, celui de rive pour les deux extrémités.
   * C'est cette correspondance qui permet de sortir une descente de charges
   * complète sans analyser vingt portiques identiques.
   */
  const aVerifier: {
    fm: FrameAnalysisModel;
    tributary: number;
    represente: readonly number[];
  }[] = [];
  const demiTravee = p.grid.baySpacing / 2;

  const xCourant = currentFrameX(p);
  const ilExisteUnPortiqueCourant = files.length > 2;
  if (ilExisteUnPortiqueCourant) {
    const courant = buildFrameModel(p, model, xCourant);
    if (courant.segments.length > 0) {
      aVerifier.push({
        fm: courant,
        tributary: p.grid.baySpacing,
        represente: files.map((_, i) => i).slice(1, -1),
      });
    }
  }

  const rive = buildFrameModel(p, model, files[0] ?? 0);
  if (rive.segments.length > 0) {
    aVerifier.push({
      fm: rive,
      tributary: demiTravee,
      represente: files.length > 1 ? [0, files.length - 1] : [0],
    });
  }

  const meilleures = new Map<string, CheckLine>();
  const retenir = (ligne: CheckLine): void => {
    const actuel = meilleures.get(ligne.mark);
    meilleures.set(ligne.mark, actuel ? fusionner(actuel, ligne) : ligne);
  };

  const reperes = new Map(model.members.map((m) => [m.id, m.mark]));
  /** Repères des pièces homologues d'une barre dans les files représentées, s'ils diffèrent du sien. */
  const homologues = (memberId: string | undefined, represente: readonly number[]): string[] => {
    const coupe = memberId?.indexOf('-') ?? -1;
    if (!memberId || coupe < 0) return [];
    const suffixe = memberId.slice(coupe + 1);
    const sien = reperes.get(memberId);
    return [
      ...new Set(
        represente.map((j) => reperes.get(`${j}-${suffixe}`)).filter((r): r is string => r !== undefined && r !== sien),
      ),
    ];
  };

  const enveloppe = new EnveloppeReactions();
  /*
   * Sensibilité au second ordre : on retient la PLUS DÉFAVORABLE de toutes les
   * combinaisons. Une ossature qui devient déplaçable sous une seule combinaison
   * l'est pour le dimensionnement — le classement ne peut pas être « rigide en
   * moyenne ».
   */
  let pireSensibilite: SensibiliteSecondOrdre | null = null;
  const courses = new Map<string, CoursePotelet>();
  const effortsAssemblages: {
    genou: EffortsAssemblage | null;
    faitage: EffortsAssemblage | null;
  }[] = [];

  for (const { fm, tributary, represente } of aVerifier) {
    const chargé = { ...fm, tributary };
    for (const comb of combs) {
      const input = chargerModele(chargé, p, q, comb);
      let res: Frame2dResult;
      try {
        res = solveFrame2d(input);
      } catch {
        // Structure non tenue pour cette combinaison : on passe plutôt que de
        // faire échouer tout le rapport. L'absence de résultat se voit.
        continue;
      }
      const sens = sensibilite(chargé, input);
      if (!pireSensibilite || sens.alphaCr < pireSensibilite.alphaCr) pireSensibilite = sens;

      for (const ligne of lignesDuPortique(p, model, chargé, input, res, comb, reperes, sens)) {
        retenir(ligne);
        /*
         * ⚠ Le portique analysé vaut pour les files qu'il REPRÉSENTE, mais leurs
         * pièces n'ont pas toujours son repère : un arbalétrier percé pour la
         * poutre au vent en prend un autre. Chacun reçoit la ligne de sa pièce
         * homologue, sans quoi il sortirait du rapport sans vérification.
         */
        for (const autre of homologues(ligne.memberId, represente)) retenir({ ...ligne, mark: autre });
      }
      releverReactions(enveloppe, chargé, res, comb, represente, files);
      // Flèche de la traverse de RIVE au droit des potelets : la course de leurs oblongs.
      if (comb.kind === 'ELS' && Math.abs(fm.x - (files[0] ?? 0)) < 1) releverCourses(model, fm, res, comb, courses);
      // ⚠ Seul le portique COURANT sert aux assemblages : il est le plus
      // sollicité, et c'est un seul détail qui part en atelier pour tous.
      if (tributary >= p.grid.baySpacing) {
        effortsAssemblages.push(effortsAuxNoeuds(chargé, res, comb));
      }
    }
  }

  const secondaire = checkSecondary(p, model, q, combs);
  for (const ligne of secondaire.lines) retenir(ligne);

  const reactions = enveloppe.resultat();
  const lines = [...meilleures.values()].sort((a, b) => b.ratio - a.ratio);
  const byMark = new Map(lines.map((l) => [l.mark, l.ratio]));

  return {
    lines,
    reactions,
    piedsPotelets: secondaire.piedsPotelets,
    assemblages: [
      ...verifierAssemblages(p, effortsAssemblages, reactions),
      ...verifierAttachesDeContreventement(p, model, secondaire.tractions),
      ...verifierTetesDePotelets(p, model, secondaire.piedsPotelets, courses),
    ].sort((a, b) => b.ratio - a.ratio),
    nonVerifiables: secondaire.exclus,
    byMark,
    combinations: combs,
    hypotheses: hypotheses(p, model, pireSensibilite),
    maxRatio: lines.reduce((m, l) => Math.max(m, l.ratio), 0),
    nonVerifies: lines.filter((l) => l.ratio > 1).length,
    ms: performance.now() - t0,
  };
}

/* ------------------------------------------------------------------ */

/**
 * Relève les réactions d'un portique analysé sur toutes les files qu'il
 * représente.
 *
 * Le repère d'appui suit la convention des plans : une LETTRE pour la position
 * dans le portique — A le pied de gauche, B celui de droite — et un NUMÉRO pour
 * la file. « B3 » se lit sans légende sur un plan d'implantation.
 */
function releverReactions(
  env: EnveloppeReactions,
  fm: FrameAnalysisModel,
  res: Frame2dResult,
  comb: Combination,
  represente: readonly number[],
  files: readonly number[],
): void {
  // Les appuis triés de gauche à droite : c'est cet ordre qui donne les lettres.
  const appuis = [...fm.supports.keys()]
    .map((i) => ({ i, n: fm.nodes[i] }))
    .filter((a): a is { i: number; n: Node2 } => a.n !== undefined)
    .sort((a, b) => a.n.y - b.n.y);

  for (const file of represente) {
    for (const [k, a] of appuis.entries()) {
      const r = res.reactions.get(a.i);
      if (!r) continue;
      const lettre = String.fromCharCode(65 + k);
      env.ajouter(`${lettre}${file + 1}`, a.n, files[file] ?? 0, r, `${comb.id} — ${comb.label}`);
    }
  }
}

/** Une ligne de vérification par barre du portique, pour une combinaison. */
function lignesDuPortique(
  p: ProjectParams,
  model: StructuralModel,
  fm: FrameAnalysisModel,
  input: Frame2dInput,
  res: Frame2dResult,
  comb: Combination,
  reperes: ReadonlyMap<string, string>,
  sens: SensibiliteSecondOrdre,
): CheckLine[] {
  // Les segments portent leur propre index : le retrouver par recherche serait
  // quadratique, et surtout fragile si deux segments devenaient égaux.
  const parBarre = new Map<string, { seg: Segment; i: number }[]>();
  for (const [i, seg] of fm.segments.entries()) {
    const l = parBarre.get(seg.memberId);
    if (l) l.push({ seg, i });
    else parBarre.set(seg.memberId, [{ seg, i }]);
  }

  const out: CheckLine[] = [];
  for (const [memberId, entrees] of parBarre) {
    const segs = entrees.map((x) => x.seg);
    let nEd = 0;
    let myEd = 0;
    let vEd = 0;
    let longueur = 0;
    for (const { seg, i } of entrees) {
      const f = res.endForces[i];
      const e = input.elements[i];
      if (!f || !e) continue;
      const eff = internalForces(e, f, seg.L);
      if (Math.abs(eff.N) > Math.abs(nEd)) nEd = eff.N;
      if (Math.abs(eff.M) > Math.abs(myEd)) myEd = eff.M;
      if (Math.abs(eff.V) > Math.abs(vEd)) vEd = eff.V;
      longueur += seg.L;
    }

    const premier = segs[0] as Segment;
    const role = premier.role;
    const k = kFlambementPlan(p.frame.baseFixity, role, sens.classe);

    /*
     * ⚠ AMPLIFICATION du second ordre appliquée à TOUS les efforts, et non aux
     * seuls effets de déplacement latéral. L'EN 1993-1-1 § 5.2.2(6)B ne demande
     * d'amplifier que la part « déplaçable » ; l'appliquer à l'ensemble est plus
     * sévère, donc acceptable, et évite de séparer deux contributions que le
     * solveur ne distingue pas. Sur une ossature rigide le facteur vaut 1 et ne
     * change rien.
     */
    const a = sens.amplification;
    const maille = fm.memberPanelLength.get(memberId) ?? longueur;
    const lcrY = longueurMaille(role, longueur, maille, k);
    const lLT = longueurMaintien(
      role,
      longueur,
      model.spacings.purlins,
      model.spacings.rails,
      maille,
    );

    // Flèches : sous combinaisons de service uniquement.
    const fl =
      comb.kind === 'ELS' ? flecheDe(p, fm, res, memberId, segs, role, longueur) : null;

    const check = verifierElement(
      premier.profileId,
      premier.grade as SteelGradeId,
      role,
      { nEd: nEd * a, myEd: myEd * a, mzEd: 0, vEd: vEd * a },
      { lcrY, lcrZ: lLT, lLT },
      fl ? (fl.valeur * a) / fl.limite : 0,
    );

    const { ratio, gouverne } = pire(check.ratios);
    const avertissements = [...check.avertissements];
    /*
     * ⚠ Diagnostic ciblé. Une ferme ne s'attache aux poteaux que par sa membrure
     * inférieure : elle ne leur apporte donc quasiment aucune raideur vis-à-vis
     * du déplacement d'ensemble, contrairement à une traverse à âme pleine
     * jarretée. Sur pieds articulés, le déplacement en tête explose. Le taux le
     * dit déjà, mais « flèche 15,12 » n'explique pas la cause : ici, elle est
     * connue, autant la nommer.
     */
    if (
      role === 'poteau' &&
      p.truss.enabled &&
      p.frame.baseFixity === 'articule' &&
      check.ratios.fleche > 1
    ) {
      avertissements.push(
        'Ferme sur poteaux à pieds ARTICULÉS : la ferme n’apporte presque aucune raideur au ' +
          'déplacement d’ensemble. Encastrer les pieds, ou contreventer le plan du portique.',
      );
    }
    out.push({
      mark: reperes.get(memberId) ?? memberId,
      memberId,
      role,
      profileId: premier.profileId,
      grade: premier.grade as SteelGradeId,
      cls: check.cls,
      combinaison: `${comb.id} — ${comb.label}`,
      nEd: (nEd * a) / 1000,
      myEd: (myEd * a) / 1e6,
      vEd: (vEd * a) / 1000,
      ratios: check.ratios,
      elancement: check.elancement,
      ratio,
      gouverne,
      fleche: fl,
      avertissements,
      lcrY,
      lcrZ: lLT,
    });
  }
  return out;
}

/**
 * Flèche d'une barre, mesurée SUR SA CORDE et non en valeur absolue.
 *
 * ⚠ Distinction essentielle : la traverse d'un portique descend en bloc parce que
 * ses appuis se déplacent, et cette translation d'ensemble n'est pas une flèche.
 * Ce que la limite L/200 vise, c'est la déformation RELATIVE à la ligne joignant
 * les deux abouts déformés. La confondre avec le déplacement absolu ferait échouer
 * des traverses parfaitement correctes.
 */
function flecheDe(
  p: ProjectParams,
  fm: FrameAnalysisModel,
  res: Frame2dResult,
  memberId: string,
  segs: readonly Segment[],
  role: MemberRole,
  longueur: number,
): { valeur: number; limite: number } | null {
  const lim = p.loads.deflection;

  if (role === 'poteau') {
    // Déplacement horizontal en tête, rapporté à la hauteur.
    const abouts = fm.memberEnds.get(memberId);
    if (!abouts) return null;
    const haut = (fm.nodes[abouts[0]] as Node2).z > (fm.nodes[abouts[1]] as Node2).z
      ? abouts[0]
      : abouts[1];
    const bas = haut === abouts[0] ? abouts[1] : abouts[0];
    const dy = Math.abs((res.d[3 * haut] ?? 0) - (res.d[3 * bas] ?? 0));
    const hauteur = Math.abs((fm.nodes[haut] as Node2).z - (fm.nodes[bas] as Node2).z);
    if (hauteur <= 0 || lim.columnDrift <= 0) return null;
    return { valeur: dy, limite: hauteur / lim.columnDrift };
  }

  const denominateur = role === 'traverse' || role === 'membrure-sup' ? lim.rafter : 0;
  if (denominateur <= 0 || segs.length < 2) return null;

  // Chaîne ordonnée des nœuds de la barre.
  const chaine = [segs[0]?.a as number, ...segs.map((s) => s.b)];
  const pos = (i: number): [number, number] => [
    (fm.nodes[i] as Node2).y + (res.d[3 * i] ?? 0),
    (fm.nodes[i] as Node2).z + (res.d[3 * i + 1] ?? 0),
  ];
  const [y0, z0] = pos(chaine[0] as number);
  const [y1, z1] = pos(chaine[chaine.length - 1] as number);
  const lc = Math.hypot(y1 - y0, z1 - z0);
  if (lc <= 0) return null;

  let max = 0;
  for (const i of chaine.slice(1, -1)) {
    const [y, z] = pos(i);
    // Distance du point à la corde : produit vectoriel divisé par la longueur.
    const d = Math.abs((y1 - y0) * (z - z0) - (z1 - z0) * (y - y0)) / lc;
    if (d > max) max = d;
  }
  return { valeur: max, limite: longueur / denominateur };
}

/* ------------------------------------------------------------------ */

export { hypotheses } from './hypotheses';
export * from './types';
export { classer, epsilon } from './section';
