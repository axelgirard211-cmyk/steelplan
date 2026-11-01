import type { Frame2dResult } from '../../analysis/frame2d';
import type { FrameAnalysisModel } from '../../analysis/frameModel';
import type { Combination } from '../../analysis/loadCases';
import { getProfile } from '../../catalog/index';
import { semellesDuFaitage } from '../../build/connections/platines';
import { semellesDerrierePlatine } from '../../geometry/holes';
import { leftSlopeRad } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import type { EnveloppeAppui } from '../reactions';
import { verifierPiedPoteau } from './piedPoteau';
import { verifierPlatineAbout, type EffortsAssemblage } from './platineAbout';
import type { AssemblageCheck } from './types';

/**
 * ORCHESTRATION DES VÉRIFICATIONS D'ASSEMBLAGE.
 *
 * ⚠ Les efforts sont lus AUX NŒUDS, pas au milieu des barres. C'est toute la
 * différence : le moment d'un genou est le moment à l'about de la traverse, et
 * il n'a rien à voir avec le moment maximal de la barre, qui tombe en travée.
 * Vérifier un assemblage sur le moment maximal de la pièce qu'il tient reviendrait
 * à le surdimensionner sans savoir de combien.
 */

export type { AssemblageCheck, VerifAssemblage } from './types';

/** Efforts relevés aux nœuds d'assemblage d'un portique, pour une combinaison. */
export function effortsAuxNoeuds(
  fm: FrameAnalysisModel,
  res: Frame2dResult,
  comb: Combination,
): { genou: EffortsAssemblage | null; faitage: EffortsAssemblage | null } {
  const libelle = `${comb.id} — ${comb.label}`;
  const genou = trouverNoeud(fm, 'genou');
  const faitage = trouverNoeud(fm, 'faitage');
  return {
    genou: genou === null ? null : effortsA(fm, res, genou, libelle),
    faitage: faitage === null ? null : effortsA(fm, res, faitage, libelle),
  };
}

/**
 * Nœud de genou ou de faîtage.
 *
 * Le GENOU est le nœud que partagent un poteau et une traverse — la définition
 * ne suppose rien sur la géométrie et tient donc aussi bien en monopente qu'en
 * bipente, avec ou sans débord.
 *
 * Le FAÎTAGE est le nœud le plus haut partagé par DEUX traverses. Un bâtiment
 * monopente n'en a pas, et c'est correct : il n'y a rien à y assembler.
 */
function trouverNoeud(fm: FrameAnalysisModel, quoi: 'genou' | 'faitage'): number | null {
  const roles = new Map<number, Set<string>>();
  for (const seg of fm.segments) {
    for (const n of [seg.a, seg.b]) {
      const s = roles.get(n) ?? new Set<string>();
      s.add(seg.role);
      roles.set(n, s);
    }
  }

  if (quoi === 'genou') {
    for (const [n, s] of roles) {
      if (s.has('poteau') && s.has('traverse')) return n;
    }
    return null;
  }

  // Faîtage : deux traverses distinctes s'y rejoignent.
  let meilleur: number | null = null;
  let zMax = -Infinity;
  for (const [n, s] of roles) {
    if (!s.has('traverse') || s.size !== 1) continue;
    const barres = new Set(
      fm.segments.filter((x) => x.a === n || x.b === n).map((x) => x.memberId),
    );
    if (barres.size < 2) continue;
    const z = fm.nodes[n]?.z ?? -Infinity;
    if (z > zMax) {
      zMax = z;
      meilleur = n;
    }
  }
  return meilleur;
}

/**
 * Efforts de la traverse à un nœud donné (N, N·mm).
 *
 * ⚠ On retient le tronçon LE PLUS FLÉCHI parmi ceux qui aboutissent au nœud, et
 * non le premier rencontré. Dès qu'il y a un débord de toiture, le genou est un
 * point INTÉRIEUR de la traverse : deux tronçons y arrivent, celui de la portée
 * et le petit porte-à-faux d'égout. Le porte-à-faux, presque déchargé, y présente
 * un moment quasi nul — et c'est lui que rencontrait la première boucle venue.
 * Le genou d'un portique de 20 m ressortait à 0,3 kN·m quand le faîtage, moins
 * sollicité par nature, en annonçait 128. L'assemblage le plus chargé du
 * bâtiment était vérifié sous un moment de rien du tout.
 */
