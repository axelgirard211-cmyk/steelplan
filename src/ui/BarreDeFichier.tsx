import { useCallback, useEffect, useRef, useState } from 'react';
import { FormatError } from '../core/io/serialize';
import { creerAutosave, oublierAuto, relireAuto, type Autosave } from '../core/io/storage';
import { avecGrilleEntreprise } from '../core/io/grilleEntreprise';
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
  const [enregistreA, setEnregistreA] = useState<number | null>(null);

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
    // ⚠ Toute première visite, sans travail à restaurer : l'assistant s'ouvre
    // de lui-même, une fois. Ensuite, il attend derrière « Nouveau ».
    else if (premiereVisite()) setAssistant(true);
  }, []);

  /* --- Enregistrement automatique à chaque changement --- */
  useEffect(() => {
    autosave.current.planifier(project, nbEditions);
  }, [project, nbEditions]);

  /* --- Filet de fermeture : enregistrer, et prévenir --- */
  useEffect(() => {
    const avantFermeture = (e: BeforeUnloadEvent): void => {
      autosave.current.immediat(project, nbEditions);
      if (nbEditions > 0 && enregistreA === null) {
        e.preventDefault();
        // Les navigateurs imposent leur propre texte ; il suffit d'annuler.
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', avantFermeture);
    return () => window.removeEventListener('beforeunload', avantFermeture);
  }, [project, nbEditions, enregistreA]);

  const signaler = useCallback((texte: string, erreur = false): void => {
    setMessage({ texte, erreur });
    setTimeout(() => setMessage(null), erreur ? 8000 : 3500);
  }, []);

  const faireEnregistrer = useCallback(
    async (sous: boolean): Promise<void> => {
      try {
        const r = await enregistrer(project, sous);
        if (r === 'annule') return;
        setEnregistreA(Date.now());
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
    if (nbEditions > 0 && !confirm(`Abandonner ${nbEditions} modification(s) en cours ?`)) return;
    try {
      const p = await ouvrir();
      if (!p) return;
      loadProject(p);
      setEnregistreA(Date.now());
      setARestaurer(null);
      signaler(`Projet « ${p.meta.nom} » ouvert.`);
    } catch (e) {
      signaler(
        e instanceof FormatError ? e.message : `Ouverture impossible : ${(e as Error).message}`,
        true,
      );
    }
  }, [loadProject, nbEditions, signaler]);

  const appliquerGabarit = useCallback(
    (t: Template): void => {
      // Un nouveau projet part avec les prix de l'entreprise, s'ils sont mémorisés.
      loadProject(avecGrilleEntreprise(t.build()));
      oublierFichierCourant();
      setEnregistreA(null);
      setGabarits(false);
      setARestaurer(null);
      signaler(`Gabarit « ${t.nom} » chargé.`);
    },
    [loadProject, signaler],
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

  const modifie = nbEditions > 0;

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
        title="Ctrl+S"
      >
        Enregistrer{modifie && enregistreA === null ? ' •' : ''}
      </button>

      <GabaritsDialog
        ouvert={gabarits}
        travauxEnCours={nbEditions}
        onChoisir={appliquerGabarit}
        onAssistant={() => {
          setGabarits(false);
          setAssistant(true);
        }}
        onFermer={() => setGabarits(false)}
      />
      {assistant && (
        <Assistant
          travauxEnCours={nbEditions}
          onCreer={(p) => {
            loadProject(avecGrilleEntreprise(p));
            oublierFichierCourant();
            setEnregistreA(null);
            setARestaurer(null);
            setAssistant(false);
            signaler(`Projet « ${p.meta.nom || 'sans nom'} » créé.`);
          }}
          onFermer={() => setAssistant(false)}
        />
      )}

      {message ? (
        <span className={message.erreur ? 'notice erreur' : 'notice'} role="status">
          {message.texte}
        </span>
      ) : (
        <span className="notice discret">
          {autosave.current.disponible
            ? 'Sauvegarde automatique active'
            : 'Sauvegarde automatique indisponible sur ce navigateur'}
        </span>
      )}

      {aRestaurer ? (
        <div className="banniere" role="status">
          <span>
            Travail non enregistré retrouvé ({depuis(aRestaurer.at)}, {aRestaurer.edits}{' '}
            modification(s)) : « {aRestaurer.project.meta.nom} ».
          </span>
          <button
            type="button"
            className="primaire"
            onClick={() => {
              loadProject(aRestaurer.project);
              setARestaurer(null);
              signaler('Session restaurée.');
            }}
          >
            Restaurer
          </button>
          <button
            type="button"
            className="plat"
            onClick={() => {
              oublierAuto();
              setARestaurer(null);
            }}
          >
            Ignorer
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
