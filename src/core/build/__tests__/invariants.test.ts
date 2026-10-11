import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { cutLengths, fibreAbscissa, memberFrame, sectionPointAt, type Member } from '../../geometry/member';
import { add, dot, scale, sub } from '../../math/vec3';
import { sectionOutline, type Pt2 } from '../../geometry/section';
import { holeDiameter, minEdgeDistance, minPitch } from '../../model/connections';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import { buildProject } from '../buildProject';
import { listerBoulons } from '../bolts';
import { EN_ATTENTE } from '../../geometry/holes';
import type { StructuralModel } from '../types';

/**
 * INVARIANTS DU MODÈLE.
 *
 * Ces tests ne visent aucune fonctionnalité en particulier : ils énoncent ce qui
 * doit être vrai de TOUTE pièce, dans TOUTE configuration. C'est le filet qui
 * attrape ce qu'un test ciblé laisse passer, parce qu'on ne pense pas à écrire
 * un test pour un cas qu'on n'a pas vu venir.
 */

/** Configurations parcourues : le modèle doit tenir dans toutes. */
const CONFIGURATIONS: [string, ProjectParams][] = [
  ['portique par défaut', DEFAULT_PROJECT],
  [
    'ferme treillis',
    {
      ...DEFAULT_PROJECT,
      frame: { ...DEFAULT_PROJECT.frame, enabled: false },
      truss: { ...DEFAULT_PROJECT.truss, enabled: true },
    },
  ],
  [
    'traverse éclissée',
    {
      ...DEFAULT_PROJECT,
      connections: {
        ...DEFAULT_PROJECT.connections,
        splice: { ...DEFAULT_PROJECT.connections.splice, enabled: true },
      },
    },
  ],
  [
    'monopente sans débord',
    {
      ...DEFAULT_PROJECT,
      grid: { ...DEFAULT_PROJECT.grid, roofType: 'monopente' },
      secondary: {
        ...DEFAULT_PROJECT.secondary,
        purlins: { ...DEFAULT_PROJECT.secondary.purlins, eaveOverhang: 0 },
      },
    },
  ],
  [
    /*
     * ⚠ Configuration FORMÉE À FROID, indispensable ici : ces profils sont les
     * seuls dont la semelle ne soit pas centrée sur l'âme, et les seuls dont le
     * centre de gravité ne tombe pas à mi-hauteur. Tous les invariants de
     * perçage qui supposaient une section symétrique passaient sans les voir.
     */
    'pannes et lisses formées à froid',
    {
      ...DEFAULT_PROJECT,
      secondary: {
        ...DEFAULT_PROJECT.secondary,
        purlins: { ...DEFAULT_PROJECT.secondary.purlins, profile: 'Z 200x2.0' },
        rails: { ...DEFAULT_PROJECT.secondary.rails, profile: 'C 200x2.0' },
      },
    },
  ],
];

const modeles: [string, StructuralModel, ProjectParams][] = CONFIGURATIONS.map(([nom, p]) => [
  nom,
  buildProject(p),
  p,
]);

/** Tolérance de bord : un trou de semelle est posé sur la fibre extrême. */
const TOL_BORD = 0.01;

/** Le point est-il dans le contour, bord compris ? */
function dansLeContour(q: { y: number; z: number }, contour: readonly Pt2[]): boolean {
  // Lancer de rayon : on compte les traversées d'arêtes vers la droite.
  let dedans = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i, i += 1) {
    const a = contour[i] as Pt2;
    const b = contour[j] as Pt2;
    if (distanceAuSegment2d(q, a, b) <= TOL_BORD) return true; // sur le bord
    if (a.z > q.z !== b.z > q.z) {
      const yInter = a.y + ((q.z - a.z) * (b.y - a.y)) / (b.z - a.z);
      if (yInter > q.y) dedans = !dedans;
    }
  }
  return dedans;
}

