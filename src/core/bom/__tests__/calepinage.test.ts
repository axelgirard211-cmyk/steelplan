import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { ATELIER_PAR_DEFAUT } from '../../model/atelier';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { calepiner, calepinerProfil, tauxDeChute, type Coupe } from '../calepinage';

const A = ATELIER_PAR_DEFAUT; // barres de 12 m, trait 3 mm, tombée 10 mm
// Sans seuil d'abandon : pour vérifier le rangement lui-même, chute comprise.
const SANS_SEUIL = { ...A, chuteMaxi: 1 };
const coupe = (longueur: number, mark = 'X1'): Coupe => ({ mark, longueur, angleDebut: 0, angleFin: 0 });
const n = (k: number, l: number): Coupe[] => Array.from({ length: k }, () => coupe(l));

describe('calepinage — ce que la scie peut vraiment sortir d’une barre', () => {
  it('compte le trait de scie et les tombées : deux 5 990 ne tiennent pas dans 12 m', () => {
    /*
     * Recalcul : 12 000 − 2 × 10 de tombée = 11 980 utiles ; deux pièces de
     * 5 990 et un trait de 3 font 11 983 — trois millimètres de trop. Deux
     * pièces de 5 985 font 11 973 et tiennent, avec 7 mm de chute.
     */
    const trop = calepinerProfil('IPE 200', 'S235', n(2, 5990), SANS_SEUIL);
    expect(trop.longueurCommandee).toBeGreaterThan(12000);
    const juste = calepinerProfil('IPE 200', 'S235', n(2, 5985), A);
    expect(juste.barres).toBe(1);
    expect(juste.schemas[0]?.chute).toBeCloseTo(7, 6);
  });

  it('choisit la barre qui gaspille le moins : des 6,2 m sortent par deux d’une barre de 15 m', () => {
    // En 12 m : une par barre, 5,8 m de chute chacune. En 15 m : deux par barre
    // — si l'atelier accepte des barres de 15 m.
    const c = calepinerProfil('IPE 400', 'S235', n(12, 6201), { ...SANS_SEUIL, barreLaminee: 15000 });
    expect(c.barres).toBe(6);
    expect(c.schemas[0]?.barre).toBe(15000);
    expect(c.longueurCommandee).toBe(90000);
  });

  it('range une petite pièce dans la chute d’une grande', () => {
    // Une traverse de 9 829 laisse 2 151 mm : de quoi sortir huit consoles de 252.
    const c = calepinerProfil('IPE 360', 'S235', [...n(1, 9829), ...Array.from({ length: 8 }, () => coupe(252, 'CO1'))], A);
    expect(c.barres).toBe(1);
  });

  it('commande à longueur ce qu’un schéma gaspillerait au-delà du seuil', () => {
    /*
     * Une panne de 5 990 par barre de 12 m : la moitié de la barre à la
     * ferraille. Au-delà de 30 % de chute, le schéma est abandonné et la pièce
     * part à longueur — c'est ce que ferait le bureau d'études.
     */
    const c = calepinerProfil('IPE 200', 'S235', n(10, 5990), A);
    expect(c.schemas).toHaveLength(0);
    expect(c.aLongueur).toHaveLength(10);
    // Une coupe qui remplit sa barre, elle, reste au calepinage.
    const bonne = calepinerProfil('IPE 200', 'S235', n(10, 11900), A);
    expect(bonne.aLongueur).toHaveLength(0);
  });

  it('ne propose jamais une barre plus longue que ce que l’atelier accepte', () => {
    const c = calepinerProfil('IPE 400', 'S235', n(12, 6201), SANS_SEUIL);
    expect(Math.max(...c.schemas.map((s) => s.barre))).toBeLessThanOrEqual(A.barreLaminee);
    // Et ce qui ne tient dans aucune barre admise part à longueur, nommé.
    const long = calepinerProfil('IPE 400', 'S235', n(2, 13000), A);
    expect(long.aLongueur).toHaveLength(2);
  });

  it('commande à longueur ce qui dépasse toute barre, et les profils formés à froid', () => {
    const long = calepinerProfil('IPE 600', 'S355', n(1, 30000), A);
    expect(long.aLongueur).toHaveLength(1);
    expect(long.barres).toBe(0);
    const z = calepinerProfil('Z 200x2.0', 'S350' as never, n(10, 6000), A);
    expect(z.aLongueur).toHaveLength(10);
    expect(z.schemas).toHaveLength(0);
  });

  it('ne perd ni ne double aucune pièce, et ne dépasse jamais la capacité d’une barre', () => {
    const M = buildProject(DEFAULT_PROJECT);
    const tout = calepiner(M, A);
    const placees = tout.reduce(
      (t, c) => t + c.aLongueur.length + c.schemas.reduce((u, s) => u + s.coupes.length * s.nombre, 0),
      0,
    );
    expect(placees).toBe(M.members.length);
    for (const c of tout) {
      for (const s of c.schemas) {
        const occupe = s.coupes.reduce((t, x) => t + x.longueur, 0) + (s.coupes.length - 1) * A.traitDeScie;
        expect(occupe + 2 * A.tombee, `${c.profil} schéma ${s.numero}`).toBeLessThanOrEqual(s.barre + 1e-6);
        expect(s.chute).toBeGreaterThanOrEqual(0);
      }
      expect(tauxDeChute(c), c.profil).toBeGreaterThanOrEqual(0);
      expect(tauxDeChute(c), c.profil).toBeLessThan(1);
    }
  });
});
