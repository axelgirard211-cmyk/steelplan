import { useEffect, useMemo, useState } from 'react';
import {
  FAMILY_LABELS,
  FAMILY_ORDER,
  GRADE_IDS,
  PROFILES,
  type ProfileFamily,
} from '../core/catalog/index';
import type { SteelGradeId } from '../core/catalog/types';

/**
 * CHAMPS DE SAISIE PARTAGÉS.
 *
 * ⚠ Une seule définition par type de champ. Un sélecteur de profil recopié dans
 * six fiches, c'est six comportements qui divergent : l'un groupe par famille et
 * l'autre pas, l'un accepte la molette et modifie la portée du bâtiment pendant
 * qu'on fait défiler la page. Ces composants sont volontairement nus — pas de
 * style, pas de libellé — pour que chaque fiche décide de sa présentation.
 */

/**
 * Étiquette accessible, tirée du libellé que la fiche affiche à côté du champ.
 *
 * ⚠ Nus, les champs n'avaient pas de nom : un lecteur d'écran annonçait « 5 »
 * là où l'écran lit « Travées ». Chaque champ prend le texte du <dt> qui le
 * précède et, pour une sous-ligne (« — profil »), celui de sa rubrique :
 * « Poutre au vent — profil ». Un champ déjà dans un <label> garde le sien.
 */
export function libeller(el: HTMLElement | null): void {
  if (!el || el.closest('label')) return;
  const dt = el.closest('dd')?.previousElementSibling;
  if (!dt || dt.tagName !== 'DT') return;
  const texte = (dt.textContent ?? '').trim();
  let libelle = texte.replace(/^—\s*/, '');
  if (texte.startsWith('—')) {
    let r = dt.previousElementSibling;
    while (r && !(r.tagName === 'DT' && !(r.textContent ?? '').trim().startsWith('—'))) r = r.previousElementSibling;
    if (r) libelle = `${(r.textContent ?? '').trim()} — ${libelle}`;
  }
  if (libelle) el.setAttribute('aria-label', libelle);
}

/** Même étiquette, précisée : deux champs dans une même ligne (« M 20 × 10.9 »). */
export const libellerAvec =
  (precision: string) =>
  (el: HTMLElement | null): void => {
    libeller(el);
    if (el) el.setAttribute('aria-label', `${el.getAttribute('aria-label') ?? ''} — ${precision}`.replace(/^ — /, ''));
  };

export function ChampNombre({
  valeur,
  onChange,
  pas = 1,
  min,
  max,
  unite,
  largeur = 82,
}: {
  valeur: number;
  onChange: (v: number) => void;
  pas?: number;
  min?: number;
  max?: number;
  unite?: string;
  largeur?: number;
}): JSX.Element {
  return (
    <>
      <input
        ref={libeller}
        type="number"
        value={valeur}
        step={pas}
        {...(min === undefined ? {} : { min })}
        {...(max === undefined ? {} : { max })}
        style={{ width: largeur, textAlign: 'right' }}
        // ⚠ Un champ numérique focalisé consomme la molette et incrémente sa
        // valeur : on modifierait la portée du bâtiment en faisant simplement
        // défiler le panneau, sans rien voir. On rend la main au défilement.
        onWheel={(e) => e.currentTarget.blur()}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
      {unite ? ` ${unite}` : ''}
    </>
  );
}

/**
 * Champ texte, validé à la SORTIE du champ ou sur Entrée.
 *
 * ⚠ Pas à chaque frappe. L'historique enregistre une étape par modification :
 * valider à chaque caractère faisait de « Hangar de stockage » dix-huit étapes,
 * et Ctrl+Z effaçait le nom lettre par lettre. Échap rend la valeur d'origine.
 */
