import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { cutAngleDeg, cutLengths, fibreAbscissa, memberFrame, memberMassKg, type Member } from '../../geometry/member';
import { notchedArea, notchedVolume, notch } from '../../geometry/notches';
import { designationSoudure, gorgeUsuelle, volumeDepose } from '../../geometry/weld';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { leftSlopeRad } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import { buildProject } from '../buildProject';
import { buildSheets } from '../../drawing/buildSheets';
import { sheetToSvg } from '../../../render2d/svgString';
import type { DrawEntity } from '../../drawing/scene';
import type { Plate } from '../types';

const P = DEFAULT_PROJECT;
const M = buildProject(P);
const parRole = (r: Member['role'], m = M): Member[] => m.members.filter((x) => x.role === r);

/* ================================================================== */
/* Débord de toiture (dette P3)                                        */
/* ================================================================== */

describe('débord de toiture à l’égout', () => {
  /*
   * Le débord est porté par une CONSOLE, pièce distincte boulonnée sur la
   * semelle extérieure du poteau : la traverse, elle, s'arrête sur sa platine
   * de genou côté intérieur. La prolonger au-delà du poteau, comme avant,
   * l'empêchait de s'y arrêter.
   */
  const consoles = parRole('console');
  const gauche = consoles.find((m) => m.end.y < 0) as Member;

  it('pose une console de débord à chaque genou', () => {
    // 6 files × 2 versants.
    expect(consoles).toHaveLength(12);
    expect(gauche.start.y).toBeCloseTo(0, 6); // du point de travail du genou…
  });

  it('pousse la console au-delà de la panne de rive, de la largeur de son échantignolle', () => {
    // … jusqu'à 300 mm de débord, plus les 100 mm de l'aile de l'échantignolle
    // de rive : sans eux, la moitié de la panne de rive portait dans le vide.
    const debord = P.secondary.purlins.eaveOverhang + getProfile(P.connections.purlinCleat.profile).b;
    expect(gauche.end.y).toBeCloseTo(-debord, 6);
    // Longueur d'acier : du nu de la platine (200 + 20 mm) à la rive, sur la pente.
    const a = leftSlopeRad(P.grid);
    expect(cutLengths(gauche).axis).toBeCloseTo((debord - 220) / Math.cos(a), 6);
  });

  it('scie la rive d’équerre, et l’about côté poteau d’aplomb contre sa platine', () => {
    expect(cutAngleDeg(gauche, 'end')).toBe(0);
    expect(cutAngleDeg(gauche, 'start')).toBeCloseTo((leftSlopeRad(P.grid) * 180) / Math.PI, 1);
  });

  it('ne pose aucune console quand la toiture ne déborde pas', () => {
    const sans: ProjectParams = {
      ...P,
      secondary: { ...P.secondary, purlins: { ...P.secondary.purlins, eaveOverhang: 0 } },
    };
    expect(buildProject(sans).members.some((m) => m.role === 'console')).toBe(false);
  });

  it('boulonne la console sur la semelle extérieure, la traverse sur l’intérieure', () => {
    const poteau = parRole('poteau')[0] as Member;
    const cotes = new Set(poteau.holes.map((h) => Math.sign(h.at.z)));
    expect(cotes).toEqual(new Set([1, -1]));
    expect(M.plates.some((pl) => pl.position.includes('traverse-poteau'))).toBe(true);
    expect(M.plates.some((pl) => pl.position.includes('console'))).toBe(true);
  });
});

/* ================================================================== */
/* Grugeages (dette P5)                                                */
/* ================================================================== */

