/**
 * Registre du catalogue : convertit les tables brutes (unités catalogue papier)
 * en profils exploitables par le moteur (unités internes mm).
 *
 * C'est le SEUL endroit où a lieu la conversion cm → mm. Tout ce qui sort d'ici
 * est en mm / mm² / mm³ / mm⁴ / kg·m⁻¹.
 */
import { RHO_ACIER, UNITS } from '../math/tolerance';
import { L_EQUAL_ROWS, L_UNEQUAL_DIMS } from './angles';
import {
  C_DIMS,
  designationFroid,
  petiteAile,
  rayonPliage,
  Z_DIMS,
  type DimensionsFroid,
} from './froid';
import { chsProps, hollowCornerRadius, rect, rectSetProps, roundedRectProps } from './geom';
import { HEA_ROWS } from './hea';
import { HEB_ROWS } from './heb';
import { HEM_ROWS } from './hem';
import { IPE_ROWS } from './ipe';
import { PLAT_DIMS } from './plates';
import { CHS_DIMS, RHS_DIMS, SHS_DIMS } from './tubes';
import type {
  BoxProfile,
  ChsProfile,
  ColdProfile,
  IProfile,
  LProfile,
  PlateProfile,
  Profile,
  ProfileFamily,
  RawIRow,
  RawLRow,
  RawURow,
  RoundProfile,
  UProfile,
} from './types';
import { UPE_ROWS } from './upe';
import { UPN_ROWS } from './upn';

const { cm2ToMm2, cm3ToMm3, cm4ToMm4, cm2mm } = UNITS;

/* ------------------------------------------------------------------ */
/* Constructeurs par famille                                           */
/* ------------------------------------------------------------------ */

function buildI(row: RawIRow, family: ProfileFamily): IProfile {
  const [id, h, b, tw, tf, r, A, G, Iy, Wely, Wply, iy, Iz, Welz, Wplz, iz] = row;
  return {
    id,
    family,
    shape: 'I',
    source: 'catalogue',
    h,
    b,
    tw,
    tf,
    r,
    A: A * cm2ToMm2,
    G,
    Iy: Iy * cm4ToMm4,
    Iz: Iz * cm4ToMm4,
    Wely: Wely * cm3ToMm3,
    Welz: Welz * cm3ToMm3,
    Wply: Wply * cm3ToMm3,
    Wplz: Wplz * cm3ToMm3,
    iy: iy * cm2mm,
    iz: iz * cm2mm,
    // Contour développé : 4b + 2h − 2tw, corrigé des 4 congés d'âme.
    perimeter: 4 * b + 2 * h - 2 * tw + 4 * r * (Math.PI / 2 - 2),
  };
}

function buildU(row: RawURow, family: ProfileFamily): UProfile {
  const [id, h, b, tw, tf, r, A, G, Iy, Wely, Wply, iy, Iz, , Wplz, iz, cy] = row;
  const cyMm = cy * cm2mm;
  const IzMm = Iz * cm4ToMm4;
  return {
    id,
    family,
    shape: 'U',
    source: 'catalogue',
    h,
    b,
    tw,
    tf,
    r,
    cy: cyMm,
    A: A * cm2ToMm2,
    G,
    Iy: Iy * cm4ToMm4,
    Iz: IzMm,
    Wely: Wely * cm3ToMm3,
    // La fibre extrême selon z d'un U est le bout des ailes : Welz est
    // entièrement déterminé par Iz et cy. On le dérive plutôt que de porter une
    // troisième valeur saisie qui pourrait diverger sans être détectée ; la
    // valeur tabulée sert de contrôle croisé dans les tests.
    Welz: IzMm / (b - cyMm),
    Wply: Wply * cm3ToMm3,
    Wplz: Wplz * cm3ToMm3,
    iy: iy * cm2mm,
    iz: iz * cm2mm,
    perimeter: 2 * h + 4 * b - 2 * tw + 2 * r * (Math.PI / 2 - 2),
  };
}

