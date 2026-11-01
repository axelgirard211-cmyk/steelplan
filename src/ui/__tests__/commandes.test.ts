import { describe, expect, it } from 'vitest';
import { transformer } from '../../core/drawing/geometrie2d';
import { pt, type DrawEntity } from '../../core/drawing/scene';
import { avancer, demarrer, REPOS, type Action, type Contexte, type Etape, type Evenement } from '../editeur/commandes';
import { lireSaisie, pointSaisi } from '../editeur/saisie';

/**
 * LIGNE DE COMMANDE DE L'ÉDITEUR — vérifiée sans écran, évènement par évènement.
 */

const CTX: Contexte = { echelle: 20, curseur: pt(0, 0), nbSelection: 0, calque: 'contour', hauteurTexte: 2.5 };

/** Joue une suite d'évènements et rend l'étape finale et toutes les actions. */
function jouer(depart: Etape, evs: readonly Evenement[], ctx: Contexte = CTX): { etape: Etape; actions: Action[]; messages: string[] } {
  let etape = depart;
  const actions: Action[] = [];
  const messages: string[] = [];
  for (const ev of evs) {
    const r = avancer(etape, ev, ctx);
    etape = r.etape;
    actions.push(...r.actions);
    if (r.message) messages.push(r.message);
  }
  return { etape, actions, messages };
}
const P = (x: number, y: number): Evenement => ({ type: 'point', p: pt(x, y) });
const T = (texte: string): Evenement => ({ type: 'saisie', texte });
const ENTREE: Evenement = { type: 'valider' };
const entites = (a: Action[]): DrawEntity[] => a.flatMap((x) => (x.type === 'ajouter' ? (x.entites as DrawEntity[]) : []));

describe('saisie au clavier', () => {
  it('lit le relatif, le polaire et la distance directe, en mm réels', () => {
    expect(lireSaisie('@500,200')).toMatchObject({ type: 'relatif', dx: 500, dy: 200 });
    expect(lireSaisie('1000<45')).toMatchObject({ type: 'polaire', d: 1000, angle: 45 });
    expect(lireSaisie('250')).toEqual({ type: 'nombre', v: 250 });
    expect(lireSaisie('C')).toEqual({ type: 'mot', texte: 'C' });
    // Au 1:20, 1 000 mm réels font 50 mm de papier.
    expect(pointSaisi(lireSaisie('@1000,0'), pt(10, 10), pt(0, 0), 20)).toEqual(pt(60, 10));
    expect(pointSaisi(lireSaisie('400'), pt(0, 0), pt(0, 30), 20)).toEqual(pt(0, 20));
  });

  it('refuse « @ » sans point de départ', () => {
    expect(pointSaisi(lireSaisie('@10,10'), null, pt(0, 0), 1)).toBeNull();
    expect(pointSaisi(lireSaisie('10,10'), null, pt(0, 0), 1)).toEqual(pt(10, 10));
  });
});