function distanceAuSegment2d(q: { y: number; z: number }, a: Pt2, b: Pt2): number {
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const l2 = dy * dy + dz * dz;
  if (l2 === 0) return Math.hypot(q.y - a.y, q.z - a.z);
  const t = Math.max(0, Math.min(1, ((q.y - a.y) * dy + (q.z - a.z) * dz) / l2));
  return Math.hypot(q.y - (a.y + t * dy), q.z - (a.z + t * dz));
}

describe('invariant — aucun perçage ne débouche dans le vide', () => {
  it('respecte partout la pince minimale de l’EN 1993-1-8 aux deux abouts', () => {
    const fautes: string[] = [];
    for (const [nom, m] of modeles) {
      for (const b of m.members) {
        if (b.holes.length === 0) continue;
        /*
         * ⚠ L'abscisse d'un perçage se compte depuis l'ABOUT D'ÉPURE, alors que
         * le métal, lui, commence à la COUPE. Sur une barre éboutée — une
         * diagonale de treillis, un contreventement — les deux ne coïncident
         * plus, et comparer l'un à l'autre revient à mesurer la pince depuis un
         * point qui n'existe pas sur la pièce.
         */
        const f = memberFrame(b);
        for (const h of b.holes) {
          /*
           * ⚠ Sur LA FIBRE DU TROU, pas sur l'axe. Une tête de poteau coupée dans
           * le plan de la couverture est plus haute sur une semelle que sur
           * l'autre : la pince d'un trou de la semelle intérieure se mesure
           * jusqu'au bord de CETTE semelle.
           */
          const s0 = fibreAbscissa(f, b.start, b.cutStart, h.at);
          const s1 = fibreAbscissa(f, b.start, b.cutEnd, h.at);
          // La pince exigible se déduit du diamètre du trou lui-même.
          const pinceMini = 1.2 * h.d;
          const marge = Math.min(h.s - s0, s1 - h.s);
          if (marge < pinceMini - 1e-6) {
            fautes.push(
              `${nom} / ${b.mark} (${b.position}) : trou à ${marge.toFixed(0)} mm de l’about, ` +
                `minimum ${pinceMini.toFixed(0)} mm pour un Ø${h.d}`,
            );
          }
        }
      }
    }
    expect([...new Set(fautes)], [...new Set(fautes)].join('\n')).toHaveLength(0);
  });

  it('perce DANS LE MÉTAL, et non dans le rectangle qui contient la section', () => {
    /*
     * ⚠ Ce test comparait auparavant le trou au RECTANGLE ENGLOBANT centré sur
     * le centre de gravité : |y| ≤ b/2 et |z| ≤ h/2. Cela ne vaut que pour une
     * section doublement symétrique. Sur une panne en Z, dont l'aile part d'un
     * seul côté de l'âme, un boulon posé symétriquement se retrouvait DANS LE
     * VIDE entre les deux ailes — et passait le test, puisqu'il restait dans le
     * rectangle.
     *
     * On teste donc l'appartenance au CONTOUR réel. Les trous des semelles sont
     * posés sur la fibre extrême, donc sur la frontière du polygone : la
     * tolérance de bord est là pour eux, pas pour rattraper une erreur.
     */
    const fautes: string[] = [];
    for (const [nom, m] of modeles) {
      for (const b of m.members) {
        const contour = sectionOutline(getProfile(b.profileId)).outer;
        for (const h of b.holes) {
          if (!dansLeContour(h.at, contour)) {
            fautes.push(
              `${nom} / ${b.mark} (${b.profileId}) : trou hors métal ` +
                `(y=${h.at.y.toFixed(1)}, z=${h.at.z.toFixed(1)})`,
            );
          }
        }
      }
    }
    expect([...new Set(fautes)], [...new Set(fautes)].join('\n')).toHaveLength(0);
  });

  it('nomme la semelle réellement percée', () => {
    // L'étiquette passe au plan de débit et à la traçabilité : « semelle-sup »
    // sur un trou percé dessous envoie le pointeur chercher le trou ailleurs.
    for (const [nom, m] of modeles) {
      for (const b of m.members) {
        for (const h of b.holes) {
          if (h.part === 'semelle-sup') expect(h.at.z, `${nom} / ${b.id} / ${h.from}`).toBeGreaterThan(0);
          if (h.part === 'semelle-inf') expect(h.at.z, `${nom} / ${b.id} / ${h.from}`).toBeLessThan(0);
        }
      }
    }
  });

  it('espace suffisamment deux perçages d’une même file', () => {
    const fautes: string[] = [];
    for (const [nom, m] of modeles) {
      for (const b of m.members) {
        // Trous alignés sur une même position de section : leurs abscisses ne
        // doivent pas se toucher.
        const files = new Map<string, number[]>();
        for (const h of b.holes) {
          const cle = `${Math.round(h.at.y)}|${Math.round(h.at.z)}|${h.d}`;
          files.set(cle, [...(files.get(cle) ?? []), h.s]);
        }
        for (const [cle, ss] of files) {
          const tri = [...ss].sort((x, y) => x - y);
          const d = Number(cle.split('|')[2]);
          for (let i = 1; i < tri.length; i++) {
            const ecart = (tri[i] as number) - (tri[i - 1] as number);
            if (ecart > 1e-6 && ecart < 2.2 * d - 1e-6) {
              fautes.push(`${nom} / ${b.mark} : entraxe de ${ecart.toFixed(0)} mm entre deux Ø${d}`);
            }
          }
        }
      }
    }
    expect([...new Set(fautes)], [...new Set(fautes)].join('\n')).toHaveLength(0);
  });
});

