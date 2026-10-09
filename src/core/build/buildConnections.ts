import { getProfile } from '../catalog/index';
import type { Hole } from '../geometry/holes';
import type { Member } from '../geometry/member';
import type { ProjectParams } from '../model/project';
import { gorgeUsuelle, weld, type Weld } from '../geometry/weld';
import { add, cross, dot, length, scale, sub, type Vec3 } from '../math/vec3';
import { fibreAbscissa, memberFrame } from '../geometry/member';
import { epaisseurParoi } from './bolts';
import { distanceAuSegment, surLAxe } from './connections/geom';
import { contourJarret } from './jarret';
import { attachesDePannes, percerEnSymetrie } from './connections/attaches';
import { attachesDeLisses, percerPoteauxEnSymetrie } from './connections/lisses';
import { passagesDeLiernes, percerPannesPourLiernes } from './connections/liernes';
import { eclisses, goussets } from './connections/eclisses';
import { attachesDeChevetres, cordonsDAttache } from './connections/chevetres';
import { consoles, faitages, genoux, piedsDePoteaux, piedsDePotelets, tetesDePoteauxSousFerme } from './connections/platines';
import {
  attachesDeContreventement,
  fenteDuPlat,
  longueurSoudeeDuGousset,
  type AttacheCV,
} from './connections/contreventement';
import { tetesDePotelets } from './connections/potelets';
import type { Haunch, Plate } from './types';

/**
 * Génération des assemblages.
 *
 * Principe non négociable : les perçages ne sont JAMAIS saisis, ils sont
 * DÉDUITS du même modèle d'assemblage que la tôle qu'ils traversent. Une platine
 * et les trous de la pièce qu'elle vient boulonner sortent du même calcul, donc
 * elles ne peuvent pas diverger — c'est l'erreur qui coûte le plus cher en
 * atelier, et la seule façon de l'exclure est de ne pas se donner l'occasion de
 * la commettre.
 *
 * Ce module s'exécute APRÈS le reste du générateur : il lit la géométrie des
 * barres déjà construites et leur renvoie les trous à porter.
 */
export interface ConnectionResult {
  readonly plates: Plate[];
  /** Perçages à ajouter, indexés par identifiant de barre. */
  readonly holes: Map<string, Hole[]>;
  /** Cordons de soudure, avec leur gorge et leur longueur. */
  readonly welds: Weld[];
  /** Barres soudées sur une autre — échantignolle → sa traverse. */
  readonly porteurs: ReadonlyMap<string, string>;
  /** Traverse qui porte chaque jarret. */
  readonly porteursJarrets: ReadonlyMap<string, string>;
}

export function buildConnections(
  p: ProjectParams,
  members: readonly Member[],
  haunches: readonly Haunch[] = [],
  attachesCV: readonly AttacheCV[] = [],
): ConnectionResult {
  const plates: Plate[] = [];
  const holes = new Map<string, Hole[]>();
  const ajouter = (memberId: string, h: Hole[]): void => {
    const l = holes.get(memberId);
    if (l) l.push(...h);
    else holes.set(memberId, [...h]);
  };

  const parId = new Map(members.map((m) => [m.id, m]));

  piedsDePoteaux(p, members, plates);
  piedsDePotelets(p, members, plates);
  if (p.frame.enabled) {
    genoux(p, members, parId, plates, ajouter);
    consoles(p, members, plates, ajouter);
    faitages(p, members, plates);
  }
  if (p.truss.enabled) {
    goussets(p, members, plates, ajouter);
    tetesDePoteauxSousFerme(p, members, plates, ajouter);
  }
  if (p.frame.enabled && p.connections.splice.enabled) eclisses(p, members, plates, ajouter);
  attachesDePannes(p, members, ajouter);
  const porteursEquerres = attachesDeLisses(p, members, ajouter);
  attachesDeChevetres(p, members, plates, ajouter);
  passagesDeLiernes(p, members, ajouter);
  attachesDeContreventement(p, attachesCV, plates, ajouter);
  // Après les platines de faîtage et les goussets de contreventement, que la
  // tête de potelet doit trouver — et éviter.
  tetesDePotelets(p, members, plates, ajouter);
  percerEnSymetrie(members, holes);
  percerPoteauxEnSymetrie(members, holes);
  percerPannesPourLiernes(members, holes);

  const porteurs = new Map([...porteursDesAttaches(members), ...porteursEquerres]);
  const porteursJarrets = porteursDesJarrets(haunches, members);

  // Les cordons se déduisent des pièces posées et de leurs porteurs : ils ne
  // sont pas saisis séparément.
  const welds = [
    ...souduresDesToles(plates, parId),
    ...souduresDesJarrets(haunches, porteursJarrets, parId, plates),
    ...souduresDesAttaches(members, porteurs, parId),
  ];

  return { plates, holes, welds, porteurs, porteursJarrets };
}

