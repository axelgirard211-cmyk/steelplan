import { buildProject } from '../build/buildProject';
import type { StructuralModel } from '../build/types';
import { getProfile } from '../catalog/index';
import { BOLT_DIAMETERS, type EndPlateParams } from '../model/connections';
import type { ProjectParams } from '../model/project';
import { isValid, validateProject } from '../model/validate';
import type { AssemblageCheck } from './assemblages/types';
import { runChecks } from './index';
import { candidats, postesActifs } from './postes';

/**
 * DIMENSIONNEMENT DES ASSEMBLAGES.
 *
 * ⚠ Le dimensionnement des barres rendait un bâtiment « vérifié » dont les pieds
 * de poteaux travaillaient à 3,40 : il ne regardait pas les assemblages, et
 * c'est le premier endroit où un contrôleur technique les regarde, lui.
 *
 * Même démarche qu'au plan : on lit le MODE DE RUINE qui gouverne et on agit
 * sur le réglage qui le corrige — la platine qui plie s'épaissit, la tige qui
 * casse grossit, le moment qui manque prend une rangée de boulons. Un cran à la
 * fois, revérifié, gardé seulement s'il fait baisser le taux sans en faire
 * dépasser un autre. Ce qu'aucun réglage ne corrige est NOMMÉ, avec la voie à
 * suivre : rien n'est laissé à 1,10 en silence.
 */

/** Un réglage modifié, et les assemblages qu'il a servi à faire passer. */
export interface Reglage {
  readonly reglage: string;
  readonly avant: string;
  readonly apres: string;
  readonly assemblages: readonly string[];
  readonly tauxAvant: number;
  readonly tauxApres: number;
}

export interface AssemblageInsoluble {
  readonly assemblage: string;
  readonly gouverne: string;
  readonly ratio: number;
  /** Ce qu'il reste à faire, puisque aucun réglage disponible n'y suffit. */
  readonly conseil: string;
}

export interface PropositionAssemblages {
  readonly projet: ProjectParams;
  readonly reglages: readonly Reglage[];
  readonly insolubles: readonly AssemblageInsoluble[];
  /** Taux maximal des assemblages, après réglages. */
  readonly tauxMax: number;
  readonly evaluations: number;
}

interface Levier {
  readonly nom: string;
  readonly valeur: (p: ProjectParams) => string;
  /** Le projet au cran suivant, ou `null` s'il n'y en a plus. */
  readonly suivant: (p: ProjectParams) => ProjectParams | null;
}

const audessus = (valeurs: readonly number[], v: number): number | null => valeurs.find((x) => x > v + 1e-9) ?? null;

const EP_PLATINE = [12, 15, 18, 20, 25, 30, 35, 40, 45, 50];
const EP_PIED = [15, 20, 25, 30, 35, 40, 45, 50, 60];
const EP_GOUSSET = [6, 8, 10, 12, 15, 20, 25];
const TIGES = [16, 20, 24, 27, 30];

/** Leviers d'une platine d'about : rangées, diamètre, classe, épaisseur. */
function leviersPlatine(cle: 'rafterToColumn' | 'ridge', ou: string): Record<'rangees' | 'diametre' | 'classe' | 'epaisseur', Levier> {
  const ep = (p: ProjectParams): EndPlateParams => p.connections[cle];
  const poser = (p: ProjectParams, e: EndPlateParams): ProjectParams => ({ ...p, connections: { ...p.connections, [cle]: e } });
  return {
    rangees: {
      nom: `rangées de boulons — ${ou}`,
      valeur: (p) => String(ep(p).rows),
      suivant: (p) => (ep(p).rows < 10 ? poser(p, { ...ep(p), rows: ep(p).rows + 1 }) : null),
    },
    diametre: {
      nom: `diamètre des boulons — ${ou}`,
      valeur: (p) => `M${ep(p).bolt.d}`,
      suivant: (p) => {
        const d = audessus(BOLT_DIAMETERS, ep(p).bolt.d) as EndPlateParams['bolt']['d'] | null;
        return d ? poser(p, { ...ep(p), bolt: { ...ep(p).bolt, d } }) : null;
      },
    },
    classe: {
      nom: `classe des boulons — ${ou}`,
      valeur: (p) => ep(p).bolt.cls,
      suivant: (p) => (ep(p).bolt.cls === '8.8' ? poser(p, { ...ep(p), bolt: { ...ep(p).bolt, cls: '10.9' } }) : null),
    },
    epaisseur: {
      nom: `épaisseur de platine — ${ou}`,
      valeur: (p) => `${ep(p).thickness} mm`,
      suivant: (p) => {
        const t = audessus(EP_PLATINE, ep(p).thickness);
        return t ? poser(p, { ...ep(p), thickness: t }) : null;
      },
    },
  };
}