describe('commandes de tracé', () => {
  it('trace des lignes chaînées, et « C » ferme sur le premier point', () => {
    const { etape, actions } = jouer(REPOS, [T('L'), P(0, 0), P(10, 0), T('@0,200'), T('C')]);
    expect(etape).toBe(REPOS);
    const l = entites(actions);
    expect(l).toHaveLength(3);
    expect(l[1]).toMatchObject({ kind: 'ligne', a: { x: 10, y: 0 }, b: { x: 10, y: 10 } });
    expect(l[2]).toMatchObject({ a: { x: 10, y: 10 }, b: { x: 0, y: 0 } });
  });

  it('pose une polyligne d’un seul tenant à Entrée', () => {
    const { actions } = jouer(REPOS, [T('pl'), P(0, 0), P(10, 0), P(10, 5), ENTREE]);
    expect(entites(actions)).toEqual([{ kind: 'polyligne', points: [pt(0, 0), pt(10, 0), pt(10, 5)], fermee: false, layer: 'contour' }]);
  });

  it('prend le rayon d’un cercle en mm réels', () => {
    const { actions } = jouer(REPOS, [T('C'), P(50, 50), T('200')]);
    expect(entites(actions)[0]).toMatchObject({ kind: 'cercle', r: 10 });
  });

  it('trace un rectangle au coin opposé tapé', () => {
    const { actions } = jouer(REPOS, [T('REC'), P(0, 0), T('@400,200')]);
    expect(entites(actions)[0]).toMatchObject({ kind: 'polyligne', fermee: true, points: [pt(0, 0), pt(20, 0), pt(20, 10), pt(0, 10)] });
  });

  it('pose un texte avec ses espaces', () => {
    const { actions } = jouer(REPOS, [T('T'), P(5, 5), T('Nota : platine galvanisée')]);
    expect(entites(actions)[0]).toMatchObject({ kind: 'texte', texte: 'Nota : platine galvanisée', hauteur: 2.5 });
  });

  it('cote entre deux points, ligne de cote au pointeur', () => {
    const { actions } = jouer(REPOS, [T('COT'), P(0, 0), P(30, 0), P(15, 8)]);
    expect(actions[0]).toMatchObject({ type: 'ajouter', entites: [{ kind: 'cote', a: { x: 0, y: 0 }, b: { x: 30, y: 0 }, decalage: 8 }] });
  });

  it('dit qu’une commande est inconnue, sans rien faire', () => {
    const { actions, messages } = jouer(REPOS, [T('XYZ')]);
    expect(actions).toEqual([]);
    expect(messages[0]).toMatch(/inconnue/);
  });

  it('Échap abandonne la commande en cours sans rien poser', () => {
    const { etape, actions } = jouer(REPOS, [T('REC'), P(0, 0), { type: 'echap' }]);
    expect(etape).toBe(REPOS);
    expect(actions).toEqual([]);
  });
});

describe('commandes de modification', () => {
  const avecSel: Contexte = { ...CTX, nbSelection: 2 };

  it('demande une sélection avant d’agir', () => {
    const r = demarrer('deplacer', CTX);
    expect(r.etape).toBe(REPOS);
    expect(r.message).toMatch(/sélectionnez/);
  });

  it('déplace de la valeur tapée, en mm réels', () => {
    const { actions } = jouer(REPOS, [T('M'), P(0, 0), T('@1000,-200')], avecSel);
    const a = actions[0];
    if (a?.type !== 'transformer') throw new Error('pas de transformation');
    expect(a.copie).toBe(false);
    expect(transformer({ kind: 'ligne', a: pt(0, 0), b: pt(1, 0), layer: 'contour' }, a.affine)).toMatchObject({ a: { x: 50, y: -10 } });
  });

  it('copie autant de fois qu’on clique, jusqu’à Entrée', () => {
    const { etape, actions } = jouer(REPOS, [T('CO'), P(0, 0), P(10, 0), P(20, 0), ENTREE], avecSel);
    expect(etape).toBe(REPOS);
    expect(actions.filter((a) => a.type === 'transformer' && a.copie)).toHaveLength(2);
  });

  it('tourne de l’angle tapé et met à l’échelle du facteur tapé', () => {
    const ro = jouer(REPOS, [T('RO'), P(0, 0), T('90')], avecSel).actions[0];
    if (ro?.type !== 'transformer') throw new Error('pas de rotation');
    const l = transformer({ kind: 'ligne', a: pt(0, 0), b: pt(10, 0), layer: 'contour' }, ro.affine) as Extract<DrawEntity, { kind: 'ligne' }>;
    expect(l.b.y).toBeCloseTo(10);
    const sc = jouer(REPOS, [T('SC'), P(0, 0), T('2')], avecSel).actions[0];
    if (sc?.type !== 'transformer') throw new Error('pas d’échelle');
    expect(transformer({ kind: 'cercle', c: pt(1, 0), r: 1, layer: 'contour' }, sc.affine)).toMatchObject({ c: { x: 2 }, r: 2 });
  });

  it('refuse un miroir dont les deux points sont confondus', () => {
    const r = jouer(REPOS, [T('MI'), P(5, 5), P(5, 5)], avecSel);
    expect(r.actions).toHaveLength(0);
    expect(r.etape).toMatchObject({ cmd: 'miroir', a: { x: 5, y: 5 } });
    expect(jouer(r.etape, [P(5, 10)], avecSel).actions).toHaveLength(1);
  });

  it('efface la sélection d’un coup', () => {
    expect(demarrer('effacer', avecSel).actions).toEqual([{ type: 'effacer' }]);
  });
});