export function ChampTexte({
  valeur,
  onChange,
  largeur = 220,
  placeholder,
  precision,
}: {
  valeur: string;
  onChange: (v: string) => void;
  largeur?: number | string;
  placeholder?: string;
  /** Précise l'étiquette accessible quand plusieurs champs partagent une ligne. */
  precision?: string;
}): JSX.Element {
  const [brouillon, setBrouillon] = useState(valeur);
  const ref = useMemo(() => (precision ? libellerAvec(precision) : libeller), [precision]);
  // Une valeur changée ailleurs (annulation, ouverture de fichier) l'emporte.
  useEffect(() => setBrouillon(valeur), [valeur]);
  const valider = (): void => {
    const v = brouillon.trim();
    if (v !== valeur) onChange(v);
  };
  return (
    <input
      ref={ref}
      type="text"
      value={brouillon}
      {...(placeholder ? { placeholder } : {})}
      style={{ width: largeur }}
      onChange={(e) => setBrouillon(e.target.value)}
      onBlur={valider}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setBrouillon(valeur);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * Sélecteur de profil, groupé par famille comme dans le catalogue.
 *
 * `familles` restreint la liste : on ne propose pas un tube rond en poteau de
 * portique ni un IPE 600 en lierne. Sans restriction, la liste des 232 profils
 * rend le choix pénible là où trois familles suffisent.
 */
export function ChampProfil({
  valeur,
  onChange,
  familles,
}: {
  valeur: string;
  onChange: (v: string) => void;
  familles?: readonly ProfileFamily[];
}): JSX.Element {
  const ordre = familles ?? FAMILY_ORDER;
  // Un profil hors des familles proposées reste affichable : un projet ancien ou
  // un fichier édité à la main ne doit pas voir sa valeur remplacée en silence.
  const horsListe = !PROFILES.some((p) => p.id === valeur && ordre.includes(p.family));

  return (
    <select ref={libeller} value={valeur} onChange={(e) => onChange(e.target.value)}>
      {horsListe && <option value={valeur}>{valeur}</option>}
      {ordre.map((f) => {
        const liste = PROFILES.filter((p) => p.family === f);
        if (liste.length === 0) return null;
        return (
          <optgroup key={f} label={FAMILY_LABELS[f]}>
            {liste.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export function ChampNuance({
  valeur,
  onChange,
}: {
  valeur: SteelGradeId;
  onChange: (v: SteelGradeId) => void;
}): JSX.Element {
  return (
    <select ref={libeller} value={valeur} onChange={(e) => onChange(e.target.value as SteelGradeId)}>
      {GRADE_IDS.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </select>
  );
}

/** Liste déroulante sur un type fermé : le libellé est distinct de la valeur. */
export function ChampChoix<T extends string>({
  valeur,
  onChange,
  options,
}: {
  valeur: T;
  onChange: (v: T) => void;
  options: readonly (readonly [T, string])[];
}): JSX.Element {
  // Le libellé complet en infobulle : dans une fiche étroite, le choix est tronqué.
  const choisi = options.find(([v]) => v === valeur)?.[1];
  return (
    <select ref={libeller} value={valeur} title={choisi} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, libelle]) => (
        <option key={v} value={v}>
          {libelle}
        </option>
      ))}
    </select>
  );
}

export function Bascule({
  valeur,
  onChange,
}: {
  valeur: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return <input ref={libeller} type="checkbox" checked={valeur} onChange={(e) => onChange(e.target.checked)} />;
}

/** Familles usuelles par emploi : ce qui se pose réellement en atelier. */
export const FAMILLES_POTEAU: readonly ProfileFamily[] = ['HEA', 'HEB', 'HEM', 'IPE'];
export const FAMILLES_TRAVERSE: readonly ProfileFamily[] = ['IPE', 'HEA', 'HEB'];
/*
 * ⚠ Le FORMÉ À FROID vient en tête pour les pannes et les lisses, parce que
 * c'est ce qui se pose. Un Z 200×2,0 tient le même moment qu'un IPE 120 pour
 * 5,9 kg/m contre 10,4 : sur les trois cents pannes d'un hangar, l'écart se
 * compte en tonnes. Les laminés restent proposés — ils servent encore sur les
 * grandes portées et sous charges lourdes — mais après.
 */
export const FAMILLES_PANNE: readonly ProfileFamily[] = ['Z', 'C', 'IPE', 'UPE', 'UPN'];
export const FAMILLES_LISSE: readonly ProfileFamily[] = ['C', 'Z', 'UPE', 'UPN', 'IPE'];
export const FAMILLES_TREILLIS: readonly ProfileFamily[] = ['L', 'LI', 'CHS', 'SHS', 'RHS', 'UPE'];
export const FAMILLES_CONTREVENTEMENT: readonly ProfileFamily[] = ['CHS', 'L', 'ROND', 'SHS'];