/** Cornière issue des tables (ailes égales). */
function buildLFromTable(row: RawLRow): LProfile {
  const [id, a, a2, t, r, A, G, Iy, Wely, Iz, Welz, Ieta, imin, cy, cz] = row;
  // Les tables ne publient pas les modules plastiques des cornières :
  // on les calcule sur la section idéalisée (congés négligés).
  const geo = angleGeometry(a, a2, t);
  return {
    id,
    family: a === a2 ? 'L' : 'LI',
    shape: 'L',
    source: 'catalogue',
    h: a,
    b: a2,
    a,
    a2,
    t,
    r,
    A: A * cm2ToMm2,
    G,
    Iy: Iy * cm4ToMm4,
    Iz: Iz * cm4ToMm4,
    Wely: Wely * cm3ToMm3,
    Welz: Welz * cm3ToMm3,
    Wply: geo.Wply,
    Wplz: geo.Wplz,
    iy: Math.sqrt((Iy * cm4ToMm4) / (A * cm2ToMm2)),
    iz: Math.sqrt((Iz * cm4ToMm4) / (A * cm2ToMm2)),
    Ieta: Ieta * cm4ToMm4,
    imin: imin * cm2mm,
    cy: cy * cm2mm,
    cz: cz * cm2mm,
    perimeter: 2 * (a + a2),
  };
}

/** Section idéalisée d'une cornière : deux rectangles disjoints. */
function angleGeometry(a: number, a2: number, t: number) {
  return rectSetProps([rect(0, t, 0, a), rect(t, a2, 0, t)]);
}

/** Cornière calculée depuis ses dimensions (ailes inégales). */
function buildLFromDims(dims: readonly [string, number, number, number, number]): LProfile {
  const [id, a, a2, t, r] = dims;
  const p = angleGeometry(a, a2, t);
  return {
    id,
    family: a === a2 ? 'L' : 'LI',
    shape: 'L',
    source: 'geometrie',
    h: a,
    b: a2,
    a,
    a2,
    t,
    r,
    A: p.A,
    G: p.A * RHO_ACIER * 1000,
    Iy: p.Iy,
    Iz: p.Iz,
    Wely: p.Wely,
    Welz: p.Welz,
    Wply: p.Wply,
    Wplz: p.Wplz,
    iy: Math.sqrt(p.Iy / p.A),
    iz: Math.sqrt(p.Iz / p.A),
    Ieta: p.Imin,
    imin: Math.sqrt(p.Imin / p.A),
    cy: p.cy,
    cz: p.cz,
    perimeter: 2 * (a + a2),
  };
}

/** Tube circulaire — formules fermées exactes. */
function buildChs(dims: readonly [string, number, number]): ChsProfile {
  const [id, d, t] = dims;
  const p = chsProps(d, t);
  return {
    id,
    family: 'CHS',
    shape: 'CHS',
    source: 'geometrie',
    h: d,
    b: d,
    d,
    t,
    A: p.A,
    G: p.A * RHO_ACIER * 1000,
    Iy: p.I,
    Iz: p.I,
    Wely: p.Wel,
    Welz: p.Wel,
    Wply: p.Wpl,
    Wplz: p.Wpl,
    iy: Math.sqrt(p.I / p.A),
    iz: Math.sqrt(p.I / p.A),
    It: p.It,
    perimeter: p.perimeter,
  };
}

/** Tube carré ou rectangulaire — formules fermées exactes, congés inclus. */
function buildBox(id: string, h: number, b: number, t: number): BoxProfile {
  const ro = hollowCornerRadius(t);
  const ri = Math.max(0, ro - t);
  const out = roundedRectProps(b, h, ro);
  const inn = roundedRectProps(b - 2 * t, h - 2 * t, ri);

  const A = out.A - inn.A;
  const Iy = out.Iy - inn.Iy;
  const Iz = out.Iz - inn.Iz;
  return {
    id,
    family: h === b ? 'SHS' : 'RHS',
    shape: 'BOX',
    source: 'geometrie',
    h,
    b,
    t,
    ro,
    ri,
    A,
    G: A * RHO_ACIER * 1000,
    Iy,
    Iz,
    Wely: Iy / (h / 2),
    Welz: Iz / (b / 2),
    Wply: 2 * (out.Sy - inn.Sy),
    Wplz: 2 * (out.Sz - inn.Sz),
    iy: Math.sqrt(Iy / A),
    iz: Math.sqrt(Iz / A),
    perimeter: out.perimeter,
  };
}

/**
 * Barre ronde pleine de diamètre quelconque.
 * Formules exactes : A = πd²/4, I = πd⁴/64, Wpl = d³/6.
 */
