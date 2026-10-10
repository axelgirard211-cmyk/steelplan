import type { Ref } from 'react';

/**
 * LIGNE DE COMMANDE — journal des derniers échanges, invite, champ de saisie et
 * barre d'état. Le champ garde le clavier : c'est là que se tapent commandes,
 * coordonnées et valeurs.
 */
export function LigneDeCommande({
  champ,
  journal,
  invite,
  saisie,
  setSaisie,
  auClavier,
  etat,
}: {
  champ: Ref<HTMLInputElement>;
  journal: readonly string[];
  invite: string;
  saisie: string;
  setSaisie: (v: string) => void;
  auClavier: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  etat: string;
}): JSX.Element {
  return (
    <div className="editeur-commande">
      <div className="journal">
        {journal.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <label className="ligne-de-commande">
        <span className="invite">{invite} :</span>
        <input
          ref={champ}
          autoFocus
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          onKeyDown={auClavier}
          aria-label="Ligne de commande"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <div className="etat">{etat}</div>
    </div>
  );
}