describe('grugeages et becquets', () => {
  it('calcule l’aire retirée : semelle entière, puis âme au-delà', () => {
    const ipe = getProfile('IPE 240'); // b = 120, tf = 9,8, tw = 6,2
    // Jusqu'à l'épaisseur de semelle, on enlève la semelle.
    expect(notchedArea(ipe, 'sup', 9.8)).toBeCloseTo(120 * 9.8, 6);
    // Au-delà, on attaque l'âme et pas toute la largeur.
    expect(notchedArea(ipe, 'sup', 19.8)).toBeCloseTo(120 * 9.8 + 10 * 6.2, 6);
    expect(notchedArea(ipe, 'sup', 0)).toBe(0);
  });

  it('ne grugue pas ce qui ne se grugue pas', () => {
    expect(notchedArea(getProfile('CHS 114.3x5'), 'sup', 10)).toBe(0);
    expect(notchedArea(getProfile('Rond Ø16'), 'sup', 5)).toBe(0);
  });

  it('déduit le volume retiré de la masse de la pièce', () => {
    const ipe = getProfile('IPE 240');
    const n = [notch(0, 100, 9.8, 'sup', 'essai')];
    expect(notchedVolume(ipe, n)).toBeCloseTo(120 * 9.8 * 100, 6);
  });

  it('coupe la tête des potelets suivant le rampant, âme perpendiculaire au pignon', () => {
    /*
     * ⚠ L'âme est selon X : le vent de pignon fléchit le potelet sur son axe
     * fort, comme le compte la vérification. La pente court alors sur la
     * LARGEUR de la semelle, et la coupe biaise suffit : les grugeages qu'on
     * faisait n'existaient que parce que le potelet était tourné dans le mauvais
     * sens.
     */
    const potelets = parRole('potelet');
    expect(potelets.length).toBeGreaterThan(0);
    for (const po of potelets) {
      expect(Math.abs(memberFrame(po).az.x), po.position).toBeCloseTo(1, 9);
      // Sous les platines de faîtage, dont le bas est horizontal, la tête est d'équerre.
      const sousFaitage = Math.abs(po.start.y - P.grid.span / 2) < 1;
      if (sousFaitage) expect(cutAngleDeg(po, 'end'), po.position).toBe(0);
      else expect(cutAngleDeg(po, 'end'), po.position).toBeGreaterThan(0);
      expect(po.notches, po.position).toHaveLength(0);
    }
  });

  it('allège une pièce grugée : la masse tient compte de la matière retirée', () => {
    const po = parRole('potelet')[0] as Member;
    const profil = getProfile(po.profileId);
    const l = cutLengths(po).axis;
    const grugee: Member = { ...po, notches: [notch(l - 300, l, profil.shape === 'I' ? profil.tf : 10, 'sup', 'essai')] };
    expect(memberMassKg(grugee)).toBeLessThan(memberMassKg(po));
    expect(memberMassKg(grugee)).toBeGreaterThan(memberMassKg(po) * 0.9);
  });

  it('scie droit sous une ferme : un entrait est horizontal', () => {
    const treillis: ProjectParams = {
      ...P,
      frame: { ...P.frame, enabled: false },
      truss: { ...P.truss, enabled: true },
    };
    const potelets = parRole('potelet', buildProject(treillis));
    for (const po of potelets) {
      expect(cutAngleDeg(po, 'end'), po.position).toBe(0);
      expect(po.notches).toHaveLength(0);
    }
  });
});

/* ================================================================== */
/* Soudures (dette P4)                                                 */
/* ================================================================== */

