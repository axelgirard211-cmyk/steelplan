import type { Pt2 } from '../../core/geometry/section';
import { cross, dot, normalize, sub, v3, type Vec3 } from '../../core/math/vec3';
import { en, type FichierStep, type Ref } from './step';

/**
 * GÉOMÉTRIE IFC — placements, profils, extrusions et découpes.
 *
 * Toute pièce est décrite comme le ferait un logiciel de charpente : un PROFIL
 * plan, extrudé, puis recoupé. C'est cette forme — et non un maillage de
 * triangles — qui permet au logiciel qui relit le fichier de reconnaître un
 * IPE 300 et d'en faire une barre de son propre catalogue.
 */

/** Repère orthonormé direct : origine, axe X, axe Z (Y = Z × X). */
export interface Repere {
  readonly o: Vec3;
  readonly x: Vec3;
  readonly z: Vec3;
}

/** Une direction quelconque perpendiculaire à `z`. */
export function perpendiculaire(z: Vec3): Vec3 {
  const a = Math.abs(z.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0);
  return normalize(cross(a, z));
}

/** Coordonnées d'un point dans un repère. */
export function versLocal(r: Repere, p: Vec3): Vec3 {
  const d = sub(p, r.o);
  const y = cross(r.z, r.x);
  return v3(dot(d, r.x), dot(d, y), dot(d, r.z));
}

/** Composantes d'une direction dans un repère. */
export function directionLocale(r: Repere, d: Vec3): Vec3 {
  const y = cross(r.z, r.x);
  return v3(dot(d, r.x), dot(d, y), dot(d, r.z));
}

const cle = (...v: number[]): string => v.map((x) => Math.round(x * 1e6)).join(',');

/**
 * Fabrique d'entités géométriques sur un fichier. Points et directions sont
 * partagés : cinq cents barres posées au même niveau n'écrivent pas cinq cents
 * fois l'origine.
 */
export class Geometrie {
  private readonly points = new Map<string, Ref>();
  private readonly directions = new Map<string, Ref>();
  private readonly profils = new Map<string, Ref>();

  constructor(private readonly f: FichierStep) {}

  point(p: Vec3): Ref {
    const k = cle(p.x, p.y, p.z);
    let r = this.points.get(k);
    if (!r) {
      r = this.f.ajouter('IFCCARTESIANPOINT', [p.x, p.y, p.z]);
      this.points.set(k, r);
    }
    return r;
  }

  point2(y: number, z: number): Ref {
    const k = `2:${cle(y, z)}`;
    let r = this.points.get(k);
    if (!r) {
      r = this.f.ajouter('IFCCARTESIANPOINT', [y, z]);
      this.points.set(k, r);
    }
    return r;
  }

  direction(d: Vec3): Ref {
    const n = normalize(d);
    const k = cle(n.x, n.y, n.z);
    let r = this.directions.get(k);
    if (!r) {
      r = this.f.ajouter('IFCDIRECTION', [n.x, n.y, n.z]);
      this.directions.set(k, r);
    }
    return r;
  }

  /** IfcAxis2Placement3D ; sans axes, le repère par défaut. */
  placement(o: Vec3, z?: Vec3, x?: Vec3): Ref {
    return this.f.ajouter('IFCAXIS2PLACEMENT3D', this.point(o), z ? this.direction(z) : null, x ? this.direction(x) : null);
  }

  placementDe(r: Repere): Ref {
    return this.placement(r.o, r.z, r.x);
  }

  /** Placement d'objet, relatif à un autre ou absolu. */
  placementLocal(relatifA: Ref | null, r: Repere | null): Ref {
    return this.f.ajouter('IFCLOCALPLACEMENT', relatifA, r ? this.placementDe(r) : this.placement(v3(0, 0, 0)));
  }

  /** Polyligne plane FERMÉE : IFC exige que le dernier point répète le premier. */
  polyligne(pts: readonly Pt2[]): Ref {
    const refs = pts.map((p) => this.point2(p.y, p.z));
    return this.f.ajouter('IFCPOLYLINE', [...refs, refs[0] as Ref]);
  }

  /**
   * Profil plan quelconque, vides compris, partagé sous une clé : toutes les
   * barres d'un même profil réutilisent la même définition.
   */
  profil(clef: string, nom: string | null, exterieur: readonly Pt2[], vides: readonly (readonly Pt2[])[] = []): Ref {
    const connu = this.profils.get(clef);
    if (connu) return connu;
    const r =
      vides.length === 0
        ? this.f.ajouter('IFCARBITRARYCLOSEDPROFILEDEF', en('AREA'), nom, this.polyligne(exterieur))
        : this.f.ajouter(
            'IFCARBITRARYPROFILEDEFWITHVOIDS',
            en('AREA'),
            nom,
            this.polyligne(exterieur),
            vides.map((v) => this.polyligne(v)),
          );
    this.profils.set(clef, r);
    return r;
  }

  cercle(rayon: number): Ref {
    const k = `cercle:${cle(rayon)}`;
    const connu = this.profils.get(k);
    if (connu) return connu;
    const r = this.f.ajouter('IFCCIRCLEPROFILEDEF', en('AREA'), null, this.f.ajouter('IFCAXIS2PLACEMENT2D', this.point2(0, 0), null), rayon);
    this.profils.set(k, r);
    return r;
  }

  rectangle(cy: number, cz: number, ly: number, lz: number): Ref {
    return this.f.ajouter('IFCRECTANGLEPROFILEDEF', en('AREA'), null, this.f.ajouter('IFCAXIS2PLACEMENT2D', this.point2(cy, cz), null), ly, lz);
  }

  /** Profil extrudé selon Z, de `z0` sur `profondeur`, dans le repère de la pièce. */
  extrusion(profil: Ref, z0: number, profondeur: number): Ref {
    return this.f.ajouter('IFCEXTRUDEDAREASOLID', profil, this.placement(v3(0, 0, z0)), this.direction(v3(0, 0, 1)), profondeur);
  }

  /** Extrusion posée dans un repère quelconque. */
  extrusionDans(profil: Ref, r: Repere, profondeur: number): Ref {
    return this.f.ajouter('IFCEXTRUDEDAREASOLID', profil, this.placementDe(r), this.direction(v3(0, 0, 1)), profondeur);
  }

  /**
   * Retire d'un solide tout ce qui est du côté de `normale` par rapport au plan.
   *
   * ⚠ AgreementFlag FAUX : la normale pointe VERS la matière du demi-espace —
   * celle qu'on retire. Vrai, c'est la barre elle-même qui disparaissait.
   */
  recouper(solide: Ref, point: Vec3, normale: Vec3): Ref {
    const plan = this.f.ajouter('IFCPLANE', this.placement(point, normale, perpendiculaire(normale)));
    const demi = this.f.ajouter('IFCHALFSPACESOLID', plan, false);
    return this.f.ajouter('IFCBOOLEANCLIPPINGRESULT', en('DIFFERENCE'), solide, demi);
  }
}
