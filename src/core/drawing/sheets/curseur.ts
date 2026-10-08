import { dessinerCadre, type CartoucheData } from '../layout';
import { DrawScene, type Bbox } from '../scene';
import type { Sheet } from '../sheet';

/**
 * Curseur de mise en page : la planche courante et la hauteur qui y reste.
 * `reserver` ouvre une planche neuve quand la place manque.
 */
export class Curseur {
  readonly pages: DrawScene[] = [];
  s!: DrawScene;
  y = 0;
  constructor(readonly fenetre: Bbox) {
    this.ouvrir();
  }
  ouvrir(): void {
    this.s = new DrawScene();
    this.pages.push(this.s);
    this.y = this.fenetre.max.y - 4;
  }
  /** Garantit `h` mm de place ; renvoie vrai si une planche a été ouverte. */
  reserver(h: number): boolean {
    if (this.y - h >= this.fenetre.min.y) return false;
    this.ouvrir();
    return true;
  }
}

/**
 * Les planches remplies par un curseur, avec leur cadre. Une seule planche
 * garde le titre nu ; plusieurs le numérotent « (2/3) ».
 */
export function planchesDe(k: Curseur, id: string, titre: string, meta: CartoucheData['meta']): Sheet[] {
  const format = 'A3' as const;
  return k.pages.map((scene, i, toutes) => {
    const t = toutes.length > 1 ? `${titre} (${i + 1}/${toutes.length})` : titre;
    dessinerCadre(scene, format, { meta, titre: t, echelle: 1, page: 0, total: 0 });
    return { id: toutes.length > 1 ? `${id}-${i + 1}` : id, kind: 'atelier', titre: t, format, echelle: 1, scene };
  });
}