describe('commandes qui désignent un objet', () => {
  const l = (x0: number, y0: number, x1: number, y1: number): Extract<DrawEntity, { kind: 'ligne' }> => ({ kind: 'ligne', a: pt(x0, y0), b: pt(x1, y1), layer: 'contour' });
  const cible = l(0, 0, 10, 0);
  const autres = [l(3, -5, 3, 5), l(7, -5, 7, 5)];
  const avecTraits: Contexte = { ...CTX, traits: [cible, ...autres] };
  const sur = (x: number, y: number): Evenement => ({ type: 'point', p: pt(x, y), sous: { cle: 'g:cible', entite: cible } });

  it('trace un arc par trois points', () => {
    const { actions } = jouer(REPOS, [T('A'), P(10, 0), P(0, 10), P(-10, 0)]);
    expect(entites(actions)[0]).toMatchObject({ kind: 'arc', r: 10 });
  });

  it('décale à la distance tapée en mm réels, objet après objet', () => {
    const { etape, actions } = jouer(REPOS, [T('O'), T('40'), sur(5, 0), P(5, 3)], avecTraits);
    // Au 1:20, 40 mm réels font 2 mm de papier.
    expect(entites(actions)[0]).toMatchObject({ kind: 'ligne', a: { x: 0, y: 2 } });
    expect(etape).toMatchObject({ cmd: 'decaler', objet: null });
  });

  it('ajuste la ligne cliquée entre les traits qui la coupent', () => {
    const { actions } = jouer(REPOS, [T('AJ'), sur(5, 0)], avecTraits);
    expect(actions[0]).toMatchObject({ type: 'remplacer', cle: 'g:cible' });
    expect((actions[0] as Extract<Action, { type: 'remplacer' }>).par).toHaveLength(2);
  });

  it('prolonge la ligne jusqu’au trait suivant', () => {
    const courte = l(4, 0, 5, 0);
    const { actions } = jouer(REPOS, [T('PR'), { type: 'point', p: pt(4.9, 0), sous: { cle: 'a:c', entite: courte } }], { ...CTX, traits: [courte, ...autres] });
    expect((actions[0] as Extract<Action, { type: 'remplacer' }>).par[0]).toMatchObject({ b: { x: 7 } });
  });

  it('dit pourquoi elle ne peut rien faire', () => {
    expect(jouer(REPOS, [T('AJ'), P(5, 0)], avecTraits).messages[0]).toMatch(/cliquez une ligne/);
    expect(demarrer('hachurer', { ...CTX, nbSelection: 1, selection: [cible] }).message).toMatch(/contours fermés/);
  });

  it('hachure les contours fermés de la sélection', () => {
    const rect: DrawEntity = { kind: 'polyligne', points: [pt(0, 0), pt(10, 0), pt(10, 5), pt(0, 5)], fermee: true, layer: 'contour' };
    const r = demarrer('hachurer', { ...CTX, nbSelection: 1, selection: [rect] });
    expect(r.actions[0]).toMatchObject({ type: 'ajouter', entites: [{ kind: 'hachure', contour: rect.points }] });
  });
});

