import { useState, type ReactNode } from 'react';
import { useAffichage } from '../state/affichage';

/**
 * RÉGLAGES FINS d'une fiche, repliés dans l'affichage « essentiel ».
 *
 * Une fiche courante se lit en quatre lignes — profils, nuance, appuis ; les
 * jarrets, la panne faîtière ou la course des oblongs sont de vrais réglages,
 * mais qu'on touche une fois par projet. Repliés, ils gardent leur valeur et
 * s'ouvrent d'un clic ; en affichage complet, ils sont toujours dépliés.
 *
 * ⚠ À placer dans un `dl.paires`, APRÈS les lignes essentielles d'un groupe :
 * la ligne du repli occupe toute la largeur et n'est jamais prise pour le
 * libellé des sous-lignes « — … » qui la suivent (voir `libelleDeLaLigne`).
 */
export function ReglagesFins({ quoi, children }: { quoi: string; children: ReactNode }): JSX.Element {
  const complet = useAffichage((s) => s.complet);
  const [ouvert, setOuvert] = useState(false);
  if (complet) return <>{children}</>;
  return (
    <>
      {ouvert && children}
      <dt className="reglages-fins">
        <button type="button" className="lien-fin" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
          {ouvert ? '▾ Masquer les réglages fins' : `▸ Réglages fins — ${quoi}`}
        </button>
      </dt>
    </>
  );
}
