import {
  PROJECT_EXTENSION,
  PROJECT_MIME,
  deserializeProject,
  serializeProject,
} from '../core/io/serialize';
import type { ProjectParams } from '../core/model/project';

/**
 * ENREGISTREMENT ET OUVERTURE DE FICHIER.
 *
 * Deux chemins, et le choix se fait sur ce que le navigateur sait faire :
 *
 *  - `showSaveFilePicker` (File System Access) permet de RÉENREGISTRER dans le
 *    même fichier. C'est ce qu'on attend d'un logiciel de dessin : après dix
 *    modifications, on veut un fichier, pas dix fichiers numérotés dans le
 *    dossier des téléchargements.
 *  - sinon, téléchargement classique. Chaque enregistrement crée un fichier ;
 *    c'est le comportement dégradé, et l'interface le dit.
 *
 * Aucune de ces API n'est disponible en test : le module reste donc réduit à
 * l'enveloppe, la logique de format vivant dans `core/io`.
 */

interface FileSystemHandleLike {
  createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
  getFile: () => Promise<File>;
  readonly name: string;
}

type PickerOptions = {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
};

const FILTRE = [
  { description: 'Projet SteelPlan', accept: { [PROJECT_MIME]: [PROJECT_EXTENSION] } },
] satisfies NonNullable<PickerOptions['types']>;

function api(): {
  save?: (o: PickerOptions) => Promise<FileSystemHandleLike>;
  open?: (o: PickerOptions) => Promise<FileSystemHandleLike[]>;
} {
  const w = window as unknown as {
    showSaveFilePicker?: (o: PickerOptions) => Promise<FileSystemHandleLike>;
    showOpenFilePicker?: (o: PickerOptions) => Promise<FileSystemHandleLike[]>;
  };
  return { ...(w.showSaveFilePicker ? { save: w.showSaveFilePicker } : {}), ...(w.showOpenFilePicker ? { open: w.showOpenFilePicker } : {}) };
}

/** Le navigateur sait-il réenregistrer dans le même fichier ? */
export function reenregistrementPossible(): boolean {
  return api().save !== undefined;
}

/** Nom de fichier tiré du nom du projet, débarrassé de ce qui gêne un système de fichiers. */
export function nomDeFichier(p: ProjectParams): string {
  const base = (p.meta.nom || 'projet')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${base || 'projet'}${PROJECT_EXTENSION}`;
}

/** Poignée du fichier courant, pour que « Enregistrer » n'ouvre pas de dialogue. */
let courant: FileSystemHandleLike | null = null;

export function fichierCourant(): string | null {
  return courant?.name ?? null;
}

export function oublierFichierCourant(): void {
  courant = null;
}

export type ResultatEnregistrement = 'enregistre' | 'annule' | 'telecharge';

/**
 * Enregistre le projet. `forcerDialogue` correspond à « Enregistrer sous ».
 */
export async function enregistrer(
  p: ProjectParams,
  forcerDialogue = false,
): Promise<ResultatEnregistrement> {
  const texte = serializeProject(p);
  const { save } = api();

  if (save) {
    try {
      const poignee =
        !forcerDialogue && courant
          ? courant
          : await save({ suggestedName: nomDeFichier(p), types: FILTRE });
      const flux = await poignee.createWritable();
      await flux.write(texte);
      await flux.close();
      courant = poignee;
      return 'enregistre';
    } catch (e) {
      // L'utilisateur a fermé le sélecteur : ce n'est pas une erreur.
      if (e instanceof DOMException && e.name === 'AbortError') return 'annule';
      throw e;
    }
  }

  telecharger(texte, nomDeFichier(p));
  return 'telecharge';
}

function telecharger(texte: string, nom: string): void {
  const url = URL.createObjectURL(new Blob([texte], { type: PROJECT_MIME }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Ouvre un projet. Renvoie `null` si l'utilisateur a renoncé.
 *
 * Les erreurs de format remontent telles quelles : un fichier corrompu doit
 * produire un message précis, pas un projet à moitié relu.
 */
export async function ouvrir(): Promise<ProjectParams | null> {
  const { open } = api();
  if (open) {
    try {
      const [poignee] = await open({ types: FILTRE });
      if (!poignee) return null;
      const texte = await (await poignee.getFile()).text();
      const { project } = deserializeProject(texte);
      courant = poignee;
      return project;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }

  const texte = await choisirParInput();
  if (texte === null) return null;
  courant = null; // sans poignée, « Enregistrer » redemandera où écrire
  return deserializeProject(texte).project;
}

/** Repli : un `input[type=file]` masqué. */
function choisirParInput(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_EXTENSION},application/json`;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) {
        resolve(null);
        return;
      }
      f.text().then(resolve, () => resolve(null));
    };
    // Un `input` annulé n'émet aucun événement fiable partout : on ne promet
    // donc rien de plus que « soit un fichier, soit rien ».
    input.click();
  });
}