describe('soudures', () => {
  it('déduit la gorge des épaisseurs assemblées, avec un minimum de 3 mm', () => {
    expect(gorgeUsuelle(10, 20)).toBe(7); // 0,7 × 10
    expect(gorgeUsuelle(30, 25)).toBe(18); // 0,7 × 25
    expect(gorgeUsuelle(2, 20)).toBe(3); // plancher d'atelier
  });

  it('soude chaque tôle d’about sur sa pièce : semelles et âme, ou pourtour', () => {
    // Les platines — d'about, de pied — terminent une pièce. Une platine de pied
    // se soude sur le pourtour du poteau ; une platine d'about de traverse sur
    // ses semelles et son âme, chacune à sa gorge. Goussets et plats de
    // contreventement ont leurs propres cordons, vérifiés à part.
    const platines = M.plates.filter((pl) => pl.porteur !== null && pl.kind.startsWith('platine'));
    const cordonsDe = (id: string) => M.welds.filter((w) => w.between[1] === id && platines.some((pl) => pl.id === id && pl.porteur === w.between[0]));
    for (const pl of platines) {
      const c = cordonsDe(pl.id);
      for (const w of c) {
        expect(w.throat).toBeGreaterThanOrEqual(3);
        expect(w.length).toBeGreaterThan(0);
      }
      if (/-PL[AFC]$/.test(pl.id)) {
        const profil = getProfile(M.members.find((m) => m.id === pl.porteur)?.profileId ?? '');
        if (profil.shape !== 'I') throw new Error(`${pl.id} : traverse en I attendue`);
        expect(c.map((w) => w.id.slice(-2)).sort(), pl.id).toEqual(['SA', 'SI', 'SS']);
        // Semelles à la gorge de la semelle, âme à celle de l'âme — jamais l'une pour l'autre.
        expect(c.find((w) => w.id.endsWith('SS'))?.throat).toBe(gorgeUsuelle(pl.thickness, profil.tf));
        expect(c.find((w) => w.id.endsWith('SA'))?.throat).toBe(gorgeUsuelle(pl.thickness, profil.tw));
      } else {
        // UN brin sur le pourtour : le périmètre compte déjà les deux faces.
        expect(c, pl.id).toHaveLength(1);
        expect(c[0]?.type).toBe('angle');
        expect(c[0]?.pourtour).toBe(true);
      }
    }
  });

  it('soude sur le périmètre développé du profil, pas sur une longueur inventée', () => {
    const pied = M.welds.find((w) => w.note.includes('pied')) as (typeof M.welds)[number];
    const poteau = parRole('poteau').find((m) => pied.between[0] === m.id) as Member;
    expect(pied.length).toBeCloseTo(getProfile(poteau.profileId).perimeter, 6);
  });

  it('désigne un cordon comme sur un plan', () => {
    const pourtour = M.welds.find((w) => w.pourtour) as (typeof M.welds)[number];
    expect(designationSoudure(pourtour)).toMatch(/^a\d+ — angle — pourtour \d+ mm$/);
    const double = M.welds.find((w) => w.type === 'angle-double') as (typeof M.welds)[number];
    expect(designationSoudure(double)).toMatch(/^a\d+ — angle double — 2 × \d+ mm$/);
  });

  it('chiffre le métal déposé et la longueur totale de cordon', () => {
    expect(M.stats.weldCount).toBe(M.welds.length);
    expect(M.stats.weldMetres).toBeGreaterThan(0);
    // Un pourtour : un brin. Un angle double : deux.
    const pourtour = M.welds.find((w) => w.pourtour) as (typeof M.welds)[number];
    expect(volumeDepose(pourtour)).toBeCloseTo(pourtour.throat ** 2 * pourtour.length, 6);
    const double = M.welds.find((w) => w.type === 'angle-double') as (typeof M.welds)[number];
    expect(volumeDepose(double)).toBeCloseTo(double.throat ** 2 * double.length * 2, 6);
  });
});

/* ================================================================== */
/* Éclisses (dette P4)                                                 */
/* ================================================================== */

/** Abscisse du joint d'éclisse sur le tronçon bas : son plan de coupe d'extrémité. */
const joint = (m: Member): number => fibreAbscissa(memberFrame(m), m.start, m.cutEnd, { y: 0, z: 0 });