function effortsA(
  fm: FrameAnalysisModel,
  res: Frame2dResult,
  noeud: number,
  combinaison: string,
): EffortsAssemblage | null {
  let meilleur: EffortsAssemblage | null = null;
  for (const [i, seg] of fm.segments.entries()) {
    if (seg.role !== 'traverse') continue;
    const cote: 'a' | 'b' | null = seg.a === noeud ? 'a' : seg.b === noeud ? 'b' : null;
    if (!cote) continue;
    const f = res.endForces[i];
    if (!f) continue;
    const e: EffortsAssemblage =
      cote === 'a'
        ? { m: f.M1, v: f.V1, n: f.N1, combinaison }
        : { m: f.M2, v: f.V2, n: f.N2, combinaison };
    if (!meilleur || Math.abs(e.m) > Math.abs(meilleur.m)) meilleur = e;
  }
  return meilleur;
}

/**
 * Toutes les vérifications d'assemblage du projet.
 *
 * ⚠ On retient, pour chaque assemblage, la combinaison qui donne le TAUX le plus
 * élevé — et non celle qui donne le moment le plus élevé. Un assemblage peut
 * être gouverné par le tranchant sous une combinaison et par le moment sous une
 * autre ; ne garder que la plus fléchie ferait disparaître le cas critique.
 */
export function verifierAssemblages(
  p: ProjectParams,
  efforts: readonly { genou: EffortsAssemblage | null; faitage: EffortsAssemblage | null }[],
  reactions: readonly EnveloppeAppui[],
): AssemblageCheck[] {
  const out = new Map<string, AssemblageCheck>();
  const retenir = (c: AssemblageCheck): void => {
    const actuel = out.get(c.id);
    if (!actuel || c.ratio > actuel.ratio) out.set(c.id, c);
  };

  const hauteurGenou = p.frame.haunch.enabled
    ? p.frame.haunch.depth
    : getProfile(p.frame.rafterProfile).h;
  const hauteurFaitage = p.frame.ridgeHaunch.enabled
    ? p.frame.ridgeHaunch.depth
    : getProfile(p.frame.rafterProfile).h;

  const traverse = getProfile(p.frame.rafterProfile);
  const semellesGenou =
    traverse.shape === 'I'
      ? semellesDerrierePlatine(traverse.h, traverse.tf, Math.cos(leftSlopeRad(p.grid)), hauteurGenou)
      : [];

  for (const e of efforts) {
    if (e.genou && p.frame.enabled) {
      retenir(
        verifierPlatineAbout(
          {
            id: 'genou',
            libelle: 'Platine d’about traverse–poteau (genou)',
            ep: p.connections.rafterToColumn,
            hauteurAssemblage: hauteurGenou,
            profilPorteur: p.frame.columnProfile,
            profilBarre: p.frame.rafterProfile,
            nuance: p.frame.grade,
            semelles: semellesGenou,
          },
          e.genou,
        ),
      );
    }
    if (e.faitage && p.frame.enabled) {
      retenir(
        verifierPlatineAbout(
          {
            id: 'faitage',
            libelle: 'Platine d’about de faîtage',
            ep: p.connections.ridge,
            hauteurAssemblage: hauteurFaitage,
            profilPorteur: p.frame.rafterProfile,
            profilBarre: p.frame.rafterProfile,
            nuance: p.frame.grade,
            semelles: semellesDuFaitage(p, hauteurFaitage),
          },
          e.faitage,
        ),
      );
    }
  }

  /*
   * Pieds de poteaux : un seul résultat, celui du pied le plus sollicité. Les
   * douze pieds d'un bâtiment ont la même platine ; sortir douze lignes
   * identiques noierait la seule qui compte.
   *
   * ⚠ Chaque pied est vérifié sous CHACUNE de ses combinaisons ultimes, avec
   * ses efforts concomitants. Retenir d'abord « le pied le plus comprimé »
   * puis lui associer le moment maximal d'une autre combinaison laissait de
   * côté le pied qui se soulève sous son moment — celui qui arrache ses tiges.
   * Les combinaisons de service (ELS) n'entrent pas : un assemblage se vérifie
   * à l'état limite ultime.
   */
  for (const a of reactions) {
    const cas = (a.cas ?? [a.compression, a.soulevement, a.horizontal, a.moment]).filter(
      (r) => !r.combinaison.startsWith('ELS'),
    );
    if (cas.length === 0) continue;
    retenir(
      verifierPiedPoteau(
        {
          id: 'pied',
          libelle: `Pied de poteau (le plus chargé : ${a.repere})`,
          cb: p.connections.columnBase,
          profilPoteau: p.frame.columnProfile,
          nuance: p.frame.grade,
        },
        ...cas,
      ),
    );
  }

  return [...out.values()].sort((a, b) => b.ratio - a.ratio);
}
