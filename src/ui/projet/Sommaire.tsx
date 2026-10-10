import { useEffect, useRef, useState } from 'react';
import { normaliser, RUBRIQUES } from './rubriques';

/**
 * SOMMAIRE DE L'ONGLET PROJET — trouver un paramètre sans faire défiler cinq
 * écrans de fiches.
 *
 * ⚠ La saisie compte près de cent quarante champs, en seize fiches. On y
 * cherchait la pince des platines en faisant défiler la page à l'œil. Le
 * sommaire mène à chaque rubrique et dit où sont les erreurs ; la recherche
 * trouve un champ par son nom — celui que porte son étiquette accessible.
 */

export interface CompteRubrique {
  readonly erreurs: number;
  readonly avertissements: number;
}

interface Trouve {
  readonly libelle: string;
  readonly rubrique: string;
  readonly el: HTMLElement;
}

const MAX_TROUVES = 12;

/** Amène un élément au centre de la page et le fait clignoter. */
export function eclairer(el: HTMLElement, bloc: ScrollLogicalPosition = 'center'): void {
  el.scrollIntoView({ block: bloc, behavior: 'smooth' });
  el.classList.remove('eclair');
  // Relancer l'animation : une lecture de mise en page entre les deux suffit.
  void el.offsetWidth;
  el.classList.add('eclair');
  window.setTimeout(() => el.classList.remove('eclair'), 1600);
}

export function Sommaire({
  comptes,
  apercu,
  setApercu,
  onAller,
}: {
  comptes: ReadonlyMap<string, CompteRubrique>;
  apercu: boolean;
  setApercu: (v: boolean) => void;
  onAller: (id: string) => void;
}): JSX.Element {
  const [requete, setRequete] = useState('');
  const [trouves, setTrouves] = useState<readonly Trouve[]>([]);
  const champ = useRef<HTMLInputElement>(null);

  // Recherche sur les champs effectivement affichés, par leur nom accessible.
  useEffect(() => {
    const q = normaliser(requete);
    if (q.length < 2) {
      setTrouves([]);
      return;
    }
    const champs = [...document.querySelectorAll<HTMLElement>('.projet-fiches [aria-label]')].filter((el) => el.matches('input, select, textarea'));
    setTrouves(
      champs
        .filter((el) => normaliser(el.getAttribute('aria-label') ?? '').includes(q))
        .slice(0, MAX_TROUVES)
        .map((el) => ({
          libelle: el.getAttribute('aria-label') ?? '',
          rubrique: el.closest('.fiche')?.querySelector('h3')?.textContent ?? '',
          el,
        })),
    );
  }, [requete]);

  // « / » amène à la recherche, comme dans la plupart des logiciels.
  useEffect(() => {
    const touche = (e: KeyboardEvent): void => {
      const t = e.target as { tagName?: string };
      if (e.key !== '/' || t?.tagName === 'INPUT' || t?.tagName === 'SELECT' || t?.tagName === 'TEXTAREA') return;
      e.preventDefault();
      champ.current?.focus();
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, []);

  const aller = (t: Trouve): void => {
    eclairer(t.el.closest('dd') ?? t.el);
    t.el.focus({ preventScroll: true });
  };

  return (
    <nav className="laterale sommaire" aria-label="Sommaire du projet">
      <input
        ref={champ}
        type="search"
        className="recherche"
        placeholder="Rechercher un paramètre  ( / )"
        aria-label="Rechercher un paramètre"
        value={requete}
        onChange={(e) => setRequete(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && trouves[0]) aller(trouves[0]);
          if (e.key === 'Escape') setRequete('');
        }}
      />
      {requete.trim().length >= 2 && (
        <ul className="trouves">
          {trouves.length === 0 ? (
            <li className="note">Aucun paramètre ne correspond.</li>
          ) : (
            trouves.map((t, i) => (
              <li key={i}>
                <button type="button" onClick={() => aller(t)}>
                  <span>{t.libelle}</span>
                  <span className="compte">{t.rubrique}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      <div className="titre-groupe">Rubriques</div>
      <ul className="familles">
        {RUBRIQUES.map((r) => {
          const c = comptes.get(r.titre);
          return (
            <li key={r.id}>
              <button type="button" onClick={() => onAller(r.id)}>
                <span>{r.court}</span>
                {c && c.erreurs > 0 ? (
                  <span className="pastille-compte erreur" title={`${c.erreurs} erreur(s)`}>
                    {c.erreurs}
                  </span>
                ) : c && c.avertissements > 0 ? (
                  <span className="pastille-compte avertissement" title={`${c.avertissements} avertissement(s)`}>
                    {c.avertissements}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <label className="etiquette bascule-apercu">
        <input type="checkbox" checked={apercu} onChange={(e) => setApercu(e.target.checked)} /> Aperçu 3D à côté de la saisie
      </label>
    </nav>
  );
}