describe('éclisses de traverse', () => {
  const eclisse: ProjectParams = {
    ...P,
    connections: { ...P.connections, splice: { ...P.connections.splice, enabled: true } },
  };
  const E = buildProject(eclisse);

  it('débite la traverse en deux tronçons quand l’éclissage est demandé', () => {
    // 6 files × 2 versants × 2 tronçons
    expect(E.members.filter((m) => m.role === 'traverse')).toHaveLength(24);
    expect(parRole('traverse')).toHaveLength(12); // sans éclissage
  });

  it('scie les deux tronçons d’équerre face à face au joint', () => {
    const bas = E.members.find((m) => m.id === '0-TGa') as Member;
    const haut = E.members.find((m) => m.id === '0-TGb') as Member;
    expect(cutAngleDeg(bas, 'end')).toBe(0);
    expect(cutAngleDeg(haut, 'start')).toBe(0);
    // Les deux tronçons se touchent exactement.
    expect(Math.hypot(bas.end.y - haut.start.y, bas.end.z - haut.start.z)).toBeCloseTo(0, 6);
  });

  it('conserve la longueur totale : deux tronçons valent une traverse', () => {
    const bas = E.members.find((m) => m.id === '0-TGa') as Member;
    const haut = E.members.find((m) => m.id === '0-TGb') as Member;
    const entier = parRole('traverse').find((m) => m.id === '0-TG') as Member;
    expect(cutLengths(bas).axis + cutLengths(haut).axis).toBeCloseTo(cutLengths(entier).axis, 6);
  });

  it('pose deux éclisses d’âme par joint, une par face', () => {
    const toles = E.plates.filter((pl) => pl.kind === 'eclisse');
    // 6 files × 2 versants × 2 éclisses
    expect(toles).toHaveLength(24);
    const paire = toles.filter((pl) => pl.id.startsWith('0-TGa-EC'));
    expect(paire).toHaveLength(2);
    const [a, b] = paire as [Plate, Plate];
    // Symétriques par rapport au plan de l'âme.
    expect(a.origin.x).toBeCloseTo(-b.origin.x + 2 * (a.origin.x + b.origin.x) / 2, 6);
    expect(a.thickness).toBe(P.connections.splice.thickness);
  });

  it('perce les deux tronçons à l’identique depuis leur about de joint', () => {
    const bas = E.members.find((m) => m.id === '0-TGa') as Member;
    const haut = E.members.find((m) => m.id === '0-TGb') as Member;
    // ⚠ Le joint est à l'about d'ÉPURE du tronçon bas, qui ne commence pas au
    // bout de son métal — celui-ci part du nu de la platine de genou.
    const l = joint(bas);
    // Distances au joint, comparées de part et d'autre.
    const dBas = [...new Set(bas.holes.map((h) => Math.round(l - h.s)))].sort((x, y) => x - y);
    const dHaut = [...new Set(haut.holes.map((h) => Math.round(h.s)))].sort((x, y) => x - y);
    expect(dBas).toEqual(dHaut);
    expect(dBas).toHaveLength(2); // deux files de boulons par côté
    expect(bas.holes).toHaveLength(P.connections.splice.rows * 2);
  });

  it('perce l’âme et non les semelles', () => {
    const bas = E.members.find((m) => m.id === '0-TGa') as Member;
    for (const h of bas.holes) {
      expect(h.through).toBe('y');
      expect(h.part).toBe('ame');
      expect(Math.abs(h.at.y)).toBeCloseTo(0, 6);
    }
  });

  it('fait concorder les trous des éclisses avec ceux des tronçons', () => {
    const bas = E.members.find((m) => m.id === '0-TGa') as Member;
    const tole = E.plates.find((pl) => pl.id === '0-TGa-ECa') as Plate;
    const l = joint(bas);
    const dBarre = [...new Set(bas.holes.map((h) => Math.round(l - h.s)))].sort((x, y) => x - y);
    const dTole = [...new Set(tole.holes.filter((h) => h.at.y < 0).map((h) => Math.round(-h.at.y)))].sort(
      (x, y) => x - y,
    );
    expect(dTole).toEqual(dBarre);
    // Deux fois plus de trous sur la tôle : elle sert les deux tronçons.
    expect(tole.holes).toHaveLength(bas.holes.length * 2);
  });

  it('donne un repère distinct aux tronçons éclissés', () => {
    const bas = E.members.find((m) => m.id === '0-TGa') as Member;
    const haut = E.members.find((m) => m.id === '0-TGb') as Member;
    expect(bas.mark).not.toBe(haut.mark);
  });
});

/* ================================================================== */
/* Planches de détail et symboles de soudure (dette P5)                */
/* ================================================================== */