const pied = (champ: 'thickness' | 'anchorDiameter' | 'anchorCount' | 'length' | 'width', nom: string, valeurs: (v: number) => number | null, unite: string): Levier => ({
  nom,
  valeur: (p) => `${p.connections.columnBase[champ]}${unite}`,
  suivant: (p) => {
    const v = valeurs(p.connections.columnBase[champ]);
    return v === null ? null : { ...p, connections: { ...p.connections, columnBase: { ...p.connections.columnBase, [champ]: v } } };
  },
});

const PIED = {
  epaisseur: pied('thickness', 'épaisseur de la platine de pied', (v) => audessus(EP_PIED, v), ' mm'),
  tiges: pied('anchorDiameter', 'diamètre des tiges d’ancrage', (v) => audessus(TIGES, v), ' mm'),
  nombre: pied('anchorCount', 'nombre de tiges d’ancrage', (v) => (v < 8 ? v + 2 : null), ''),
  longueur: pied('length', 'longueur de la platine de pied', (v) => (v < 1200 ? v + 50 : null), ' mm'),
  largeur: pied('width', 'largeur de la platine de pied', (v) => (v < 800 ? v + 50 : null), ' mm'),
};

const GOUSSET = {
  epaisseur: {
    nom: 'épaisseur des goussets et plats de contreventement',
    valeur: (p: ProjectParams) => `${p.connections.gusset.thickness} mm`,
    suivant: (p: ProjectParams) => {
      const t = audessus(EP_GOUSSET, p.connections.gusset.thickness);
      return t ? { ...p, connections: { ...p.connections, gusset: { ...p.connections.gusset, thickness: t } } } : null;
    },
  },
  diametre: {
    nom: 'diamètre des boulons de goussets',
    valeur: (p: ProjectParams) => `M${p.connections.gusset.bolt.d}`,
    suivant: (p: ProjectParams) => {
      const d = audessus(BOLT_DIAMETERS, p.connections.gusset.bolt.d) as EndPlateParams['bolt']['d'] | null;
      return d ? { ...p, connections: { ...p.connections, gusset: { ...p.connections.gusset, bolt: { ...p.connections.gusset.bolt, d } } } } : null;
    },
  },
  classe: {
    nom: 'classe des boulons de goussets',
    valeur: (p: ProjectParams) => p.connections.gusset.bolt.cls,
    suivant: (p: ProjectParams) =>
      p.connections.gusset.bolt.cls === '8.8'
        ? { ...p, connections: { ...p.connections, gusset: { ...p.connections.gusset, bolt: { ...p.connections.gusset.bolt, cls: '10.9' as const } } } }
        : null,
  },
} satisfies Record<string, Levier>;

const COURSE: Levier = {
  nom: 'course des oblongs de tête de potelet',
  valeur: (p) => `±${p.secondary.gablePosts.courseTete} mm`,
  suivant: (p) => {
    const c = p.secondary.gablePosts.courseTete;
    return c < 100 ? { ...p, secondary: { ...p.secondary, gablePosts: { ...p.secondary.gablePosts, courseTete: c + 10 } } } : null;
  },
};

/** Le profil du tube de contreventement d'un repère, un cran plus fort dans sa famille. */
function leviersTube(p: ProjectParams, model: StructuralModel, repere: string): Levier[] {
  const barre = model.members.find((m) => m.mark === repere);
  const poste = barre ? postesActifs(p).find((x) => x.concerne(barre)) : undefined;
  if (!poste) return [];
  return [
    {
      nom: `profil — ${poste.libelle.toLowerCase()}`,
      valeur: (q) => poste.profil(q),
      suivant: (q) => {
        const actuel = poste.profil(q);
        const famille = getProfile(actuel).family;
        const liste = candidats(poste).filter((id) => getProfile(id).family === famille);
        const suivant = liste[liste.indexOf(actuel) + 1];
        return suivant ? poste.poser(q, suivant) : null;
      },
    },
  ];
}

