/**
 * ICÔNES DE L'INTERFACE — traits simples, à la couleur du texte.
 *
 * Dessinées ici plutôt que tirées d'une bibliothèque : une douzaine de pictos ne
 * justifient pas une dépendance, et un trait de 1,6 sur une grille de 20 reste
 * net à toutes les tailles d'écran.
 */

function Icone({ children, taille = 18 }: { children: JSX.Element | JSX.Element[]; taille?: number }): JSX.Element {
  return (
    <svg
      className="icone"
      width={taille}
      height={taille}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** La marque : un portique à deux versants. */
export function Marque({ taille = 26 }: { taille?: number }): JSX.Element {
  return (
    <svg className="marque-svg" width={taille} height={taille} viewBox="0 0 26 26" aria-hidden="true">
      <rect x="0" y="0" width="26" height="26" rx="7" fill="var(--accent)" />
      <path d="M6 20V11l7-5 7 5v9" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M6 14h14" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

export const IconeProjet = (): JSX.Element => (
  <Icone>
    <path d="M3 16.5 4 13 13.5 3.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L7 16l-4 .5Z" />
    <path d="m12 5 3 3" />
  </Icone>
);

export const IconeCube = (): JSX.Element => (
  <Icone>
    <path d="M10 2.5 17 6v8l-7 3.5L3 14V6l7-3.5Z" />
    <path d="M3 6l7 3.5L17 6M10 9.5v8" />
  </Icone>
);

export const IconeVerification = (): JSX.Element => (
  <Icone>
    <path d="M10 2.5 16.5 5v4.5c0 4-2.8 6.6-6.5 8-3.7-1.4-6.5-4-6.5-8V5L10 2.5Z" />
    <path d="m7 10 2.2 2.2L13.5 8" />
  </Icone>
);

export const IconePlans = (): JSX.Element => (
  <Icone>
    <rect x="3" y="3.5" width="14" height="13" rx="1.5" />
    <path d="M3 13h14M11 13v3.5M6 7h5M6 9.5h3" />
  </Icone>
);

export const IconeListe = (): JSX.Element => (
  <Icone>
    <path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9" />
    <path d="M3.5 5.5h.5M3.5 10h.5M3.5 14.5h.5" />
  </Icone>
);

export const IconeEdition = (): JSX.Element => (
  <Icone>
    <path d="M3 17h14" />
    <path d="M5 13.5 13 5.5l2 2-8 8H5v-2Z" />
  </Icone>
);

export const IconeProfil = (): JSX.Element => (
  <Icone>
    <path d="M4 3.5h12M4 16.5h12M10 3.5v13" />
  </Icone>
);

export const IconeAnnuler = (): JSX.Element => (
  <Icone taille={16}>
    <path d="M7 4 3.5 7.5 7 11" />
    <path d="M3.5 7.5H12a4.5 4.5 0 0 1 0 9H9" />
  </Icone>
);

export const IconeRetablir = (): JSX.Element => (
  <Icone taille={16}>
    <path d="m13 4 3.5 3.5L13 11" />
    <path d="M16.5 7.5H8a4.5 4.5 0 0 0 0 9h3" />
  </Icone>
);
