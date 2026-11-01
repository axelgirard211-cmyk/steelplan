import type { Ajout, EntiteDessin, RetouchesDePlanche } from '../drawing/retouches';
import { LAYER_STYLES, type Layer, type Pt } from '../drawing/scene';
import { FormatError } from './migrate';

/**
 * RELECTURE DES RETOUCHES — à la frontière du système.
 *
 * ⚠ Une retouche est une entité de dessin venue d'un fichier : un nombre
 * manquant y devient un NaN, et un NaN dans un tracé SVG ou PDF fait disparaître
 * la planche entière à l'impression. Chaque champ est donc contrôlé, et un
 * fichier corrompu est refusé avec l'endroit fautif plutôt qu'à moitié dessiné.
 */

type Brut = Record<string, unknown>;

const echec = (path: string, attendu: string, recu: unknown): FormatError =>
  new FormatError(`Format incorrect pour le champ « ${path} » : ${attendu} était attendu, reçu ${JSON.stringify(recu)}.`);

function objet(v: unknown, path: string): Brut {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw echec(path, 'un objet', v);
  return v as Brut;
}

function liste(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw echec(path, 'une liste', v);
  return v;
}

function nombre(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw echec(path, 'un nombre', v);
  return v;
}

/**
 * Nombre BORNÉ : un pas de hachure de 10⁻⁹ mm ou un cercle d'un million de
 * kilomètres sont des nombres finis, et chacun figeait le rendu de la planche.
 */
function borne(v: unknown, path: string, min: number, max: number): number {
  const x = nombre(v, path);
  if (x < min || x > max) throw echec(path, `un nombre entre ${min} et ${max}`, v);
  return x;
}

function texte(v: unknown, path: string): string {
  if (typeof v !== 'string') throw echec(path, 'un texte', v);
  return v;
}

function booleen(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw echec(path, 'un booléen', v);
  return v;
}

function point(v: unknown, path: string): Pt {
  const o = objet(v, path);
  return { x: nombre(o['x'], `${path}.x`), y: nombre(o['y'], `${path}.y`) };
}

const points = (v: unknown, path: string): Pt[] => liste(v, path).map((p, i) => point(p, `${path}[${i}]`));

function calque(v: unknown, path: string): Layer {
  if (typeof v !== 'string' || !Object.hasOwn(LAYER_STYLES, v)) throw echec(path, 'un calque connu', v);
  return v as Layer;
}

function parmi<T extends string>(v: unknown, permis: readonly T[], path: string): T {
  if (typeof v !== 'string' || !permis.includes(v as T)) throw echec(path, permis.join(' | '), v);
  return v as T;
}

function entite(v: unknown, path: string): EntiteDessin {
  const o = objet(v, path);
  const layer = (): Layer => calque(o['layer'], `${path}.layer`);
  const n = (k: string): number => nombre(o[k], `${path}.${k}`);
  const p = (k: string): Pt => point(o[k], `${path}.${k}`);
  switch (o['kind']) {
    case 'ligne':
      return { kind: 'ligne', a: p('a'), b: p('b'), layer: layer() };
    case 'polyligne':
      return { kind: 'polyligne', points: points(o['points'], `${path}.points`), fermee: booleen(o['fermee'], `${path}.fermee`), layer: layer() };
    case 'cercle':
      return { kind: 'cercle', c: p('c'), r: borne(o['r'], `${path}.r`, 1e-6, 1e6), layer: layer() };
    case 'arc':
      return { kind: 'arc', c: p('c'), r: borne(o['r'], `${path}.r`, 1e-6, 1e6), a0: n('a0'), a1: n('a1'), layer: layer() };
    case 'texte':
      return {
        kind: 'texte',
        at: p('at'),
        texte: texte(o['texte'], `${path}.texte`),
        hauteur: borne(o['hauteur'], `${path}.hauteur`, 0.1, 500),
        ancrage: parmi(o['ancrage'], ['gauche', 'centre', 'droite'] as const, `${path}.ancrage`),
        ligneDeBase: parmi(o['ligneDeBase'], ['bas', 'milieu', 'haut'] as const, `${path}.ligneDeBase`),
        rotation: n('rotation'),
        gras: booleen(o['gras'], `${path}.gras`),
        layer: layer(),
      };
    case 'hachure':
      return {
        kind: 'hachure',
        contour: points(o['contour'], `${path}.contour`),
        trous: liste(o['trous'], `${path}.trous`).map((t, i) => points(t, `${path}.trous[${i}]`)),
        pas: borne(o['pas'], `${path}.pas`, 0.1, 1e4),
        angle: n('angle'),
        layer: 'hachure',
      };
    case 'remplissage':
      return {
        kind: 'remplissage',
        contour: points(o['contour'], `${path}.contour`),
        trous: liste(o['trous'], `${path}.trous`).map((t, i) => points(t, `${path}.trous[${i}]`)),
        gris: n('gris'),
        layer: layer(),
      };
    case 'cote':
      return { kind: 'cote', a: p('a'), b: p('b'), decalage: n('decalage'), texte: texte(o['texte'], `${path}.texte`), layer: 'cotation' };
    default:
      throw echec(`${path}.kind`, 'une nature d’entité connue', o['kind']);
  }
}

function ajout(v: unknown, path: string): Ajout {
  const o = objet(v, path);
  return {
    id: texte(o['id'], `${path}.id`),
    entite: entite(o['entite'], `${path}.entite`),
    origine: o['origine'] === undefined ? '' : texte(o['origine'], `${path}.origine`),
  };
}

export function lireRetouches(raw: unknown, path: string): RetouchesDePlanche[] {
  return liste(raw, path).map((v, i) => {
    const p = `${path}[${i}]`;
    const o = objet(v, p);
    return {
      planche: texte(o['planche'], `${p}.planche`),
      ajouts: liste(o['ajouts'] ?? [], `${p}.ajouts`).map((a, j) => ajout(a, `${p}.ajouts[${j}]`)),
      masques: liste(o['masques'] ?? [], `${p}.masques`).map((m, j) => texte(m, `${p}.masques[${j}]`)),
    };
  });
}