describe('invariant — toute tôle boulonnée porte les trous de son assemblage', () => {
  it('ne laisse aucune tôle boulonnée sans perçage', () => {
    const fautes: string[] = [];
    for (const [nom, m] of modeles) {
      for (const pl of m.plates) {
        // Une tôle soudée seulement (aucune) n'existe pas dans ce modèle : toutes
        // sont boulonnées ou reçoivent des barres boulonnées.
        if (pl.holes.length === 0) fautes.push(`${nom} / ${pl.mark} (${pl.position})`);
      }
    }
    expect([...new Set(fautes)], `Tôles sans perçage :\n${[...new Set(fautes)].join('\n')}`).toHaveLength(0);
  });

  /**
   * ⚠ L'appariement se lit dans la PROVENANCE du trou (`from`), qui nomme la
   * pièce avec laquelle il fait paire. Se fier à une proximité géométrique serait
   * faux : les trous d'échantignole d'une panne faîtière passent à quelques
   * centimètres de la platine de faîtage sans avoir le moindre rapport avec elle.
   */
  it('apparie chaque perçage de barre à la pièce que sa provenance désigne', () => {
    const fautes: string[] = [];
    for (const [nom, m] of modeles) {
      const tolesParId = new Map(m.plates.map((pl) => [pl.id, pl]));
      const barresParId = new Map(m.members.map((b) => [b.id, b]));

      for (const b of m.members) {
        for (const h of b.holes) {
          // Un trou en attente est percé pour standardiser la pièce : il ne
          // fait face à rien, par construction.
          // Trou en attente, ou passage de lierne : ni l'un ni l'autre ne fait
          // face à un trou — le second est vérifié sur l'axe de sa lierne.
          if (h.from === EN_ATTENTE || barresParId.get(h.from)?.role === 'lierne') continue;
          const tole = tolesParId.get(h.from);
          const autreBarre = barresParId.get(h.from);
          if (!tole && !autreBarre) {
            fautes.push(`${nom} / ${b.mark} : provenance « ${h.from} » ne désigne aucune pièce`);
            continue;
          }
          const diametres = tole
            ? new Set(tole.holes.map((x) => x.d))
            : new Set((autreBarre as Member).holes.map((x) => x.d));
          if (!diametres.has(h.d)) {
            fautes.push(`${nom} / ${b.mark} ↔ ${h.from} : Ø${h.d} absent de la pièce appariée`);
          }
        }
      }
    }
    expect([...new Set(fautes)], [...new Set(fautes)].join('\n')).toHaveLength(0);
  });

  it('compte autant de trous de part et d’autre d’un assemblage boulonné', () => {
    const fautes: string[] = [];
    for (const [nom, m] of modeles) {
      const tolesParId = new Map(m.plates.map((pl) => [pl.id, pl]));
      for (const b of m.members) {
        // Trous groupés par pièce appariée.
        const parPaire = new Map<string, number>();
        for (const h of b.holes) parPaire.set(h.from, (parPaire.get(h.from) ?? 0) + 1);
        for (const [id, n] of parPaire) {
          const tole = tolesParId.get(id);
          if (!tole) continue;
          // La tôle peut servir plusieurs barres (gousset, éclisse) : elle en a
          // donc au moins autant, jamais moins.
          if (tole.holes.length < n) {
            fautes.push(
              `${nom} / ${b.mark} perce ${n} trous côté ${id}, qui n’en porte que ${tole.holes.length}`,
            );
          }
        }
      }
    }
    expect([...new Set(fautes)], [...new Set(fautes)].join('\n')).toHaveLength(0);
  });

  it('garde tous les trous dans l’emprise de la tôle', () => {
    const fautes: string[] = [];
    for (const [nom, m] of modeles) {
      for (const pl of m.plates) {
        const ys = pl.outline.map((q) => q.y);
        const zs = pl.outline.map((q) => q.z);
        for (const h of pl.holes) {
          const dedans =
            h.at.y - h.d / 2 >= Math.min(...ys) - 1e-6 &&
            h.at.y + h.d / 2 <= Math.max(...ys) + 1e-6 &&
            h.at.z - h.d / 2 >= Math.min(...zs) - 1e-6 &&
            h.at.z + h.d / 2 <= Math.max(...zs) + 1e-6;
          if (!dedans) fautes.push(`${nom} / ${pl.mark} : trou débordant de la tôle`);
        }
      }
    }
    expect([...new Set(fautes)], [...new Set(fautes)].join('\n')).toHaveLength(0);
  });
});