describe('ajuster et prolonger : intersections exactes, droites parallèles', () => {
  type Ligne = Extract<DrawEntity, { kind: 'ligne' }>;
  const l = (x0: number, y0: number, x1: number, y1: number): Ligne => ({ kind: 'ligne', a: pt(x0, y0), b: pt(x1, y1), layer: 'contour' });
  const clic = (x: number, y: number, cible: Ligne): Evenement => ({ type: 'point', p: pt(x, y), sous: { cle: 'a:cible', entite: cible } });
  const remplacants = (actions: Action[]): Ligne[] => {
    const a = actions[0];
    if (a?.type !== 'remplacer') throw new Error(`pas de remplacement : ${JSON.stringify(actions)}`);
    expect(a.cle).toBe('a:cible');
    return a.par as Ligne[];
  };
  const proche = (p: { x: number; y: number }, x: number, y: number): void => {
    expect(p.x).toBeCloseTo(x, 12);
    expect(p.y).toBeCloseTo(y, 12);
  };

  it('ajuste au point d’intersection exact de traits obliques', () => {
    /*
     * Cible y = 0 de x = 0 à 10. Coupantes obliques :
     *  (2, −3)→(5, 3) : y = 0 pour t = 1/2, donc x = 3,5 ;
     *  (6, −1)→(8, 1) : y = 0 pour t = 1/2, donc x = 7.
     * Un clic en x = 5 retire [3,5 ; 7] et laisse [0 ; 3,5] et [7 ; 10].
     */
    const cible = l(0, 0, 10, 0);
    const traits = [cible, l(2, -3, 5, 3), l(6, -1, 8, 1)];
    const { actions, etape } = jouer(REPOS, [T('AJ'), clic(5, 0.1, cible)], { ...CTX, traits });
    const [g, d] = remplacants(actions);
    proche(g!.a, 0, 0);
    proche(g!.b, 3.5, 0);
    proche(d!.a, 7, 0);
    proche(d!.b, 10, 0);
    // La commande reste ouverte pour le tronçon suivant, comme en DAO.
    expect(etape).toMatchObject({ cmd: 'ajuster' });
  });

  it('ajuste un bout : il ne reste qu’un morceau', () => {
    const cible = l(0, 0, 10, 0);
    const { actions } = jouer(REPOS, [T('AJ'), clic(9, 0, cible)], { ...CTX, traits: [cible, l(2, -3, 5, 3), l(6, -1, 8, 1)] });
    const par = remplacants(actions);
    expect(par).toHaveLength(1);
    proche(par[0]!.b, 7, 0);
  });

  it('prolonge une ligne oblique jusqu’à l’intersection exacte', () => {
    // y = x/2 prolongée jusqu'à x = 6 : (6, 3).
    const cible = l(0, 0, 2, 1);
    const { actions } = jouer(REPOS, [T('PR'), clic(1.9, 0.95, cible)], { ...CTX, traits: [cible, l(6, -10, 6, 10), l(9, -10, 9, 10)] });
    const [longue] = remplacants(actions);
    proche(longue!.a, 0, 0);
    proche(longue!.b, 6, 3);
  });

  it('prolonge par le bout le plus proche du clic', () => {
    const cible = l(0, 0, 2, 1);
    const { actions } = jouer(REPOS, [T('PR'), clic(0.1, 0.05, cible)], { ...CTX, traits: [cible, l(-4, -10, -4, 10), l(6, -10, 6, 10)] });
    const [longue] = remplacants(actions);
    proche(longue!.a, -4, -2);
    proche(longue!.b, 2, 1);
  });

  it('refuse d’ajuster une ligne que seuls des traits parallèles longent', () => {
    const cible = l(0, 0, 10, 0);
    const paralleles = [l(0, 2, 10, 2), l(-5, -1, 15, -1), l(3, 0.5, 7, 0.5)];
    const { actions, messages, etape } = jouer(REPOS, [T('AJ'), clic(5, 0, cible)], { ...CTX, traits: [cible, ...paralleles] });
    expect(actions).toEqual([]);
    expect(messages[0]).toMatch(/aucun trait ne coupe/);
    expect(etape).toMatchObject({ cmd: 'ajuster' });
  });

  it('refuse de prolonger vers des traits parallèles, même obliques', () => {
    const cible = l(0, 0, 2, 1);
    const paralleles = [l(0, 3, 2, 4), l(10, 0, 14, 2)];
    const { actions, messages } = jouer(REPOS, [T('PR'), clic(1.9, 0.95, cible)], { ...CTX, traits: [cible, ...paralleles] });
    expect(actions).toEqual([]);
    expect(messages[0]).toMatch(/ne rencontre aucun trait/);
  });

  it('refuse de prolonger quand le seul trait est de l’autre côté', () => {
    const cible = l(0, 0, 2, 1);
    const { actions, messages } = jouer(REPOS, [T('PR'), clic(1.9, 0.95, cible)], { ...CTX, traits: [cible, l(-4, -10, -4, 10)] });
    expect(actions).toEqual([]);
    expect(messages[0]).toMatch(/ne rencontre aucun trait/);
  });
});