export function createRound(d: number): RoundProfile {
  const A = (Math.PI * d * d) / 4;
  const I = (Math.PI * d ** 4) / 64;
  return {
    id: `Rond Ø${d}`,
    family: 'ROND',
    shape: 'ROND',
    source: 'geometrie',
    h: d,
    b: d,
    d,
    A,
    G: A * RHO_ACIER * 1000,
    Iy: I,
    Iz: I,
    Wely: (2 * I) / d,
    Welz: (2 * I) / d,
    Wply: d ** 3 / 6,
    Wplz: d ** 3 / 6,
    iy: d / 4,
    iz: d / 4,
    perimeter: Math.PI * d,
  };
}

/** Diamètres de ronds courants en charpente (mm). */
export const ROND_DIAMETERS: readonly number[] = [8, 10, 12, 14, 16, 18, 20, 22, 24, 27, 30, 36];

/**
 * Profil formé à froid à lèvres, Z ou C.
 *
 * ⚠ La section est décomposée en cinq rectangles DISJOINTS — âme, deux ailes,
 * deux lèvres — à plis vifs. C'est l'idéalisation autorisée par l'EN 1993-1-3
 * § 5.1(3) tant que le rayon reste sous 5 t et sous 0,10 bp, ce que respecte le
 * rayon de 1,5 t retenu au catalogue. Les rectangles doivent rester disjoints :
 * un recouvrement au droit d'un pli compterait la matière deux fois et gonflerait
 * l'aire — donc la masse commandée et l'inertie.
 *
 * ⚠ Pour un Z, la seconde aile part dans l'autre sens. C'est ce qui rend `Iyz`
 * non nul et incline les axes principaux : un Z n'est pas un C déformé.
 */
function buildCold(forme: 'Z' | 'C', h: number, b: number, c: number, t: number): ColdProfile {
  const b2 = forme === 'Z' ? petiteAile(b) : b;

  const rects = [
    rect(0, t, 0, h), // âme, sur toute la hauteur
    rect(t, b, 0, t), // aile inférieure, vers +y
    rect(b - t, b, t, c), // lèvre inférieure, relevée
    // Aile supérieure : vers +y pour un C, vers −y pour un Z.
    forme === 'C' ? rect(t, b2, h - t, h) : rect(t - b2, 0, h - t, h),
    forme === 'C'
      ? rect(b2 - t, b2, h - c, h - t)
      : rect(t - b2, 2 * t - b2, h - c, h - t),
  ];
  const p = rectSetProps(rects);

  /*
   * Fibres extrêmes mesurées séparément selon y et selon z : sur un Z les deux
   * ailes ne débordent pas du même côté, et prendre b/2 donnerait un module de
   * flexion faible faux d'un facteur deux.
   */
  const yMin = Math.min(...rects.map((r) => r.y0));
  const yMax = Math.max(...rects.map((r) => r.y1));
  const largeur = yMax - yMin;

  /*
   * Développé : la longueur de bande qu'il faut acheter pour plier ce profil.
   * ⚠ Mesuré sur la FIBRE MOYENNE, pas sur les cotes hors tout. Sommer les cotes
   * extérieures compterait chaque pli deux fois et surestimerait la bande.
   */
  const developpe = h - t + 2 * (b - t) + 2 * (c - t) - (forme === 'Z' ? EMBOITEMENT_DEV : 0);

  return {
    id: designationFroid(forme, h, t),
    family: forme,
    shape: forme,
    source: 'geometrie',
    h,
    b: largeur,
    aile: b,
    aile2: b2,
    c,
    t,
    cy: p.cy,
    cz: p.cz,
    r: rayonPliage(t),
    A: p.A,
    G: p.A * RHO_ACIER * 1000,
    Iy: p.Iy,
    Iz: p.Iz,
    Iyz: p.Iyz,
    Imax: p.Imax,
    Imin: p.Imin,
    Wely: p.Wely,
    Welz: p.Welz,
    Wply: p.Wply,
    Wplz: p.Wplz,
    iy: Math.sqrt(p.Iy / p.A),
    iz: Math.sqrt(p.Iz / p.A),
    perimeter: 2 * developpe,
    developpe,
  };
}

/** Ce que l'emboîtement retire au développé d'un Z : la petite aile est plus courte. */
const EMBOITEMENT_DEV = 4;

/** Tous les profils formés à froid d'une forme donnée. */
function coldFamily(forme: 'Z' | 'C', dims: readonly DimensionsFroid[]): ColdProfile[] {
  return dims.flatMap((d) => d.t.map((t) => buildCold(forme, d.h, d.b, d.c, t)));
}

/**
 * Plat / tôle de dimensions quelconques.
 * @param width largeur (mm), @param t épaisseur (mm)
 */
