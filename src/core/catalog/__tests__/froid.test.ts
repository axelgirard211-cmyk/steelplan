import { describe, expect, it } from 'vitest';
import { polygonArea, sectionOutline } from '../../geometry/section';
import { RHO_ACIER } from '../../math/tolerance';
import { epaisseurParoi } from '../../build/bolts';
import { fyDe } from '../../checks/element';
import { getProfile, PROFILES } from '../index';
import type { ColdProfile } from '../types';

const FROIDS = PROFILES.filter((p): p is ColdProfile => p.shape === 'Z' || p.shape === 'C');

describe('catalogue formé à froid', () => {
  it('propose des Z et des C sur toute la gamme des pannes courantes', () => {
    expect(FROIDS.length).toBeGreaterThan(30);
    expect(FROIDS.filter((p) => p.shape === 'Z').length).toBeGreaterThan(15);
    expect(FROIDS.filter((p) => p.shape === 'C').length).toBeGreaterThan(15);
  });

  it('le contour dessiné a l’aire de la section calculée', () => {
    /*
     * ⚠ L'INVARIANT QUI LIE LE DESSIN AU CALCUL. Les caractéristiques viennent
     * d'une décomposition en rectangles, le contour d'un parcours de la
     * silhouette : deux écritures indépendantes de la même géométrie. Si elles
     * divergent, l'une des deux est fausse — et rien d'autre ne le dirait, parce
     * qu'un profil mal dessiné se vérifie quand même et qu'une section mal
     * calculée se dessine quand même.
     */
    for (const p of FROIDS) {
      const aire = Math.abs(polygonArea(sectionOutline(p).outer));
      expect(aire, p.id).toBeCloseTo(p.A, 6);
    }
  });

  it('la masse linéique découle de l’aire, sans valeur saisie à part', () => {
    for (const p of FROIDS) expect(p.G, p.id).toBeCloseTo(p.A * RHO_ACIER * 1000, 9);
  });

  it('reste dans la plage de masse des pannes du marché', () => {
    /*
     * Contrôle de VRAISEMBLANCE face au marché : une panne formée à froid pèse
     * de 2 à 14 kg/m — le haut de la fourchette étant le Z 300×3,0, qui est une
     * grosse panne. Hors de là, c'est une cote entrée en centimètres ou une
     * épaisseur prise pour une hauteur.
     */
    for (const p of FROIDS) {
      expect(p.G, p.id).toBeGreaterThan(2);
      expect(p.G, p.id).toBeLessThan(14);
    }
  });

  it('pèse trois fois moins qu’un IPE de résistance comparable', () => {
    /*
     * ⚠ C'est la RAISON D'ÊTRE de ces profils, et elle mérite d'être tenue par
     * un test. Un Z 200×2,0 offre un module de flexion voisin d'un IPE 120 pour
     * moins de la moitié de sa masse : c'est pourquoi presque personne ne pose
     * d'IPE en panne. Si une modification du catalogue effaçait cet écart, le
     * lot entier perdrait son objet.
     */
    const z = getProfile('Z 200x2.0');
    const ipe = getProfile('IPE 120');
    expect(z.Wely).toBeGreaterThan(ipe.Wely * 0.8);
    expect(z.G).toBeLessThan(ipe.G * 0.65);
  });
});