/** Épaisseur de la paroi la plus mince d'un profil : c'est elle qui borne la gorge. */
function paroiMini(profil: ReturnType<typeof getProfile>): number {
  return Math.min(epaisseurParoi(profil, { through: 'y' }), epaisseurParoi(profil, { through: 'z' }));
}

/**
 * Cordons des tôles sur leur porteur : une platine d'about ou de pied est
 * soudée SUR LE POURTOUR du profil qu'elle termine.
 *
 * ⚠ Un brin, de la longueur du pourtour — et non un « angle double » de cette
 * longueur. Le périmètre d'un profil en I compte déjà les deux faces de l'âme
 * et des semelles : le doubler annonçait 2 × 1467 mm sur un IPE 400, et le fil,
 * le temps de soudage et le chiffrage suivaient.
 *
 * ⚠ La gorge se borne sur la paroi la plus MINCE, prise par la fonction de la
 * boulonnerie. L'ancienne cascade retombait sur h/10 pour tout ce qui n'était
 * pas un I ou un U : 6 mm pour un tube de 4.
 */
function souduresDesToles(plates: readonly Plate[], parId: ReadonlyMap<string, Member>): Weld[] {
  const out: Weld[] = [];
  for (const pl of plates) {
    const piece = pl.porteur ? parId.get(pl.porteur) : undefined;
    if (!piece) continue;
    const profil = getProfile(piece.profileId);
    if (pl.kind === 'gousset-cv' || pl.kind === 'plat-tube') {
      out.push(...souduresDeContreventement(pl, piece));
      continue;
    }
    if (pl.kind === 'gousset-tete') {
      out.push(soudureDeTete(pl, piece, plates));
      continue;
    }
    if (pl.kind === 'attache-lisse') {
      // Plat à recouvrement sur la semelle du montant : deux cordons d'angle.
      out.push(
        weld(
          `${pl.id}-SO`,
          'angle-double',
          gorgeUsuelle(paroiMini(profil), pl.thickness),
          cordonsDAttache(pl, piece).longueur,
          [piece.id, pl.id],
          pl.origin,
          `plat d’attache soudé sur ${profil.id}`,
        ),
      );
      continue;
    }
    out.push(
      weld(
        `${pl.id}-SO`,
        'angle',
        gorgeUsuelle(paroiMini(profil), pl.thickness),
        profil.perimeter,
        [piece.id, pl.id],
        pl.origin,
        `${pl.kind === 'platine-pied' ? 'platine de pied' : 'platine d’about'} soudée sur ${profil.id}`,
        { pourtour: true },
      ),
    );
  }
  return out;
}

/**
 * Cordons des attaches de contreventement.
 *
 * Le gousset est soudé par un angle double le long de son bord posé sur l'âme
 * ou la semelle. Le plat est soudé sur les DEUX lèvres de la fente, sur ses deux
 * faces : quatre cordons de la longueur engagée — deux angles doubles.
 */
function souduresDeContreventement(pl: Plate, piece: Member): Weld[] {
  const profil = getProfile(piece.profileId);
  if (pl.kind === 'gousset-cv') {
    // Gousset parallèle aux semelles : il est soudé sur l'âme ; parallèle à l'âme,
    // sur une semelle. On le lit sur la géométrie, pas sur un libellé.
    const f = memberFrame(piece);
    const normale = cross(pl.u, pl.v);
    const surAme = Math.abs(dot(normale, f.az)) > 0.9;
    const paroi = epaisseurParoi(profil, { through: surAme ? 'y' : 'z' });
    return [
      weld(
        `${pl.id}-SO`,
        'angle-double',
        gorgeUsuelle(paroi, pl.thickness),
        longueurSoudeeDuGousset(pl),
        [piece.id, pl.id],
        pl.origin,
        `gousset de contreventement soudé sur ${profil.id}`,
      ),
    ];
  }
  const fente = fenteDuPlat(piece, pl);
  return [1, 2].map((k) =>
    weld(
      `${pl.id}-SO${k}`,
      'angle-double',
      gorgeUsuelle(paroiMini(profil), pl.thickness),
      fente.longueur,
      [piece.id, pl.id],
      pl.origin,
      `plat soudé dans la fente de ${profil.id} — lèvre ${k}`,
    ),
  );
}

