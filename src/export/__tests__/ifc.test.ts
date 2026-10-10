import { describe, expect, it } from 'vitest';
import { listerBoulons, percagesDesBarres } from '../../core/build/bolts';
import { buildProject } from '../../core/build/buildProject';
import { boltList } from '../../core/bom/boulonnerie';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import type { ProjectParams } from '../../core/model/project';
import { TEMPLATES } from '../../core/model/templates';
import { memberGeometry } from '../../render3d/meshFactory';
import { Geometrie, versLocal } from '../ifc/geometrie';
import { guidIfc, guidValide } from '../ifc/guid';
import { maquetteIfc } from '../ifc/index';
import { corpsDeBarre, corpsDeTole, repereDeBarre } from '../ifc/pieces';
import { chaine, FichierStep, reel, type Ref } from '../ifc/step';
import { lireStep, refs, type Lu, type V } from './lireStep';

/**
 * MAQUETTE IFC.
 *
 * ⚠ Aucun lecteur IFC ne tourne ici : ces contrôles RELISENT le fichier comme
 * le ferait un lecteur strict — syntaxe STEP, nombre d'attributs de chaque
 * entité selon le schéma IFC4, références, identifiants, rattachements — et
 * confrontent sa géométrie à celle de la vue 3D. Ils ne remplacent pas
 * l'ouverture du fichier dans un vrai logiciel avant une première diffusion.
 */

const QUAND = new Date('2026-10-11T08:00:00Z');
const P = DEFAULT_PROJECT;
const M = buildProject(P);
const R = maquetteIfc(P, M, { horodatage: QUAND });
const E = lireStep(R.contenu);

/** Nombre d'attributs de chaque entité employée, schéma IFC4 ADD2 TC1. */
const SCHEMA: Readonly<Record<string, number>> = {
  IFCORGANIZATION: 5,
  IFCPERSON: 8,
  IFCPERSONANDORGANIZATION: 3,
  IFCAPPLICATION: 4,
  IFCOWNERHISTORY: 8,
  IFCSIUNIT: 4,
  IFCUNITASSIGNMENT: 1,
  IFCCARTESIANPOINT: 1,
  IFCDIRECTION: 1,
  IFCAXIS2PLACEMENT3D: 3,
  IFCAXIS2PLACEMENT2D: 2,
  IFCLOCALPLACEMENT: 2,
  IFCGEOMETRICREPRESENTATIONCONTEXT: 6,
  IFCGEOMETRICREPRESENTATIONSUBCONTEXT: 10,
  IFCPROJECT: 9,
  IFCSITE: 14,
  IFCBUILDING: 12,
  IFCBUILDINGSTOREY: 10,
  IFCRELAGGREGATES: 6,
  IFCPOLYLINE: 1,
  IFCARBITRARYCLOSEDPROFILEDEF: 3,
  IFCARBITRARYPROFILEDEFWITHVOIDS: 4,
  IFCCIRCLEPROFILEDEF: 4,
  IFCRECTANGLEPROFILEDEF: 5,
  IFCEXTRUDEDAREASOLID: 4,
  IFCPLANE: 1,
  IFCHALFSPACESOLID: 2,
  IFCBOOLEANCLIPPINGRESULT: 3,
  IFCSHAPEREPRESENTATION: 4,
  IFCPRODUCTDEFINITIONSHAPE: 3,
  IFCCOLUMN: 9,
  IFCBEAM: 9,
  IFCMEMBER: 9,
  IFCPLATE: 9,
  IFCELEMENTASSEMBLY: 10,
  IFCOPENINGELEMENT: 9,
  IFCRELVOIDSELEMENT: 6,
  IFCMECHANICALFASTENER: 11,
  IFCREPRESENTATIONMAP: 2,
  IFCMAPPEDITEM: 2,
  IFCCARTESIANTRANSFORMATIONOPERATOR3D: 5,
  IFCRELCONTAINEDINSPATIALSTRUCTURE: 6,
  IFCMATERIAL: 3,
  IFCRELASSOCIATESMATERIAL: 6,
  IFCPROPERTYSINGLEVALUE: 4,
  IFCPROPERTYSET: 5,
  IFCRELDEFINESBYPROPERTIES: 6,
};