describe('planches de détail d’assemblage', () => {
  const SHEETS = buildSheets(M, P);
  const details = SHEETS.filter((s) => s.kind === 'detail');
  const textes = (id: string): string[] => {
    const s = SHEETS.find((x) => x.id === id);
    if (!s) throw new Error(`planche ${id} absente`);
    return s.scene.entities
      .filter((e): e is Extract<DrawEntity, { kind: 'texte' }> => e.kind === 'texte')
      .map((e) => e.texte);
  };

  it('produit un détail par nœud remarquable du portique, et l’attache de palée', () => {
    expect(details.map((s) => s.id)).toEqual(['detail-genou', 'detail-faitage', 'detail-pied', 'detail-palee']);
  });

  it('montre l’attache de palée : poteau, gousset, plat et tube, en vraie grandeur', () => {
    const t = textes('detail-palee');
    expect(t.some((x) => x.startsWith('PO'))).toBe(true);
    expect(t.some((x) => x.startsWith('CV'))).toBe(true);
    expect(t).toEqual(expect.arrayContaining([expect.stringMatching(/^GC\d+$/), expect.stringMatching(/^PC\d+$/)]));
  });

  it('les dessine à une échelle de détail, plus grande que les vues d’ensemble', () => {
    const coupe = SHEETS.find((s) => s.kind === 'coupe');
    for (const d of details) {
      expect(d.echelle, d.titre).toBeLessThanOrEqual(coupe?.echelle ?? 100);
      expect([1, 2, 5, 10, 20, 50], d.titre).toContain(d.echelle);
    }
  });

  it('porte la nomenclature du nœud en tableau : pièces, tôles, boulons et soudures', () => {
    const t = textes('detail-genou');
    expect(t).toContain('NOMENCLATURE DU NŒUD');
    expect(t).toContain('PO1');
    expect(t).toContain('Poteau IPE 400');
    // La platine, ses dimensions et son perçage.
    expect(t.some((x) => / × 20 — \d+ × Ø22$/.test(x))).toBe(true);
    // La boulonnerie par désignation, avec sa classe.
    expect(t.some((x) => /^Boulon M20 × \d+ — cl\. 10\.9$/.test(x))).toBe(true);
    expect(t).toContain('Soudure');
    expect(t.some((x) => /^a\d+ — angle/.test(x))).toBe(true);
  });

  it('porte le symbole de soudure avec sa gorge, et le cercle du pourtour', () => {
    const t = textes('detail-pied');
    expect(t.some((x) => /^a\d+$/.test(x)), 'gorge absente').toBe(true);
    /*
     * ⚠ Une platine de pied est soudée sur le POURTOUR du poteau : le symbole
     * normalisé est le cercle au coude de la ligne de repère, pas une longueur.
     * « 2 × 1467 » laissait croire à deux cordons rectilignes.
     */
    const s = SHEETS.find((x) => x.id === 'detail-pied');
    expect(s?.scene.entities.some((e) => e.kind === 'cercle' && e.layer === 'cotation')).toBe(true);
    expect(t.some((x) => /^2 × \d+$/.test(x)), 'longueur de pourtour écrite à tort').toBe(false);
  });

  it('cote les perçages du nœud sur la platine en vraie grandeur, avec leur diamètre', () => {
    const t = textes('detail-genou');
    expect(t.some((x) => /VRAIE GRANDEUR$/.test(x))).toBe(true);
    expect(t.some((x) => /^\d+ × Ø\d+$/.test(x))).toBe(true);
    // Les ordonnées cumulées des rangées, depuis le bord.
    expect(t).toEqual(expect.arrayContaining(['0', '85']));
  });

  it('repère les tôles par une bulle', () => {
    const t = textes('detail-pied');
    expect(t).toContain('PP1');
  });

  it('se rend sans NaN ni entité vide', () => {
    for (const d of details) {
      const svg = sheetToSvg(d);
      expect(svg.includes('NaN'), d.titre).toBe(false);
      expect(d.scene.length, d.titre).toBeGreaterThan(40);
    }
  });

  it('ne détaille que le pied et la palée quand la toiture est portée par des fermes', () => {
    const treillis: ProjectParams = {
      ...P,
      frame: { ...P.frame, enabled: false },
      truss: { ...P.truss, enabled: true },
    };
    const s = buildSheets(buildProject(treillis), treillis).filter((x) => x.kind === 'detail');
    // Pas de genou ni de faîtage en âme pleine.
    expect(s.map((x) => x.id)).toEqual(['detail-pied', 'detail-palee']);
  });
});