/**
 * Cordon du gousset de tête de potelet : angle double sur son bord haut, sous la
 * semelle de la traverse — ou sous la platine de faîtage qui le coiffe, auquel
 * cas c'est sur elle que le cordon est déposé.
 */
function soudureDeTete(pl: Plate, traverse: Member, plates: readonly Plate[]): Weld {
  const sous = plates.find(
    (x) =>
      x.kind === 'platine-about' &&
      x.porteur === traverse.id &&
      Math.abs(Math.min(...x.outline.map((q) => x.origin.z + x.u.z * q.y + x.v.z * q.z)) - pl.origin.z) < 0.5,
  );
  const profil = getProfile(traverse.profileId);
  const paroi = sous ? sous.thickness : epaisseurParoi(profil, { through: 'z' });
  return weld(
    `${pl.id}-SO`,
    'angle-double',
    gorgeUsuelle(paroi, pl.thickness),
    longueurSoudeeDuGousset(pl),
    [sous ? sous.id : traverse.id, pl.id],
    pl.origin,
    sous ? 'gousset de tête soudé sous la platine de faîtage' : `gousset de tête soudé sous ${profil.id}`,
  );
}

/**
 * Jarret : traverse et jarret se rattachent par la GÉOMÉTRIE — racine et pointe
 * sur l'axe de la traverse. Les identifiants ne le disent pas (« 0-JG » ne
 * préfixe pas « 0-TG »).
 */
function porteursDesJarrets(
  haunches: readonly Haunch[],
  members: readonly Member[],
): Map<string, string> {
  const out = new Map<string, string>();
  const traverses = members.filter((m) => m.role === 'traverse');
  for (const h of haunches) {
    const t = traverses.find((m) => surLAxe(h.root, m, 2) && surLAxe(h.tip, m, 2));
    if (t) out.set(h.id, t.id);
  }
  return out;
}

/**
 * Cordons d'un jarret : deux cordons d'angle le long de la traverse, et le
 * pourtour de sa section sur la platine contre laquelle il s'appuie.
 *
 * ⚠ Les jarrets n'avaient AUCUN cordon : près de cinquante mètres de soudure
 * absents de la gamme, de la nomenclature et du chiffrage de ce hangar.
 */
function souduresDesJarrets(
  haunches: readonly Haunch[],
  porteurs: ReadonlyMap<string, string>,
  parId: ReadonlyMap<string, Member>,
  plates: readonly Plate[],
): Weld[] {
  const out: Weld[] = [];
  for (const h of haunches) {
    const t = parId.get(porteurs.get(h.id) ?? '');
    if (!t) continue;
    const profilJ = getProfile(h.profileId);
    const profilT = getProfile(t.profileId);
    const c = contourJarret(h);
    out.push(
      weld(
        `${h.id}-SO`,
        'angle-double',
        gorgeUsuelle(paroiMini(profilJ), paroiMini(profilT)),
        length(sub(c.pointe, c.haut)),
        [t.id, h.id],
        c.haut,
        `jarret soudé sous ${profilT.id}`,
      ),
    );
    // La platine la plus proche de la racine, sur la même traverse.
    const platine = plates
      .filter((pl) => pl.porteur === t.id && pl.kind === 'platine-about')
      .map((pl) => ({ pl, d: length(sub(pl.origin, h.root)) }))
      .sort((a, b) => a.d - b.d)[0];
    if (profilJ.shape === 'I' && platine && platine.d < length(sub(c.bas, h.root)) + 2 * platine.pl.thickness + 50) {
      const ame = length(sub(c.bas, c.haut));
      out.push(
        weld(
          `${h.id}-SOP`,
          'angle',
          gorgeUsuelle(paroiMini(profilJ), platine.pl.thickness),
          // Pourtour de la section en T du jarret : âme sur ses deux faces,
          // semelle sur ses deux faces et ses chants.
          2 * ame + 2 * profilJ.b + 2 * profilJ.tf - profilJ.tw,
          [h.id, platine.pl.id],
          c.bas,
          'jarret soudé sur la platine d’about',
          { pourtour: true },
        ),
      );
    }
  }
  return out;
}

