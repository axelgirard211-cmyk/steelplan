import { DEFAULT_PROJECT } from './defaults';
import type { ProjectParams } from './project';

/**
 * GABARITS DE DÉPART.
 *
 * Un gabarit n'est pas un exemple : c'est un projet complet et cohérent, dont
 * les profils correspondent réellement à la portée et aux charges annoncées. Un
 * gabarit dont les profils seraient sous-dimensionnés apprendrait à
 * l'utilisateur à ignorer les taux de travail dès sa première ouverture — c'est
 * exactement le contraire de ce qu'on veut.
 *
 * Les profils retenus ci-dessous sont ceux qui sortent vérifiés du module de
 * calcul avec les charges du gabarit ; un test le contrôle à chaque exécution.
 */

export interface Template {
  readonly id: string;
  readonly nom: string;
  /** Ce que le gabarit représente, en une phrase. */
  readonly description: string;
  /** Portée × longueur, affichées pour choisir d'un coup d'œil. */
  readonly resume: string;
  readonly build: () => ProjectParams;
}

/** Recopie le projet par défaut en y appliquant des modifications imbriquées. */
function derive(patch: {
  meta?: Partial<ProjectParams['meta']>;
  grid?: Partial<ProjectParams['grid']>;
  frame?: Partial<ProjectParams['frame']>;
  truss?: Partial<ProjectParams['truss']>;
  secondary?: {
    purlins?: Partial<ProjectParams['secondary']['purlins']>;
    rails?: Partial<ProjectParams['secondary']['rails']>;
    gablePosts?: Partial<ProjectParams['secondary']['gablePosts']>;
  };
  bracing?: {
    roof?: Partial<ProjectParams['bracing']['roof']>;
    wall?: Partial<ProjectParams['bracing']['wall']>;
    gable?: Partial<ProjectParams['bracing']['gable']>;
  };
  loads?: { loads?: Partial<ProjectParams['loads']['loads']> };
}): ProjectParams {
  const d = DEFAULT_PROJECT;
  return {
    ...d,
    // La date est celle du jour où le gabarit est ouvert, pas celle du code.
    meta: { ...d.meta, ...patch.meta, date: new Date().toISOString().slice(0, 10) },
    grid: { ...d.grid, ...patch.grid },
    frame: { ...d.frame, ...patch.frame },
    truss: { ...d.truss, ...patch.truss },
    secondary: {
      ...d.secondary,
      purlins: { ...d.secondary.purlins, ...patch.secondary?.purlins },
      rails: { ...d.secondary.rails, ...patch.secondary?.rails },
      gablePosts: { ...d.secondary.gablePosts, ...patch.secondary?.gablePosts },
    },
    bracing: {
      ...d.bracing,
      roof: { ...d.bracing.roof, ...patch.bracing?.roof },
      wall: { ...d.bracing.wall, ...patch.bracing?.wall },
      gable: { ...d.bracing.gable, ...patch.bracing?.gable },
    },
    loads: { ...d.loads, loads: { ...d.loads.loads, ...patch.loads?.loads } },
    freeMembers: [],
  };
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'vierge',
    nom: 'Projet vierge',
    description:
      'Hangar courant de 20 m de portée sur 5 travées. Le point de départ neutre, sans hypothèse de programme.',
    resume: '20 × 30 m — égout 6 m',
    build: () => ({ ...DEFAULT_PROJECT, meta: { ...DEFAULT_PROJECT.meta, date: aujourdHui() } }),
  },

  {
    id: 'hangar-agricole',
    nom: 'Hangar agricole',
    description:
      'Bâtiment de stockage à pieds articulés, faible pente, sans lisses de bardage sur les long pans laissés ouverts. Neige de plaine.',
    resume: '15 × 36 m — égout 5 m',
    build: () =>
      derive({
        meta: { nom: 'Hangar agricole' },
        grid: { nBays: 6, baySpacing: 6000, span: 15000, eaveHeight: 5000, slope: 10, slopeRight: 10 },
        frame: {
          columnProfile: 'IPE 360',
          rafterProfile: 'IPE 300',
          baseFixity: 'articule',
          haunch: { enabled: true, length: 1200, depth: 550 },
        },
        secondary: {
          purlins: { profile: 'IPE 140', spacing: 1700 },
          // Long pans ouverts : pas de lisses, mais le pignon reste bardé.
          rails: { enabled: false },
        },
        loads: { loads: { permanent: 0.15, neige: 0.45, ventPression: 0.5, ventDepression: 0.8 } },
      }),
  },

  {
    id: 'batiment-industriel',
    nom: 'Bâtiment industriel',
    description:
      'Grande portée à pieds encastrés et jarrets longs, pour reprendre le moment d’un portique de 25 m. Charges d’équipements suspendus incluses.',
    resume: '25 × 48 m — égout 8 m',
    build: () =>
      derive({
        meta: { nom: 'Bâtiment industriel' },
        grid: { nBays: 8, baySpacing: 6000, span: 25000, eaveHeight: 8000, slope: 8, slopeRight: 8 },
        frame: {
          columnProfile: 'HEA 500',
          rafterProfile: 'IPE 500',
          baseFixity: 'encastre',
          haunch: { enabled: true, length: 2500, depth: 950 },
          ridgeHaunch: { enabled: true, length: 1200, depth: 650 },
        },
        secondary: {
          purlins: { profile: 'IPE 180', spacing: 1900 },
          rails: { profile: 'UPE 180', spacing: 1600 },
          gablePosts: { profile: 'IPE 330', count: 4 },
        },
        bracing: {
          roof: { profile: 'CHS 88.9x4' },
          wall: { profile: 'CHS 88.9x4' },
          gable: { profile: 'CHS 88.9x4' },
        },
        // Équipements suspendus : ponts, gaines, éclairage.
        loads: { loads: { permanent: 0.4, exploitation: 0.4, neige: 0.55 } },
      }),
  },

  {
    id: 'ferme-treillis',
    nom: 'Ferme treillis',
    description:
      'Portée franchie par une ferme Warren en cornières doubles, sur poteaux encastrés en pied. Solution légère quand la hauteur libre sous entrait le permet.',
    resume: '18 × 36 m — égout 6 m',
    build: () =>
      derive({
        meta: { nom: 'Bâtiment sur fermes treillis' },
        grid: { nBays: 6, baySpacing: 6000, span: 18000, eaveHeight: 6000, slope: 15, slopeRight: 15 },
        // Le treillis remplace la traverse : le portique à âme pleine s'efface,
        // mais les poteaux subsistent — ils sont construits dans tous les cas.
        //
        // ⚠ Pieds ENCASTRÉS. Sous une ferme, un pied articulé ne tient pas le
        // déplacement en tête : la ferme ne s'attache aux poteaux que par sa
        // membrure inférieure, et n'y apporte donc presque aucune raideur de
        // sway. C'est l'encastrement qui reprend le vent de long pan.
        frame: { enabled: false, columnProfile: 'HEA 300', baseFixity: 'encastre' },
        truss: {
          enabled: true,
          type: 'warren',
          // 10 panneaux plutôt que 8 : la maille passe de 2,28 à 1,82 m et la
          // flexion locale de la membrure supérieure, qui la dimensionne, décroît
          // comme le carré de cette longueur.
          nPanels: 10,
          // ⚠ Montants à chaque nœud. Une ferme Warren sans montants n'a de nœuds
          // en membrure supérieure qu'un panneau sur deux : celle-ci fléchit alors
          // sur le double de la maille, et c'est cette flexion locale — non
          // l'effort normal — qui dimensionne la cornière.
          warrenWithPosts: true,
          heightAtSupport: 1400,
          heightAtRidge: 2600,
          topChordProfile: 'L 120x120x12',
          bottomChordProfile: 'L 100x100x10',
          diagonalProfile: 'L 100x100x10',
          postProfile: 'L 70x70x7',
          doubleAngles: true,
        },
        secondary: { purlins: { profile: 'IPE 160', spacing: 1850 } },
      }),
  },

  {
    id: 'auvent-monopente',
    nom: 'Auvent monopente',
    description:
      'Appentis d’une seule pente, adossable, bardé sur un seul long pan. Le vent de soulèvement y gouverne le dimensionnement.',
    resume: '8 × 24 m — égout 4 m',
    build: () =>
      derive({
        meta: { nom: 'Auvent monopente' },
        grid: {
          nBays: 4,
          baySpacing: 6000,
          span: 8000,
          eaveHeight: 4000,
          roofType: 'monopente',
          slope: 12,
          slopeRight: 12,
        },
        frame: {
          columnProfile: 'IPE 270',
          rafterProfile: 'IPE 240',
          baseFixity: 'encastre',
          haunch: { enabled: false, length: 800, depth: 400 },
        },
        secondary: {
          purlins: { profile: 'IPE 160', spacing: 1300, sagBars: { enabled: true, rows: 1, diameter: 16 } },
          rails: { profile: 'UPE 160', spacing: 1300, onGables: false },
          gablePosts: { enabled: false, profile: 'IPE 200', mode: 'nombre', spacing: 4000, count: 1 },
        },
        // Toiture légère très sensible au soulèvement.
        loads: { loads: { permanent: 0.12, neige: 0.45, ventPression: 0.7, ventDepression: 1.1 } },
      }),
  },
];

function aujourdHui(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