describe('bulles de repère sur les plans d’ensemble', () => {
  const SHEETS = buildSheets(M, P);
  const coupe = SHEETS.filter((s) => s.kind === 'coupe')[0];

  it('nomme chaque repère de la coupe, une fois et une seule', () => {
    if (!coupe) throw new Error('coupe absente');
    const textes = coupe.scene.entities
      .filter((e): e is Extract<DrawEntity, { kind: 'texte' }> => e.kind === 'texte')
      .filter((e) => e.layer === 'reperage');
    /*
     * ⚠ L'unicité porte sur les REPÈRES, pas sur tous les textes du calque.
     * Depuis que l'étiquette porte aussi le profil, deux repères distincts —
     * une lisse et une panne en UPE 160 — écrivent légitimement le même second
     * texte. Exiger l'unicité de tout le calque reviendrait à interdire deux
     * pièces différentes du même profil, ce qui n'a aucun sens.
     */
    const reperes = textes.filter((e) => e.gras).map((e) => e.texte);
    expect(reperes.length).toBeGreaterThan(0);
    expect(new Set(reperes).size).toBe(reperes.length);
    // Le repère d'ASSEMBLAGE : poteau courant, ou variante d'angle avec ses équerres.
    expect(reperes.some((r) => /^PO1[A-Z]?$/.test(r))).toBe(true);
  });

  it('porte le PROFIL à côté du repère, et pas seulement le repère', () => {
    /*
     * C'est ce qui permet de lire la coupe sans ouvrir la nomenclature : « TR1 »
     * seul renvoie à un document qu'on n'a pas sur la nacelle.
     */
    if (!coupe) throw new Error('coupe absente');
    const textes = coupe.scene.entities
      .filter((e): e is Extract<DrawEntity, { kind: 'texte' }> => e.kind === 'texte')
      .filter((e) => e.layer === 'reperage')
      .map((e) => e.texte);
    expect(textes.some((x) => /^IPE \d+$/.test(x))).toBe(true);
  });
});

/* ================================================================== */
/* Ailes inclinées des UPN (dette P2)                                  */
/* ================================================================== */

describe('lisses en UPN : les ailes inclinées apparaissent en 2D et en 3D', () => {
  const enUPN: ProjectParams = {
    ...P,
    secondary: { ...P.secondary, rails: { ...P.secondary.rails, profile: 'UPN 160' } },
  };
  it('produit un modèle exploitable avec des UPN', () => {
    const m = buildProject(enUPN);
    const lisse = m.members.find((x) => x.role === 'lisse') as Member;
    expect(getProfile(lisse.profileId).family).toBe('UPN');
    // Le repère local reste orthonormé quelle que soit la forme de la section.
    const f = memberFrame(lisse);
    expect(f.ax.x * f.az.x + f.ax.y * f.az.y + f.ax.z * f.az.z).toBeCloseTo(0, 9);
  });

  it('cote correctement la coupe transversale malgré la nouvelle section', () => {
    const s = buildSheets(buildProject(enUPN), enUPN);
    for (const x of s) expect(sheetToSvg(x).includes('NaN'), x.titre).toBe(false);
  });
});

/* ================================================================== */
/* Cohérence d'ensemble après rattrapage                               */
/* ================================================================== */

describe('modèle complet après rattrapage', () => {
  it('reste déterministe', () => {
    const a = buildProject(P);
    const b = buildProject(P);
    expect(JSON.stringify(a.stats)).toBe(JSON.stringify(b.stats));
  });

  it('régénère un hangar de 10 travées, plans compris, sous la seconde', () => {
    const grand: ProjectParams = { ...P, grid: { ...P.grid, nBays: 10 } };
    const t0 = performance.now();
    const m = buildProject(grand);
    const sheets = buildSheets(m, grand);
    const total = performance.now() - t0;
    expect(m.members.length).toBeGreaterThan(500);
    expect(sheets.length).toBeGreaterThan(15);
    expect(total, `${total.toFixed(0)} ms`).toBeLessThan(1000);
  });

  it('tient la masse dans une fourchette plausible pour un hangar de 600 m²', () => {
    const parM2 = M.stats.massKg / 600;
    expect(parM2, `${parM2.toFixed(1)} kg/m²`).toBeGreaterThan(20);
    expect(parM2, `${parM2.toFixed(1)} kg/m²`).toBeLessThan(70);
  });
});