describe('géométrie du Z', () => {
  const Z = getProfile('Z 200x2.0') as ColdProfile;
  const C = getProfile('C 200x2.0') as ColdProfile;

  it('a ses ailes inégales, condition de l’emboîtement', () => {
    expect(Z.aile).toBeGreaterThan(Z.aile2);
    expect(C.aile).toBe(C.aile2);
  });

  it('a des axes principaux inclinés : Iyz non nul', () => {
    /*
     * ⚠ Une panne en Q libre fléchit DE BIAIS. Le produit d'inertie le dit ; le
     * supposer nul reviendrait à traiter le Z comme un C, à sous-estimer la
     * flèche et à ignorer la composante latérale que reprennent les liernes.
     */
    expect(Math.abs(Z.Iyz)).toBeGreaterThan(0.2 * Z.Iy);
    expect(C.Iyz).toBeCloseTo(0, 6);
  });

  it('déborde des deux côtés de l’âme, contrairement au C', () => {
    // Encombrement total : les deux ailes d'un Z partent en sens opposés.
    expect(Z.b).toBeCloseTo(Z.aile + Z.aile2 - Z.t, 6);
    expect(C.b).toBeCloseTo(C.aile, 6);
  });

  it('a son centre de gravité hors de la mi-hauteur, le C sur elle', () => {
    expect(C.cz).toBeCloseTo(C.h / 2, 6);
    expect(Z.cz).not.toBeCloseTo(Z.h / 2, 3);
  });

  it('développe une bande plus courte que la somme des cotes hors tout', () => {
    /*
     * Le développé se mesure sur la fibre moyenne. Sommer les cotes extérieures
     * compterait chaque pli deux fois et ferait commander trop de bande.
     */
    for (const p of FROIDS) {
      expect(p.developpe, p.id).toBeLessThan(p.h + 2 * p.aile + 2 * p.c);
      expect(p.developpe, p.id).toBeGreaterThan(0.8 * (p.h + 2 * p.aile));
    }
  });

  it('respecte la limite de rayon qui autorise le calcul à plis vifs', () => {
    /*
     * ⚠ L'EN 1993-1-3 § 5.1(3) n'autorise à négliger l'arrondi des plis que si
     * r ≤ 5 t ET r ≤ 0,10 bp. Tout le catalogue est calculé à plis vifs : si un
     * profil sortait de ces bornes, ses caractéristiques seraient fausses sans
     * que rien ne le signale.
     */
    for (const p of FROIDS) {
      expect(p.r, p.id).toBeLessThanOrEqual(5 * p.t);
      const bp = Math.min(p.aile2, p.h) - 2 * p.t;
      expect(p.r, p.id).toBeLessThanOrEqual(0.1 * bp);
    }
  });
});

describe('épaisseur de paroi — aucun profil ne retombe sur sa hauteur', () => {
  /*
   * ⚠ LE MÊME DÉFAUT, TROIS FOIS. Trois fonctions cherchaient l'épaisseur d'un
   * profil par une cascade de formes, avec un repli final sur la HAUTEUR — juste
   * pour la barre ronde pleine. Chaque forme nouvelle y tombait en silence : la
   * boulonnerie de construction, puis la limite d'élasticité (215 MPa au lieu
   * de 235 pour un Z de 2 mm, lu comme une tôle de 200), puis la nomenclature
   * (trois cents boulons M12×230 commandés). Ce test balaie le catalogue entier :
   * une forme qu'on ajouterait sans la traiter le fera échouer.
   */
  it('la paroi traversée reste mince devant la plus grande dimension du profil', () => {
    /*
     * Borne sur la PLUS GRANDE dimension, et non sur la hauteur : un plat est
     * décrit couché, sa « hauteur » est son épaisseur. Elle reste sévère pour
     * tout le reste — un Z qui retomberait sur ses 200 mm la dépasserait.
     */
    for (const p of PROFILES) {
      if (p.shape === 'ROND') continue; // seule exception légitime : un rond plein
      for (const through of ['y', 'z'] as const) {
        expect(epaisseurParoi(p, { through }), `${p.id} percé selon ${through}`).toBeLessThan(
          Math.max(p.h, p.b) / 2,
        );
      }
    }
  });

  it('un profil formé à froid reçoit la limite d’élasticité de sa tôle mince', () => {
    for (const p of FROIDS) {
      expect(fyDe(p, 'S235'), p.id).toBe(235);
      expect(fyDe(p, 'S355'), p.id).toBe(355);
    }
  });
});