/** Les réglages qui corrigent le mode de ruine gouvernant, du plus économique au plus lourd. */
function leviersPour(a: AssemblageCheck, p: ProjectParams, model: StructuralModel): Levier[] {
  const g = a.gouverne;
  if (a.id === 'genou' || a.id === 'faitage') {
    const l = leviersPlatine(a.id === 'genou' ? 'rafterToColumn' : 'ridge', a.id === 'genou' ? 'genou' : 'faîtage');
    if (g.startsWith('moment')) return [l.rangees, l.diametre, l.classe, l.epaisseur];
    if (g.includes('platine d’about')) return [l.epaisseur, l.diametre];
    if (g.startsWith('cordon')) return [];
    return [l.diametre, l.classe, l.rangees];
  }
  if (a.id === 'pied') {
    if (g.startsWith('flexion')) return [PIED.epaisseur];
    if (g.startsWith('pression sur béton')) return [PIED.longueur, PIED.largeur];
    return [PIED.tiges, PIED.nombre];
  }
  if (a.id.startsWith('cv-')) {
    if (g.startsWith('section nette du tube')) return leviersTube(p, model, a.id.slice(3));
    if (g.startsWith('pression diamétrale') || g.startsWith('cordons')) return [GOUSSET.epaisseur, GOUSSET.diametre];
    return [GOUSSET.diametre, GOUSSET.classe];
  }
  if (a.id.startsWith('tete-')) return g.startsWith('course') ? [COURSE] : [];
  return [];
}

/** La voie à suivre quand aucun réglage ne suffit. */
function conseil(a: AssemblageCheck): string {
  if (a.gouverne.startsWith('cordon')) {
    return 'cordon limité par l’épaisseur de la pièce soudée : profil plus fort, ou soudure à pleine pénétration à définir';
  }
  if (a.id.startsWith('tete-')) return 'raidir la traverse de pignon ou revoir l’attache de tête';
  if (a.id === 'pied') return 'massif et ancrage à concevoir avec le bureau d’études béton';
  return 'assemblage à reprendre à la main : aucun réglage disponible ne suffit';
}

export function dimensionnerAssemblages(depart: ProjectParams, cible = 1, maxEssais = 80): PropositionAssemblages {
  let evaluations = 0;
  const evaluer = (p: ProjectParams): { model: StructuralModel; parId: Map<string, AssemblageCheck> } => {
    evaluations += 1;
    const model = buildProject(p);
    return { model, parId: new Map(runChecks(p, model).assemblages.map((a) => [a.id, a])) };
  };

  let projet = depart;
  let etat = evaluer(projet);
  const initial = etat.parId;
  const insolubles = new Map<string, AssemblageCheck>();
  const traces = new Map<string, { levier: Levier; ids: Set<string> }>();

  for (let essai = 0; essai < maxEssais; essai++) {
    const pire = [...etat.parId.values()].filter((a) => a.ratio > cible && !insolubles.has(a.id)).sort((x, y) => y.ratio - x.ratio)[0];
    if (!pire) break;
    let garde = false;
    for (const levier of leviersPour(pire, projet, etat.model)) {
      const candidat = levier.suivant(projet);
      if (!candidat || !isValid(validateProject(candidat))) continue;
      const e = evaluer(candidat);
      const apres = e.parId.get(pire.id);
      if (!apres || apres.ratio >= pire.ratio - 1e-3) continue;
      // Un réglage partagé ne doit faire dépasser aucun autre assemblage.
      const degrade = [...e.parId.values()].some(
        (a) => a.id !== pire.id && a.ratio > cible && a.ratio > (etat.parId.get(a.id)?.ratio ?? 0) + 1e-3,
      );
      if (degrade) continue;
      const t = traces.get(levier.nom) ?? { levier, ids: new Set<string>() };
      t.ids.add(pire.id);
      traces.set(levier.nom, t);
      projet = candidat;
      etat = e;
      garde = true;
      break;
    }
    if (!garde) insolubles.set(pire.id, pire);
  }

  const libelle = (id: string): string => (etat.parId.get(id) ?? initial.get(id))?.libelle ?? id;
  return {
    projet,
    reglages: [...traces.values()].map(({ levier, ids }) => ({
      reglage: levier.nom,
      avant: levier.valeur(depart),
      apres: levier.valeur(projet),
      assemblages: [...ids].map(libelle),
      tauxAvant: Math.max(...[...ids].map((id) => initial.get(id)?.ratio ?? 0)),
      tauxApres: Math.max(...[...ids].map((id) => etat.parId.get(id)?.ratio ?? 0)),
    })),
    insolubles: [...insolubles.values()].map((a) => {
      const fin = etat.parId.get(a.id) ?? a;
      return { assemblage: fin.libelle, gouverne: fin.gouverne, ratio: fin.ratio, conseil: conseil(fin) };
    }),
    tauxMax: Math.max(0, ...[...etat.parId.values()].map((a) => a.ratio)),
    evaluations,
  };
}
