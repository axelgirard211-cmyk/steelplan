import { useMemo, useState } from 'react';
import {
  FAMILY_LABELS,
  FAMILY_ORDER,
  PROFILES,
  type Profile,
  type ProfileFamily,
} from '../../core/catalog/index';
import { cm, cm2, cm3, cm4, dim, m2parM, num } from '../format';

/**
 * Écran de contrôle du catalogue : il sert à vérifier à l'œil, famille par
 * famille, que les caractéristiques chargées correspondent bien à celles d'un
 * catalogue fournisseur. Les tests de cohérence font le reste.
 */
export function CataloguePanel(): JSX.Element {
  const [famille, setFamille] = useState<ProfileFamily>('IPE');
  const [recherche, setRecherche] = useState('');

  const parFamille = useMemo(() => {
    const m = new Map<ProfileFamily, Profile[]>();
    for (const p of PROFILES) {
      const l = m.get(p.family);
      if (l) l.push(p);
      else m.set(p.family, [p]);
    }
    return m;
  }, []);

  const lignes = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (q) return PROFILES.filter((p) => p.id.toLowerCase().includes(q));
    return parFamille.get(famille) ?? [];
  }, [famille, recherche, parFamille]);

  return (
    <>
      <nav className="laterale">
        <ul className="familles">
          {FAMILY_ORDER.map((f) => (
            <li key={f}>
              <button
                type="button"
                aria-current={!recherche && f === famille}
                onClick={() => {
                  setRecherche('');
                  setFamille(f);
                }}
              >
                <span>{FAMILY_LABELS[f]}</span>
                <span className="compte">{parFamille.get(f)?.length ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section className="principal">
        <div className="barre-outils">
          <input
            type="search"
            placeholder="Rechercher un profil (ex. IPE 300, SHS 100)"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <span className="compte">
            {lignes.length} profil{lignes.length > 1 ? 's' : ''}
            {recherche ? ' trouvé' + (lignes.length > 1 ? 's' : '') : ` — ${FAMILY_LABELS[famille]}`}
          </span>
          <span className="compte">Total catalogue : {PROFILES.length}</span>
        </div>

        <div className="tableau-enveloppe">
          <table className="profils">
            <thead>
              <tr>
                <th rowSpan={2} className="designation">
                  Désignation
                </th>
                <th colSpan={4} className="groupe">
                  Dimensions (mm)
                </th>
                <th colSpan={2} className="groupe">
                  Section
                </th>
                <th colSpan={4} className="groupe">
                  Axe fort y-y
                </th>
                <th colSpan={4} className="groupe">
                  Axe faible z-z
                </th>
                <th rowSpan={2} className="sep">
                  Surface
                  <br />
                  m²/m
                </th>
                <th rowSpan={2}>Origine</th>
              </tr>
              <tr>
                <th className="sep">h</th>
                <th>b</th>
                <th>tw / t</th>
                <th>tf</th>
                <th className="sep">A (cm²)</th>
                <th>G (kg/m)</th>
                <th className="sep">Iy (cm⁴)</th>
                <th>Wel,y (cm³)</th>
                <th>Wpl,y (cm³)</th>
                <th>iy (cm)</th>
                <th className="sep">Iz (cm⁴)</th>
                <th>Wel,z (cm³)</th>
                <th>Wpl,z (cm³)</th>
                <th>iz (cm)</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((p) => (
                <LigneProfil key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        </div>

        <p className="note">
          Les valeurs marquées <span className="puce">calculé</span> sont déduites des dimensions
          nominales : exactes pour les tubes et les plats (formules fermées), à ±3 % pour les
          cornières à ailes inégales (congés négligés). Les valeurs <span className="puce">table</span>{' '}
          sont saisies depuis les normes EN 10365 / 10056 / 10219 et recoupées par les tests de
          cohérence (masse ↔ aire, rayon de giration ↔ inertie, module ↔ inertie).
        </p>
        <p className="note alerte">
          <strong>Profils formés à froid (Z et C).</strong> Dimensions REPRÉSENTATIVES du marché
          européen, non le catalogue d’un fabricant : chaque profileur a ses largeurs d’aile et ses
          retours, et deux Z 200 de marques différentes ne sont pas interchangeables. Reprendre les
          cotes du fournisseur avant commande. Les caractéristiques données sont celles de la
          section <em>brute</em> — elles donnent la masse, le dessin et la flèche. La RÉSISTANCE,
          elle, passe par la section efficace de l’EN 1993-1-3, d’où l’absence de module plastique :
          ces sections voilent localement avant de plastifier et ne l’atteignent jamais. Sous
          soulèvement, la stabilité de la semelle libre comprimée est vérifiée, sans maintien
          attribué au bac (prudent). Ne sont couverts ni sa flexion latérale, ni la résistance
          locale sur appui, ni la continuité par emboîtement — points qui relèvent des tables du
          fabricant.
        </p>
      </section>
    </>
  );
}

/** Épaisseurs affichées dans les colonnes tw / tf selon la forme de section. */
function epaisseurs(p: Profile): { tw: string; tf: string } {
  switch (p.shape) {
    case 'I':
    case 'U':
      return { tw: dim(p.tw), tf: dim(p.tf) };
    case 'L':
    case 'CHS':
    case 'BOX':
    case 'RECT':
      return { tw: dim(p.t), tf: '—' };
    // Un profil formé à froid est plié dans une tôle d'épaisseur unique : la
    // même valeur pour l'âme et pour l'aile, ce n'est pas une lacune.
    case 'Z':
    case 'C':
      return { tw: dim(p.t), tf: dim(p.t) };
    case 'ROND':
      return { tw: '—', tf: '—' };
  }
}

function LigneProfil({ p }: { p: Profile }): JSX.Element {
  const e = epaisseurs(p);
  /*
   * ⚠ Le module PLASTIQUE n'est pas affiché pour un profil formé à froid : ces
   * sections voilent localement avant de plastifier et ne l'atteignent jamais.
   * La valeur existe — elle se calcule comme pour toute section — mais l'afficher
   * à côté du module élastique inviterait à s'en servir, et c'est 20 % de
   * résistance qui n'existent pas. Leur vraie résistance passe par le module
   * EFFICACE de l'EN 1993-1-3.
   */
  const froid = p.shape === 'Z' || p.shape === 'C';
  const plastique = (v: number): string => (froid ? '—' : cm3(v));

  return (
    <tr>
      <td className="designation">{p.id}</td>
      <td className="sep">{dim(p.h)}</td>
      <td>{dim(p.b)}</td>
      <td>{e.tw}</td>
      <td>{e.tf}</td>
      <td className="sep">{cm2(p.A)}</td>
      <td>{num(p.G, 1)}</td>
      <td className="sep">{cm4(p.Iy)}</td>
      <td>{cm3(p.Wely)}</td>
      <td>{plastique(p.Wply)}</td>
      <td>{cm(p.iy)}</td>
      <td className="sep">{cm4(p.Iz)}</td>
      <td>{cm3(p.Welz)}</td>
      <td>{plastique(p.Wplz)}</td>
      <td>{cm(p.iz)}</td>
      <td className="sep">{m2parM(p.perimeter)}</td>
      <td>
        <span className="puce">{p.source === 'catalogue' ? 'table' : 'calculé'}</span>
      </td>
    </tr>
  );
}