describe('invariant — géométrie saine de toute pièce', () => {
  it('donne à chaque barre une longueur de débit positive et finie', () => {
    for (const [nom, m] of modeles) {
      for (const b of m.members) {
        const l = cutLengths(b);
        expect(Number.isFinite(l.axis), `${nom} / ${b.id}`).toBe(true);
        expect(l.axis, `${nom} / ${b.id} (${b.position})`).toBeGreaterThan(1);
        expect(l.min, `${nom} / ${b.id} fibre courte négative`).toBeGreaterThan(0);
        expect(l.max).toBeGreaterThanOrEqual(l.min);
      }
    }
  });

  it('garde un repère local orthonormé pour chaque barre', () => {
    for (const [nom, m] of modeles) {
      for (const b of m.members) {
        const f = memberFrame(b);
        const d = (u: typeof f.ax, v: typeof f.ax) => u.x * v.x + u.y * v.y + u.z * v.z;
        expect(d(f.ax, f.ax), `${nom} / ${b.id}`).toBeCloseTo(1, 9);
        expect(d(f.az, f.az), `${nom} / ${b.id}`).toBeCloseTo(1, 9);
        expect(d(f.ax, f.az), `${nom} / ${b.id}`).toBeCloseTo(0, 9);
        expect(d(f.ax, f.ay), `${nom} / ${b.id}`).toBeCloseTo(0, 9);
      }
    }
  });

  it('ne laisse aucun grugeage dépasser la pièce ni la traverser', () => {
    for (const [nom, m] of modeles) {
      for (const b of m.members) {
        const profil = getProfile(b.profileId);
        const l = cutLengths(b).axis;
        for (const n of b.notches) {
          expect(n.s0, `${nom} / ${b.id}`).toBeGreaterThanOrEqual(-1e-6);
          expect(n.s1, `${nom} / ${b.id}`).toBeLessThanOrEqual(l + 1e-6);
          expect(n.s1).toBeGreaterThan(n.s0);
          expect(n.depth, `${nom} / ${b.id} grugeage traversant`).toBeLessThan(profil.h / 2);
        }
      }
    }
  });

  it('donne une masse positive à toute pièce, grugeages déduits', () => {
    for (const [nom, m] of modeles) {
      expect(m.stats.massKg, nom).toBeGreaterThan(0);
      for (const [role, stat] of Object.entries(m.stats.byRole)) {
        expect(stat?.massKg, `${nom} / ${role}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('invariant — repérage cohérent', () => {
  it('ne donne jamais le même repère à deux pièces différentes', () => {
    for (const [nom, m] of modeles) {
      const parRepere = new Map<string, Member>();
      for (const b of m.members) {
        const ref = parRepere.get(b.mark);
        if (!ref) {
          parRepere.set(b.mark, b);
          continue;
        }
        // Deux pièces d'un même repère doivent être réellement identiques.
        expect(b.profileId, `${nom} / ${b.mark}`).toBe(ref.profileId);
        expect(b.grade, `${nom} / ${b.mark}`).toBe(ref.grade);
        expect(Math.round(cutLengths(b).axis), `${nom} / ${b.mark}`).toBe(
          Math.round(cutLengths(ref).axis),
        );
        expect(b.holes.length, `${nom} / ${b.mark} : perçages différents`).toBe(ref.holes.length);
        expect(b.notches.length, `${nom} / ${b.mark} : grugeages différents`).toBe(
          ref.notches.length,
        );
      }
    }
  });

  it('donne un repère à toute pièce et à toute tôle', () => {
    for (const [nom, m] of modeles) {
      for (const b of m.members) expect(b.mark, `${nom} / ${b.id}`).toMatch(/^[A-Z]{2}\d+$/);
      for (const pl of m.plates) expect(pl.mark, `${nom} / ${pl.id}`).toMatch(/^[A-Z]{2}\d+$/);
      for (const h of m.haunches) expect(h.mark, `${nom} / ${h.id}`).toMatch(/^JA\d+$/);
    }
  });
});

describe('invariant — comptage de la boulonnerie', () => {
  /**
   * Un boulon traverse plusieurs pièces : ni doublé, ni perdu. Formulé sans
   * aucune cote — chaque pièce a son propre repère, et une clé de position
   * recopiée d'un repère à l'autre comptait deux fois les boulons d'une
   * échantignolle dès que son repère était retourné.
   */
  it('ne compte chaque boulon qu’une fois, et n’en oublie aucun', () => {
    for (const [nom, m] of modeles) {
      const boulons = listerBoulons(m.members, m.plates);
      const liernes = new Set(m.members.filter((b) => b.role === 'lierne').map((b) => b.id));
      const trous =
        m.members.reduce((s, b) => s + b.holes.filter((h) => h.from !== EN_ATTENTE && !liernes.has(h.from)).length, 0) +
        m.plates.reduce((s, pl) => s + pl.holes.length, 0);
      // Chaque trou appartient à UN boulon : la somme des pièces serrées par
      // chaque boulon est exactement le nombre de trous du modèle, hors trous
      // en attente — percés pour standardiser une pièce, et vides.
      expect(boulons.reduce((s, b) => s + b.pieces.length, 0), `${nom} : trous`).toBe(trous);
      for (const b of boulons) {
        // Un boulon serre au moins deux pièces ; seule la tige d'ancrage n'en
        // traverse qu'une, le béton faisant la seconde.
        expect(b.pieces.length >= 2 || b.kind === 'ancrage', `${nom} : boulon dans le vide (${b.pieces})`).toBe(true);
        expect(new Set(b.pieces).size, `${nom} : pièce traversée deux fois`).toBe(b.pieces.length);
      }
      expect(m.stats.boltCount, nom).toBe(boulons.length);
      expect(m.stats.boltCount, nom).toBeGreaterThan(0);
    }
  });

  it('retrouve le décompte fait à la main sur le hangar par défaut', () => {
    /*
     * 12 pieds × 4 tiges = 48 ; 12 genoux × 6 rangées × 2 files = 144 ;
     * 12 consoles × 2 × 2 = 48 ; 6 faîtages × 4 × 2 = 48 (un jeu pour deux
     * platines) ; 75 pannes × 2 abouts × 2 boulons = 300 ;
     * lisses de long pan : 40 × 2 abouts × 2 = 160 ; lisses de pignon : par
     * pignon, 8 abouts sur équerre × 2 + 24 abouts sur potelet × 1 = 40, soit
     * 80 ; 6 pieds de potelets × 2 tiges = 12 ; 24 diagonales × 2 abouts × 2
     * boulons = 96 ; 6 têtes de potelets × 2 = 12. Total : 948.
     */
    const [, m] = modeles[0] as [string, StructuralModel, ProjectParams];
    expect(m.stats.boltCount).toBe(948);
  });

  it('compte les boulons d’échantignole, qui apparaissent des deux côtés', () => {
    const [, m] = modeles[0] as [string, StructuralModel, ProjectParams];
    const pannes = m.members.filter((b) => b.role === 'panne');
    const attaches = m.members.filter((b) => b.role === 'attache');
    expect(pannes.length).toBeGreaterThan(0);
    expect(attaches.length).toBeGreaterThan(0);

    // 4 boulons par panne, et non 0 (oubliés) ni 8 (comptés deux fois).
    const boulonsDePannes = pannes.reduce((s, b) => s + b.holes.filter((h) => h.part === 'semelle-inf').length, 0);
    expect(boulonsDePannes).toBe(pannes.length * 4);
    expect(m.stats.boltCount).toBeGreaterThan(boulonsDePannes);
  });
});

describe('invariant — boulonnerie déclarée conforme', () => {
  it('respecte les minima de l’EN 1993-1-8 dans les paramètres par défaut', () => {
    const c = DEFAULT_PROJECT.connections;
    for (const [nom, ep] of [
      ['traverse-poteau', c.rafterToColumn],
      ['faîtage', c.ridge],
    ] as const) {
      expect(ep.edgeDistance, `${nom} pince`).toBeGreaterThanOrEqual(minEdgeDistance(ep.bolt));
      expect(ep.gauge, `${nom} entraxe de files`).toBeGreaterThanOrEqual(minPitch(ep.bolt));
      expect(ep.thickness, `${nom} épaisseur`).toBeGreaterThan(0);
    }
    expect(c.gusset.edgeMargin).toBeGreaterThanOrEqual(minEdgeDistance(c.gusset.bolt));
    expect(holeDiameter(c.secondaryBolt)).toBeGreaterThan(c.secondaryBolt.d);
  });
});

describe('invariant — passages de liernes', () => {
  it('perce chaque panne là où l’axe de sa lierne traverse son âme', () => {
    /*
     * Un passage n'a pas de trou en vis-à-vis : la lierne est un rond qui s'y
     * glisse. Son invariant est donc géométrique — le centre du trou est SUR
     * l'axe de la lierne, et chaque lierne trouve un passage à chaque bout.
     */
    for (const [nom, m] of modeles) {
      const parId = new Map(m.members.map((b) => [b.id, b]));
      const vus = new Map<string, number>();
      for (const pa of m.members.filter((b) => b.role === 'panne')) {
        const f = memberFrame(pa);
        for (const h of pa.holes) {
          const ln = parId.get(h.from);
          if (!ln || ln.role !== 'lierne') continue;
          vus.set(ln.id, (vus.get(ln.id) ?? 0) + 1);
          const c = sectionPointAt(f, pa.start, h.s, h.at);
          const u = sub(ln.end, ln.start);
          const t = dot(sub(c, ln.start), u) / dot(u, u);
          const proj = add(ln.start, scale(u, t));
          expect(Math.hypot(c.x - proj.x, c.y - proj.y, c.z - proj.z), `${nom} / ${ln.position}`).toBeLessThan(0.5);
        }
      }
      for (const ln of m.members.filter((b) => b.role === 'lierne')) {
        expect(vus.get(ln.id), `${nom} / ${ln.position}`).toBe(2);
      }
    }
  });
});