/**
 * Échantignolle → la pièce qui la porte : la traverse, la console ou la
 * membrure dont le MÉTAL est sous elle — ou la tête de poteau, pour la panne
 * sablière posée à son aplomb.
 *
 * ⚠ « Sous elle » se juge entre les COUPES de la pièce, pas sur son épure. La
 * traverse commence au point de travail, à l'axe du poteau, mais son métal ne
 * commence qu'au nu de la platine : l'échantignolle de la sablière, à l'aplomb
 * du poteau, aurait été soudée sur une traverse qui n'existe pas à cet endroit.
 */
function porteursDesAttaches(members: readonly Member[]): Map<string, string> {
  const out = new Map<string, string>();
  const porteurs = members.filter(
    (m) => m.role === 'traverse' || m.role === 'console' || m.role === 'membrure-sup',
  );
  const poteaux = members.filter((m) => m.role === 'poteau');
  for (const at of members.filter((m) => m.role === 'attache')) {
    const milieu = scale(add(at.start, at.end), 0.5);
    const portee = getProfile(at.profileId).h + 20;
    const meilleur = porteurs
      .filter((m) => dansLeMetal(m, milieu))
      .map((m) => ({ m, d: distanceAuSegment(milieu, m) - getProfile(m.profileId).h / 2 }))
      .filter((x) => x.d < portee)
      .sort((a, b) => a.d - b.d)[0];
    if (meilleur) {
      out.set(at.id, meilleur.m.id);
      continue;
    }
    // Panne sablière : l'échantignolle coiffe la tête de poteau.
    const tete = poteaux.find((po) => {
      const pr = getProfile(po.profileId);
      return (
        Math.abs(milieu.x - po.end.x) < pr.b &&
        // À l'aplomb de la section du poteau, et non simplement « près » : une
        // échantignolle de rive, en l'air au bout d'un débord, n'y est pas.
        Math.abs(milieu.y - po.end.y) < pr.h / 2 + 10 &&
        milieu.z > po.end.z &&
        milieu.z - po.end.z < 2 * pr.h + portee
      );
    });
    if (tete) out.set(at.id, tete.id);
  }
  return out;
}

/**
 * `q` tombe-t-il entre les deux coupes de `m`, sur la fibre de la section qui
 * lui fait face ?
 *
 * ⚠ Pas sur l'AXE : une traverse en pente coupée d'aplomb au faîtage s'arrête
 * plus loin en haut qu'à l'axe. L'échantignolle de la faîtière, posée sur la
 * semelle haute à trois centimètres du faîtage, en était déclarée « hors du
 * métal » — et partait en pièce volante.
 */
function dansLeMetal(m: Member, q: Vec3): boolean {
  const f = memberFrame(m);
  const d = sub(q, m.start);
  const demi = getProfile(m.profileId).h / 2;
  const fibre = { y: 0, z: Math.max(-demi, Math.min(demi, dot(d, f.az))) };
  const s0 = fibreAbscissa(f, m.start, m.cutStart, fibre);
  const s1 = fibreAbscissa(f, m.start, m.cutEnd, fibre);
  const s = dot(d, f.ax);
  return s >= Math.min(s0, s1) - 1 && s <= Math.max(s0, s1) + 1;
}

/** L'aile dressée de l'échantignolle est soudée sur la semelle haute du porteur. */
function souduresDesAttaches(
  members: readonly Member[],
  porteurs: ReadonlyMap<string, string>,
  parId: ReadonlyMap<string, Member>,
): Weld[] {
  const out: Weld[] = [];
  for (const at of members.filter((m) => m.role === 'attache' || m.role === 'equerre')) {
    const hote = parId.get(porteurs.get(at.id) ?? '');
    if (!hote) continue;
    out.push(
      weld(
        `${at.id}-SO`,
        'angle-double',
        gorgeUsuelle(paroiMini(getProfile(at.profileId)), paroiMini(getProfile(hote.profileId))),
        length(sub(at.end, at.start)),
        [hote.id, at.id],
        scale(add(at.start, at.end), 0.5),
        at.role === 'equerre'
          ? `équerre de lisse soudée dans ${getProfile(hote.profileId).id}`
          : 'échantignolle soudée sur la semelle supérieure',
      ),
    );
  }
  return out;
}