/** Entités dérivées d'IfcRoot : leur premier attribut est un GlobalId. */
const RACINES = new Set([
  'IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCRELAGGREGATES', 'IFCCOLUMN', 'IFCBEAM',
  'IFCMEMBER', 'IFCPLATE', 'IFCELEMENTASSEMBLY', 'IFCOPENINGELEMENT', 'IFCRELVOIDSELEMENT', 'IFCMECHANICALFASTENER',
  'IFCRELCONTAINEDINSPATIALSTRUCTURE', 'IFCRELASSOCIATESMATERIAL', 'IFCPROPERTYSET', 'IFCRELDEFINESBYPROPERTIES',
]);
const ELEMENTS = new Set(['IFCCOLUMN', 'IFCBEAM', 'IFCMEMBER', 'IFCPLATE', 'IFCMECHANICALFASTENER', 'IFCELEMENTASSEMBLY']);

const parType = (e: ReadonlyMap<number, Lu>, nom: string): [number, Lu][] => [...e].filter(([, x]) => x.nom === nom);
const n = (v: V | undefined): number => v as number;
const ref = (v: V | undefined): number => (v as { ref: number }).ref;

describe('format STEP', () => {
  it('écrit un fichier ISO 10303-21 au schéma IFC4', () => {
    const l = R.contenu.split('\n');
    expect(l[0]).toBe('ISO-10303-21;');
    expect(R.contenu).toContain("FILE_SCHEMA(('IFC4'));");
    expect(l.at(-2)).toBe('END-ISO-10303-21;');
    expect(E.size).toBe(R.compte.entites);
  });

  it('donne à chaque entité le nombre d’attributs du schéma', () => {
    const fautes = [...E.values()].filter((x) => SCHEMA[x.nom] !== x.attrs.length).map((x) => `${x.nom}/${x.attrs.length}`);
    expect([...new Set(fautes)]).toEqual([]);
  });

  it('ne référence que des entités existantes', () => {
    const manquantes = [...E.values()].flatMap((x) => refs(x.attrs)).filter((r) => !E.has(r));
    expect(manquantes).toEqual([]);
  });

  it('écrit les réels avec leur point et les chaînes en ASCII', () => {
    expect(reel(1)).toBe('1.');
    expect(reel(-0.0000001)).toBe('0.');
    expect(reel(12.5)).toBe('12.5');
    expect(reel(1e-5)).toBe('0.00001');
    expect(chaine('Équerre d’angle')).toBe("'\\X2\\00C9\\X0\\querre d\\X2\\2019\\X0\\angle'");
    expect(chaine("l'axe \\ ")).toBe("'l''axe \\\\ '");
    expect(/^[\x20-\x7e\n]*$/.test(R.contenu)).toBe(true);
  });
});

describe('identifiants', () => {
  const guids = [...E.values()].filter((x) => RACINES.has(x.nom)).map((x) => x.attrs[0] as string);

  it('donne un GlobalId valide et unique à chaque objet', () => {
    expect(guids.every(guidValide)).toBe(true);
    expect(new Set(guids).size).toBe(guids.length);
  });

  it('reproduit le même fichier pour le même projet', () => {
    expect(maquetteIfc(P, M, { horodatage: QUAND }).contenu).toBe(R.contenu);
  });

  it('garde l’identifiant d’une pièce quand on en modifie une autre', () => {
    /*
     * ⚠ C'est ce qui permet au logiciel de synthèse de comparer deux indices :
     * changer les pannes ne doit pas faire disparaître puis réapparaître les
     * poteaux — et leurs remarques avec eux.
     */
    const autre: ProjectParams = { ...P, secondary: { ...P.secondary, purlins: { ...P.secondary.purlins, profile: 'IPE 180' } } };
    const guidDe = (texte: string, tag: string): string | undefined =>
      [...lireStep(texte).values()].find((x) => x.nom === 'IFCCOLUMN' && x.attrs[7] === tag)?.attrs[0] as string | undefined;
    const apres = maquetteIfc(autre, buildProject(autre), { horodatage: QUAND }).contenu;
    expect(guidDe(apres, '0-PG')).toBe(guidDe(R.contenu, '0-PG'));
    expect(guidIfc('a|0-PG')).not.toBe(guidIfc('b|0-PG'));
  });
});

