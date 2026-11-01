import { useCallback, useEffect, useRef, useState } from 'react';
import { FormatError } from '../core/io/serialize';
import { creerAutosave, oublierAuto, relireAuto, type Autosave } from '../core/io/storage';
import { avecGrilleEntreprise } from '../core/io/grilleEntreprise';
import type { ProjectParams } from '../core/model/project';
import type { Template } from '../core/model/templates';
import { useProjectStore } from '../state/store';
import { GabaritsDialog } from './GabaritsDialog';
import { Assistant } from './assistant/Assistant';
import { enregistrer, fichierCourant, oublierFichierCourant, ouvrir } from './fichier';

/**
 * ACTIONS FICHIER ET SAUVEGARDE AUTOMATIQUE.
 *
 * Trois exigences tenues ici :
 *  - l'autosave est un FILET, jamais un obstacle : elle ne bloque rien et son
 *    indisponibilité est dite, pas cachée ;
 *  - la restauration est PROPOSÉE, jamais imposée : écraser silencieusement le
 *    projet ouvert avec une session précédente serait pire que de la perdre ;
 *  - quitter avec des modifications non enregistrées demande confirmation.
 */
export function BarreDeFichier({
  demandeGabarits,
  onGabaritsTraites,
}: {
  /** Le raccourci Ctrl+N passe par ici plutôt que de dupliquer la logique. */
  demandeGabarits: number;
  onGabaritsTraites: () => void;
}): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const loadProject = useProjectStore((s) => s.loadProject);
  const nbEditions = useProjectStore((s) => s.past.length);

  const [gabarits, setGabarits] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [aRestaurer, setARestaurer] = useState<Autosave | null>(null);
  /*
   * ⚠ « MODIFIÉ » NE SE DÉDUIT PAS DE L'HISTORIQUE. On testait « des éditions,
   * et jamais enregistré » : après un premier enregistrement, plus rien n'était
   * signalé, et une heure de travail se perdait en fermant l'onglet sans un mot.
   * On retient donc le projet tel qu'il est dans son fichier, et on compare.
   * `horsFichier` couvre la session restaurée : sans historique, elle n'existe
   * pourtant dans aucun fichier.
   */
  const [reference, setReference] = useState<ProjectParams | null>(null);
  const [horsFichier, setHorsFichier] = useState(false);
  /*
   * ⚠ Tant que l'utilisateur n'a pas répondu à « Restaurer ? », l'autosave se
   * tait : elle écrasait la session retrouvée par le projet par défaut 1,5 s
   * après l'ouverture — un rechargement à ce moment, et tout était perdu.
   */
  const [pret, setPret] = useState(false);
  const modifie = reference ? project !== reference : nbEditions > 0 || horsFichier;
  // Ce que l'autosave retient : une session sans modification ne vaut pas d'être proposée.
  const aSauver = modifie ? Math.max(nbEditions, 1) : 0;

  const autosave = useRef(creerAutosave());

  // Le raccourci clavier ouvre le sélecteur de gabarits.
  useEffect(() => {
    if (demandeGabarits > 0) {
      setGabarits(true);
      onGabaritsTraites();
    }
  }, [demandeGabarits, onGabaritsTraites]);

  /* --- Restauration au démarrage --- */
  useEffect(() => {
    const trouve = relireAuto();
    // On ne propose que s'il y avait un travail commencé : restaurer un projet
    // par défaut intact n'apporte rien et transforme l'ouverture en question.
    if (trouve && trouve.edits > 0) setARestaurer(trouve);
    else {
      setPret(true);
      // ⚠ Toute première visite, sans travail à restaurer : l'assistant s'ouvre
      // de lui-même, une fois. Ensuite, il attend derrière « Nouveau ».
      if (premiereVisite()) setAssistant(true);
    }
  }, []);

  /* --- Enregistrement automatique à chaque changement --- */
  useEffect(() => {
    if (pret) autosave.current.planifier(project, aSauver);
  }, [project, aSauver, pret]);

  /* --- Filet de fermeture : enregistrer, et prévenir --- */
  useEffect(() => {
    const avantFermeture = (e: BeforeUnloadEvent): void => {
      if (pret) autosave.current.immediat(project, aSauver);
      if (modifie) {
        e.preventDefault();
        // Les navigateurs imposent leur propre texte ; il suffit d'annuler.
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', avantFermeture);
    return () => window.removeEventListener('beforeunload', avantFermeture);
  }, [project, aSauver, modifie, pret]);

  /*
   * Une confirmation s'efface d'elle-même ; une ERREUR reste jusqu'à ce qu'on la
   * ferme — partie au bout de 8 s, elle pouvait n'avoir jamais été lue.
   */
  const minuterie = useRef<ReturnType<typeof setTimeout>>();
  const signaler = useCallback((texte: string, erreur = false): void => {
    clearTimeout(minuterie.current);
    setMessage({ texte, erreur });
    if (!erreur) minuterie.current = setTimeout(() => setMessage(null), 3500);
  }, []);

  /** Un projet remplace le courant : la question de restauration est tranchée. */
  const charger = useCallback(
    (p: ProjectParams, ref: ProjectParams | null): void => {
      loadProject(p);
      setReference(ref);
      setHorsFichier(false);
      setARestaurer(null);
      setPret(true);
    },
    [loadProject],
  );

  const faireEnregistrer = useCallback(
    async (sous: boolean): Promise<void> => {
      try {
        const r = await enregistrer(project, sous);
        if (r === 'annule') return;
        setReference(project);
        setHorsFichier(false);
        signaler(
          r === 'telecharge'
            ? 'Projet téléchargé. Ce navigateur ne sait pas réenregistrer dans le même fichier.'
            : `Enregistré dans ${fichierCourant() ?? 'le fichier choisi'}.`,
        );
      } catch (e) {
        signaler(`Enregistrement impossible : ${(e as Error).message}`, true);
      }
    },
    [project, signaler],
  );

  const faireOuvrir = useCallback(async (): Promise<void> => {
    if (
      modifie &&
      !confirm('Le projet en cours a des modifications non enregistrées. Les abandonner pour ouvrir un autre fichier ?')
    )
      return;
    try {
      const p = await ouvrir();
      if (!p) return;
      charger(p, p);
      signaler(`Projet « ${p.meta.nom} » ouvert.`);
    } catch (e) {
      signaler(
        e instanceof FormatError ? e.message : `Ouverture impossible : ${(e as Error).message}`,
        true,
      );
    }
  }, [charger, modifie, signaler]);

  const appliquerGabarit = useCallback(
    (t: Template): void => {
      // Un nouveau projet part avec les prix de l'entreprise, s'ils sont mémorisés.
      charger(avecGrilleEntreprise(t.build()), null);
      oublierFichierCourant();
      setGabarits(false);
      signaler(`Gabarit « ${t.nom} » chargé.`);
    },
    [charger, signaler],
  );

  // Exposé au reste de l'application par les raccourcis clavier.
  useEffect(() => {
    const actions: Record<string, () => void> = {
      'steelplan:enregistrer': () => void faireEnregistrer(false),
      'steelplan:enregistrer-sous': () => void faireEnregistrer(true),
      'steelplan:ouvrir': () => void faireOuvrir(),
    };
    const ecouteurs = Object.entries(actions).map(([nom, fn]) => {
      const h = (): void => fn();
      window.addEventListener(nom, h);
      return () => window.removeEventListener(nom, h);
    });
    return () => ecouteurs.forEach((off) => off());
  }, [faireEnregistrer, faireOuvrir]);

  return (
    <>
      <button type="button" className="plat" onClick={() => setGabarits(true)} title="Ctrl+N">
        Nouveau
      </button>
      <button type="button" className="plat" onClick={() => void faireOuvrir()} title="Ctrl+O">
        Ouvrir
      </button>
      <button
        type="button"
        className="primaire"
        onClick={() => void faireEnregistrer(false)}
        title={modifie ? 'Modifications non enregistrées — Ctrl+S' : 'Ctrl+S'}
      >
        Enregistrer{modifie ? ' •' : ''}
      </button>

      <GabaritsDialog
        ouvert={gabarits}
        travauxEnCours={aSauver}
        onChoisir={appliquerGabarit}
        onAssistant={() => {
          setGabarits(false);
          setAssistant(true);
        }}
        onFermer={() => setGabarits(false)}
      />
      {assistant && (
        <Assistant
          travauxEnCours={aSauver}
          onCreer={(p, remarque) => {
            charger(avecGrilleEntreprise(p), null);
            oublierFichierCourant();
            setAssistant(false);
            signaler(`Projet « ${p.meta.nom || 'sans nom'} » créé.${remarque ? ` ${remarque}` : ''}`, Boolean(remarque));
          }}
          onFermer={() => setAssistant(false)}
        />
      )}

      {/* Régions toujours présentes : un lecteur d'écran n'annonce que ce qui
          CHANGE dans une région déjà là, pas une région qui apparaît. */}
      <span role="alert" className={message?.erreur ? 'notice erreur' : 'visually-hidden'}>
        {message?.erreur ? message.texte : ''}
        {message?.erreur && (
          <button type="button" className="plat fermer-notice" aria-label="Fermer le message" onClick={() => setMessage(null)}>
            ✕
          </button>
        )}
      </span>
      <span role="status" className={message && !message.erreur ? 'notice' : 'notice discret'}>
        {message && !message.erreur
          ? message.texte
          : message
            ? ''
            : autosave.current.disponible
              ? 'Sauvegarde automatique active'
              : 'Sauvegarde automatique indisponible sur ce navigateur'}
      </span>

      {aRestaurer ? (
        <div className="banniere" role="region" aria-label="Travail retrouvé">
          <span>
            Travail non enregistré retrouvé ({depuis(aRestaurer.at)}, {aRestaurer.edits}{' '}
            modification(s)) : « {aRestaurer.project.meta.nom} ».
          </span>
          <button
            type="button"
            className="primaire"
            onClick={() => {
              charger(aRestaurer.project, null);
              setHorsFichier(true);
              signaler('Session restaurée. Pensez à l’enregistrer dans un fichier.');
            }}
          >
            Restaurer
          </button>
          <button
            type="button"
            className="plat"
            title="La session retrouvée est supprimée définitivement"
            onClick={() => {
              oublierAuto();
              setARestaurer(null);
              setPret(true);
            }}
          >
            Abandonner ce travail
          </button>
        </div>
      ) : null}
    </>
  );
}

/** « il y a 12 min », sans dépendance de formatage de dates. */
function depuis(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'il y a moins d’une minute';
  const min = Math.round(s / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}

const CLE_ACCUEIL = 'steelplan.accueil';

/** Première visite sur ce navigateur ? Elle n'est vraie qu'une fois. */
function premiereVisite(): boolean {
  try {
    if (localStorage.getItem(CLE_ACCUEIL)) return false;
    localStorage.setItem(CLE_ACCUEIL, '1');
    return true;
  } catch {
    // Stockage refusé : on ne saurait pas s'en souvenir, on n'impose rien.
    return false;
  }
}
