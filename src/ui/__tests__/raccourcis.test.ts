import { describe, expect, it } from 'vitest';
import { RACCOURCIS, dansUnChamp, libelleTouche, parGroupe, trouverRaccourci } from '../raccourcis';

const touche = (
  key: string,
  mods: { ctrl?: boolean; maj?: boolean; alt?: boolean } = {},
): Parameters<typeof trouverRaccourci>[0] => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  metaKey: false,
  shiftKey: mods.maj ?? false,
  altKey: mods.alt ?? false,
});

describe('déclaration des raccourcis', () => {
  it('n’attribue jamais deux fois la même combinaison', () => {
    // ⚠ Deux raccourcis sur la même combinaison : l'un des deux ne se déclenche
    // jamais, et l'aide annonce pourtant les deux.
    const vues = new Set<string>();
    for (const r of RACCOURCIS) {
      const cle = `${r.touche.toLowerCase()}|${r.ctrl ?? false}|${r.maj ?? false}`;
      expect(vues.has(cle), `${r.id} : combinaison déjà prise`).toBe(false);
      vues.add(cle);
    }
  });

  it('donne un libellé à chacun, et un identifiant unique', () => {
    const ids = RACCOURCIS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RACCOURCIS) expect(r.libelle.length).toBeGreaterThan(4);
  });

  it('n’oublie aucun raccourci dans l’aide', () => {
    // L'aide est construite depuis la même liste : le contrôle vérifie que le
    // regroupement n'en perd aucun en route.
    const dansLAide = parGroupe().flatMap(([, l]) => l);
    expect(dansLAide).toHaveLength(RACCOURCIS.length);
  });
});

describe('reconnaissance d’une frappe', () => {
  it('retrouve un raccourci à modificateur', () => {
    expect(trouverRaccourci(touche('s', { ctrl: true }))?.id).toBe('enregistrer');
    expect(trouverRaccourci(touche('z', { ctrl: true }))?.id).toBe('undo');
  });

  it('accepte Cmd comme Ctrl', () => {
    expect(trouverRaccourci({ ...touche('s'), metaKey: true })?.id).toBe('enregistrer');
  });

  it('préfère le raccourci le PLUS spécifique', () => {
    // ⚠ Sans tri par spécificité, Ctrl+Maj+S déclencherait « Enregistrer » selon
    // l'ordre de déclaration de la liste — et le jour où quelqu'un la réordonne,
    // le comportement change sans qu'aucun test ne bronche.
    expect(trouverRaccourci(touche('s', { ctrl: true, maj: true }))?.id).toBe('enregistrer-sous');
    expect(trouverRaccourci(touche('z', { ctrl: true, maj: true }))?.id).toBe('redo');
  });

  it('ignore les frappes avec Alt', () => {
    expect(trouverRaccourci(touche('s', { ctrl: true, alt: true }))).toBeNull();
  });

  it('ignore une touche sans raccourci', () => {
    expect(trouverRaccourci(touche('q'))).toBeNull();
    expect(trouverRaccourci(touche('9'))).toBeNull();
  });

  it('est insensible à la casse', () => {
    expect(trouverRaccourci(touche('I'))?.id).toBe('vue-iso');
    expect(trouverRaccourci(touche('i'))?.id).toBe('vue-iso');
  });
});

describe('frappe dans un champ de saisie', () => {
  const champ = (tagName = 'INPUT'): EventTarget =>
    ({ tagName, isContentEditable: false }) as unknown as EventTarget;

  it('reconnaît un champ de saisie, sans dépendre du DOM', () => {
    for (const t of ['INPUT', 'TEXTAREA', 'SELECT']) expect(dansUnChamp(champ(t))).toBe(true);
    expect(dansUnChamp({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(dansUnChamp(champ('DIV'))).toBe(false);
    expect(dansUnChamp(null)).toBe(false);
    // Un `window` passé comme cible ne doit pas non plus faire lever.
    expect(() => dansUnChamp({} as EventTarget)).not.toThrow();
  });

  it('neutralise les raccourcis à une seule touche', () => {
    // ⚠ Taper « 3 » dans une cote ne doit pas changer d'onglet, et « f » dans le
    // nom du projet ne doit pas basculer la vue 3D. C'est le défaut classique des
    // raccourcis à une touche, et il rend la saisie inutilisable.
    expect(trouverRaccourci(touche('3'), champ())).toBeNull();
    expect(trouverRaccourci(touche('f'), champ())).toBeNull();
    expect(trouverRaccourci(touche('i'), champ())).toBeNull();
  });

  it('laisse passer ceux à modificateur', () => {
    // Ctrl+S doit enregistrer même le curseur dans un champ : c'est le réflexe.
    expect(trouverRaccourci(touche('s', { ctrl: true }), champ())?.id).toBe('enregistrer');
    expect(trouverRaccourci(touche('z', { ctrl: true }), champ())?.id).toBe('undo');
    expect(trouverRaccourci(touche('Escape'), champ())?.id).toBe('fermer');
  });
});

describe('libellé affiché', () => {
  it('utilise les symboles Mac ou les mots selon la plateforme', () => {
    const enregistrerSous = RACCOURCIS.find((r) => r.id === 'enregistrer-sous')!;
    expect(libelleTouche(enregistrerSous, true)).toBe('⌘⇧S');
    expect(libelleTouche(enregistrerSous, false)).toBe('Ctrl + Maj + S');
  });

  it('écrit Échap en français', () => {
    const fermer = RACCOURCIS.find((r) => r.id === 'fermer')!;
    expect(libelleTouche(fermer, false)).toBe('Échap');
  });
});