describe('contenu de la maquette', () => {
  it('écrit chaque pièce du modèle, sous sa classe IFC', () => {
    const roles = (r: readonly string[]): number => M.members.filter((m) => r.includes(m.role)).length;
    expect(parType(E, 'IFCCOLUMN').length).toBe(roles(['poteau', 'potelet']));
    expect(parType(E, 'IFCBEAM').length).toBe(roles(['traverse', 'console']));
    expect(parType(E, 'IFCMEMBER').length).toBe(M.members.length - roles(['poteau', 'potelet', 'traverse', 'console']) + R.compte.jarrets);
    expect(parType(E, 'IFCPLATE').length).toBe(M.plates.length);
    expect(R.compte.jarrets).toBe(M.haunches.length);
  });

  it('écrit les boulons de la nomenclature, ni plus ni moins', () => {
    const attendu = new Map(boltList(P, M).filter((l) => l.piece !== 'ecrou').map((l) => [l.designation, 0]));
    for (const l of boltList(P, M)) if (l.piece !== 'ecrou') attendu.set(l.designation, (attendu.get(l.designation) ?? 0) + l.count);
    const ecrits = new Map<string, number>();
    for (const [, x] of parType(E, 'IFCMECHANICALFASTENER')) ecrits.set(x.attrs[2] as string, (ecrits.get(x.attrs[2] as string) ?? 0) + 1);
    expect(ecrits).toEqual(attendu);
    expect(R.compte.boulons).toBe(listerBoulons(M.members, M.plates).length);
  });

  it('évide chaque perçage et chaque grugeage dans sa barre', () => {
    const attendu = percagesDesBarres(M.members).length + M.members.reduce((s, m) => s + m.notches.length, 0);
    expect(parType(E, 'IFCOPENINGELEMENT').length).toBe(attendu);
    expect(parType(E, 'IFCRELVOIDSELEMENT').length).toBe(attendu);
  });

  it('range chaque élément une fois et une seule : dans le niveau ou dans son assemblage', () => {
    const ranges = new Map<number, number>();
    const ranger = (l: V | undefined): void => {
      for (const r of refs([l ?? null])) ranges.set(r, (ranges.get(r) ?? 0) + 1);
    };
    for (const [, x] of parType(E, 'IFCRELCONTAINEDINSPATIALSTRUCTURE')) ranger(x.attrs[4]);
    for (const [, x] of parType(E, 'IFCRELAGGREGATES')) if (E.get(ref(x.attrs[4]))?.nom === 'IFCELEMENTASSEMBLY') ranger(x.attrs[5]);
    const elements = [...E].filter(([, x]) => ELEMENTS.has(x.nom));
    expect(elements.filter(([i]) => ranges.get(i) !== 1).map(([, x]) => `${x.nom} ${String(x.attrs[2])}`)).toEqual([]);
    expect(parType(E, 'IFCOPENINGELEMENT').some(([i]) => ranges.has(i))).toBe(false);
  });

  it('réunit chaque tôle soudée dans l’assemblage de sa pièce principale', () => {
    const assemblageDe = new Map<number, string>();
    for (const [, x] of parType(E, 'IFCRELAGGREGATES')) {
      const a = E.get(ref(x.attrs[4]));
      if (a?.nom === 'IFCELEMENTASSEMBLY') for (const r of refs([x.attrs[5] ?? null])) assemblageDe.set(r, a.attrs[7] as string);
    }
    const toles = new Map(parType(E, 'IFCPLATE').map(([i, x]) => [x.attrs[7] as string, i]));
    const parId = new Map(M.members.map((m) => [m.id, m]));
    for (const pl of M.plates.filter((x) => x.porteur)) {
      let chef = parId.get(pl.porteur as string);
      while (chef?.porteur && parId.has(chef.porteur)) chef = parId.get(chef.porteur);
      expect(assemblageDe.get(toles.get(pl.id) as number)).toBe(chef?.id);
    }
  });

  it('porte le repère, le profil et la nuance de chaque barre dans ses propriétés', () => {
    const repere = new Map<number, string>();
    for (const [, x] of parType(E, 'IFCRELDEFINESBYPROPERTIES')) {
      const jeu = E.get(ref(x.attrs[5]));
      if (jeu?.attrs[2] !== 'SteelPlan_Piece') continue;
      const props = refs([jeu.attrs[4] ?? null]).map((r) => E.get(r) as Lu);
      const valeur = props.find((pr) => pr.attrs[0] === 'Repère')?.attrs[2] as { v: V } | undefined;
      for (const r of refs([x.attrs[4] ?? null])) repere.set(r, valeur?.v as string);
    }
    for (const [i, x] of parType(E, 'IFCCOLUMN')) expect(repere.get(i)).toBe(x.attrs[2]);
    const nuances = new Set(parType(E, 'IFCMATERIAL').map(([, x]) => x.attrs[0]));
    expect(nuances.has(P.frame.grade)).toBe(true);
  });

  it('sort aussi les gabarits, treillis et versant unique compris', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      const e = lireStep(maquetteIfc(p, buildProject(p), { horodatage: QUAND }).contenu);
      expect([...e.values()].filter((x) => SCHEMA[x.nom] !== x.attrs.length)).toEqual([]);
      expect([...e.values()].flatMap((x) => refs(x.attrs)).every((r) => e.has(r))).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */

/** Le solide d'un corps, relu : extrusion de base et plans de recoupe. */
function relireSolide(
  e: ReadonlyMap<number, Lu>,
  r: Ref,
): { z0: number; depth: number; plans: { p: number[]; n: number[] }[]; x: [number, number]; y: [number, number] } {
  const plans: { p: number[]; n: number[] }[] = [];
  let x = e.get(r['#']) as Lu;
  while (x.nom === 'IFCBOOLEANCLIPPINGRESULT') {
    const plan = e.get(ref((e.get(ref(x.attrs[2])) as Lu).attrs[0])) as Lu;
    const pos = e.get(ref(plan.attrs[0])) as Lu;
    plans.push({ p: (e.get(ref(pos.attrs[0])) as Lu).attrs[0] as number[], n: (e.get(ref(pos.attrs[1])) as Lu).attrs[0] as number[] });
    x = e.get(ref(x.attrs[1])) as Lu;
  }
  const pos = e.get(ref(x.attrs[1])) as Lu;
  const o = (e.get(ref(pos.attrs[0])) as Lu).attrs[0] as number[];
  // Emprise du contour extérieur du profil, dans le repère de la pièce.
  const contour = e.get(ref((e.get(ref(x.attrs[0])) as Lu).attrs[2])) as Lu;
  const pts = refs([contour.attrs[0] ?? null]).map((i) => (e.get(i) as Lu).attrs[0] as number[]);
  const xs = pts.map((q) => n(q[0]));
  const ys = pts.map((q) => n(q[1]));
  return {
    z0: n(o[2]),
    depth: n(x.attrs[3]),
    plans,
    x: [Math.min(...xs), Math.max(...xs)],
    y: [Math.min(...ys), Math.max(...ys)],
  };
}

const ENTETE = { vue: '', nom: '', horodatage: '', auteur: '', organisation: '', preprocesseur: '', application: '', schema: 'IFC4' };

describe('géométrie', () => {
  it('extrude chaque barre sur la longueur exacte de la pièce 3D, abouts recoupés compris', () => {
    /*
     * Les sommets du maillage de la vue 3D, ramenés dans le repère de la barre,
     * doivent tous tenir dans l'extrusion, du bon côté de chaque plan de
     * recoupe — et la toucher : ni pièce tronquée, ni pièce trop longue.
     */
    // Le treillis porte les cornières en MIROIR : leur contour doit être retourné.
    const barres = [M, ...TEMPLATES.map((t) => buildProject(t.build()))].flatMap((x) => x.members);
    expect(barres.some((m) => m.mirrored)).toBe(true);
    for (const m of barres) {
      const f = new FichierStep();
      const c = corpsDeBarre(new Geometrie(f), m);
      const s = relireSolide(lireStep(f.ecrire(ENTETE)), c.solides[0] as Ref);
      expect(s.depth).toBeGreaterThan(0);
      const rb = repereDeBarre(m);
      const pos = memberGeometry(m, 6).getAttribute('position');
      let zMin = Infinity;
      let zMax = -Infinity;
      const xy = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      const ecarts = s.plans.map(() => -Infinity);
      for (let i = 0; i < pos.count; i++) {
        const l = versLocal(rb, { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
        zMin = Math.min(zMin, l.z);
        zMax = Math.max(zMax, l.z);
        xy.x0 = Math.min(xy.x0, l.x);
        xy.x1 = Math.max(xy.x1, l.x);
        xy.y0 = Math.min(xy.y0, l.y);
        xy.y1 = Math.max(xy.y1, l.y);
        for (const [k, pl] of s.plans.entries()) {
          const d = (l.x - n(pl.p[0])) * n(pl.n[0]) + (l.y - n(pl.p[1])) * n(pl.n[1]) + (l.z - n(pl.p[2])) * n(pl.n[2]);
          ecarts[k] = Math.max(ecarts[k] as number, d);
        }
      }
      expect(zMin, m.id).toBeGreaterThan(s.z0 - 0.05);
      expect(zMax, m.id).toBeLessThan(s.z0 + s.depth + 0.05);
      expect(Math.min(zMin - s.z0, s.z0 + s.depth - zMax), m.id).toBeLessThan(0.05);
      // Côté conservé : derrière chaque plan, et au contact.
      for (const d of ecarts) expect(Math.abs(d), m.id).toBeLessThan(0.05);
      // Même emprise de section : une cornière retournée du mauvais côté s'y voit.
      for (const [a, b] of [
        [xy.x0, s.x[0]],
        [xy.x1, s.x[1]],
        [xy.y0, s.y[0]],
        [xy.y1, s.y[1]],
      ] as const) {
        expect(Math.abs(a - b), m.id).toBeLessThan(0.05);
      }
    }
  });

  it('extrude chaque tôle sur son épaisseur, percée de tous ses trous', () => {
    for (const pl of M.plates) {
      const f = new FichierStep();
      const c = corpsDeTole(new Geometrie(f), pl);
      const e = lireStep(f.ecrire(ENTETE));
      const s = relireSolide(e, c.solides[0] as Ref);
      expect(s.depth).toBeCloseTo(pl.thickness, 6);
      expect(s.z0).toBeCloseTo(-pl.thickness / 2, 6);
      const profil = e.get(ref((e.get(c.solides[0]?.['#'] as number) as Lu).attrs[0])) as Lu;
      expect(profil.attrs.length === 4 ? (profil.attrs[3] as V[]).length : 0).toBe(pl.holes.length);
    }
  });
});
