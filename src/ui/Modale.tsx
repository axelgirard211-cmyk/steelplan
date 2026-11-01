import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * FENÊTRE MODALE — voile, titre, bouton de fermeture, et le clavier qui va avec.
 *
 * ⚠ Les deux fenêtres de l'application — gabarits et raccourcis — étaient
 * écrites chacune de son côté, et ne se comportaient pas pareil : Échap fermait
 * l'aide mais PAS les gabarits, dont l'état vivait ailleurs. Une fenêtre qui ne
 * se ferme qu'à la souris piège quiconque travaille au clavier. Elles passent
 * désormais toutes deux par ce composant, qui gère pour elles :
 *
 *  — ÉCHAP ferme, toujours ;
 *  — le FOCUS entre dans la fenêtre à l'ouverture, y reste (Tab boucle sur ses
 *    commandes), et revient à l'ouvrir sur l'élément d'origine à la fermeture ;
 *  — le CLAVIER est isolé : tant qu'elle est ouverte, les raccourcis globaux ne
 *    traversent pas jusqu'à l'application. Sans cela, « Ctrl+Z » annulait une
 *    modification du projet caché derrière le voile, et un chiffre changeait
 *    d'onglet sous la fenêtre des gabarits.
 */
export function Modale({
  titre,
  onFermer,
  etroit = false,
  large = false,
  fermerAuClic = true,
  children,
}: {
  titre: string;
  onFermer: () => void;
  etroit?: boolean;
  /** Fenêtre de travail (assistant) plutôt que de choix. */
  large?: boolean;
  /**
   * Un clic sur le voile ferme-t-il ? Non pour un assistant : un clic à côté
   * perdrait cinq étapes de saisie.
   */
  fermerAuClic?: boolean;
  children: ReactNode;
}): JSX.Element {
  const boite = useRef<HTMLDivElement>(null);
  const idTitre = useId();
  /*
   * ⚠ onFermer vit dans une référence : le parent passe souvent une fonction
   * fléchée, nouvelle à chaque rendu. Placée dans les dépendances de l'effet,
   * elle le relançait à chaque frappe — et l'effet, en se relançant, rendait le
   * focus à l'élément d'origine puis le reprenait sur la boîte : le champ en
   * cours de saisie perdait le curseur.
   */
  const fermer = useRef(onFermer);
  fermer.current = onFermer;

  useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null;
    boite.current?.focus();

    const surTouche = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        fermer.current();
        return;
      }
      if (e.key === 'Tab') {
        enfermerLeFocus(e, boite.current);
        return;
      }
      // Tout autre raccourci s'arrête ici : rien ne doit agir derrière le voile.
      if (!(e.target instanceof Node && boite.current?.contains(e.target))) return;
      e.stopImmediatePropagation();
    };
    // Phase de CAPTURE : la fenêtre entend la touche avant l'application.
    window.addEventListener('keydown', surTouche, true);
    return () => {
      window.removeEventListener('keydown', surTouche, true);
      precedent?.focus?.();
    };
    // Une seule fois par ouverture : voir la référence `fermer` ci-dessus.
  }, []);

  return (
    <div className="voile" onClick={fermerAuClic ? onFermer : undefined}>
      <div
        ref={boite}
        className={etroit ? 'dialogue etroit' : large ? 'dialogue large' : 'dialogue'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id={idTitre}>{titre}</h2>
          <button type="button" className="plat" onClick={onFermer} aria-label="Fermer">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Tab et Maj+Tab bouclent sur les commandes de la fenêtre. */
function enfermerLeFocus(e: KeyboardEvent, boite: HTMLElement | null): void {
  if (!boite) return;
  const commandes = [
    ...boite.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])',
    ),
  ];
  if (commandes.length === 0) {
    e.preventDefault();
    return;
  }
  const premier = commandes[0] as HTMLElement;
  const dernier = commandes[commandes.length - 1] as HTMLElement;
  const actif = document.activeElement;
  if (e.shiftKey && (actif === premier || actif === boite)) {
    e.preventDefault();
    dernier.focus();
  } else if (!e.shiftKey && actif === dernier) {
    e.preventDefault();
    premier.focus();
  }
}