export function createPlate(width: number, t: number): PlateProfile {
  const A = width * t;
  const Iy = (width * t ** 3) / 12; // flexion sur le plat
  const Iz = (t * width ** 3) / 12; // flexion sur le chant
  return {
    id: `Plat ${width}x${t}`,
    family: 'PLAT',
    shape: 'RECT',
    source: 'geometrie',
    h: t,
    b: width,
    t,
    A,
    G: A * RHO_ACIER * 1000,
    Iy,
    Iz,
    Wely: Iy / (t / 2),
    Welz: Iz / (width / 2),
    Wply: (width * t * t) / 4,
    Wplz: (t * width * width) / 4,
    iy: Math.sqrt(Iy / A),
    iz: Math.sqrt(Iz / A),
    perimeter: 2 * (width + t),
  };
}

/* ------------------------------------------------------------------ */
/* Registre                                                            */
/* ------------------------------------------------------------------ */

/** Tous les profils du catalogue, dans l'ordre d'affichage. */
export const PROFILES: readonly Profile[] = [
  ...IPE_ROWS.map((r) => buildI(r, 'IPE')),
  ...HEA_ROWS.map((r) => buildI(r, 'HEA')),
  ...HEB_ROWS.map((r) => buildI(r, 'HEB')),
  ...HEM_ROWS.map((r) => buildI(r, 'HEM')),
  ...UPN_ROWS.map((r) => buildU(r, 'UPN')),
  ...UPE_ROWS.map((r) => buildU(r, 'UPE')),
  ...L_EQUAL_ROWS.map(buildLFromTable),
  ...L_UNEQUAL_DIMS.map(buildLFromDims),
  ...CHS_DIMS.map(buildChs),
  ...SHS_DIMS.map(([id, a, t]) => buildBox(id, a, a, t)),
  ...RHS_DIMS.map(([id, h, b, t]) => buildBox(id, h, b, t)),
  ...PLAT_DIMS.map(([w, t]) => createPlate(w, t)),
  ...ROND_DIAMETERS.map(createRound),
  ...coldFamily('Z', Z_DIMS),
  ...coldFamily('C', C_DIMS),
];

const BY_ID = new Map<string, Profile>(PROFILES.map((p) => [p.id, p]));

/** Recherche par identifiant ; `undefined` si inconnu. */
export function findProfile(id: string): Profile | undefined {
  return BY_ID.get(id);
}

/** Recherche par identifiant ; lève si inconnu (usage moteur). */
export function getProfile(id: string): Profile {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Profil inconnu dans le catalogue : « ${id} »`);
  return p;
}

/** Profils d'une famille donnée, dans l'ordre du catalogue. */
export function profilesByFamily(family: ProfileFamily): readonly Profile[] {
  return PROFILES.filter((p) => p.family === family);
}

/** Libellés français des familles, pour l'interface. */
export const FAMILY_LABELS: Readonly<Record<ProfileFamily, string>> = {
  IPE: 'Poutrelles IPE',
  HEA: 'Profilés HEA',
  HEB: 'Profilés HEB',
  HEM: 'Profilés HEM',
  UPN: 'U à ailes inclinées (UPN)',
  UPE: 'U à ailes parallèles (UPE)',
  L: 'Cornières à ailes égales',
  LI: 'Cornières à ailes inégales',
  CHS: 'Tubes circulaires (CHS)',
  SHS: 'Tubes carrés (SHS)',
  RHS: 'Tubes rectangulaires (RHS)',
  PLAT: 'Plats et tôles',
  ROND: 'Barres rondes',
  Z: 'Pannes Z formées à froid',
  C: 'Profils C à lèvres formés à froid',
};

export const FAMILY_ORDER: readonly ProfileFamily[] = [
  'IPE', 'HEA', 'HEB', 'HEM', 'UPN', 'UPE',
  'L', 'LI', 'CHS', 'SHS', 'RHS', 'PLAT', 'ROND',
  'Z', 'C',
];

/** Masse d'une barre (kg) : masse linéique × longueur. */
export function memberMass(profile: Profile, lengthMm: number): number {
  return (profile.G * lengthMm) / 1000;
}

/** Surface à peindre / galvaniser d'une barre (m²). */
export function memberPaintArea(profile: Profile, lengthMm: number): number {
  return (profile.perimeter * lengthMm) / 1e6;
}

export * from './types';
export { GRADES, GRADE_IDS, getGrade, fyForThickness } from './grades';
