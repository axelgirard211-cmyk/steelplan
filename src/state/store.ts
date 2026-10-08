import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { create } from 'zustand';
import { DEFAULT_PROJECT } from '../core/model/defaults';
import type { ProjectParams } from '../core/model/project';
import { validateProject, type Issue } from '../core/model/validate';

enablePatches();

/**
 * Une entrée d'historique ne stocke PAS un instantané du projet mais la liste
 * des modifications élémentaires (patches) et leur inverse : quelques centaines
 * d'octets par édition au lieu de plusieurs dizaines de kilo-octets. C'est ce
 * qui rend l'annulation illimitée sans coût mémoire.
 */
interface HistoryEntry {
  readonly label: string;
  readonly redo: readonly Patch[];
  readonly undo: readonly Patch[];
}

interface AppState {
  project: ProjectParams;
  issues: readonly Issue[];
  past: readonly HistoryEntry[];
  future: readonly HistoryEntry[];

  /** Applique une modification au projet et l'inscrit dans l'historique. */
  edit(label: string, recipe: (draft: Draft<ProjectParams>) => void): void;
  /** Remplace tout le projet (ouverture de fichier, gabarit) : vide l'historique. */
  loadProject(p: ProjectParams): void;
  undo(): void;
  redo(): void;
}

export const useProjectStore = create<AppState>((set, get) => ({
  project: DEFAULT_PROJECT,
  issues: validateProject(DEFAULT_PROJECT),
  past: [],
  future: [],

  edit(label, recipe) {
    const [next, redo, undo] = produceWithPatches(get().project, recipe);
    if (redo.length === 0) return; // édition sans effet : on n'encombre pas l'historique
    set((s) => ({
      project: next,
      issues: validateProject(next),
      past: [...s.past, { label, redo, undo }],
      future: [],
    }));
  },

  loadProject(p) {
    set({ project: p, issues: validateProject(p), past: [], future: [] });
  },

  undo() {
    const { past, project } = get();
    const last = past[past.length - 1];
    if (!last) return;
    const next = applyPatches(project, last.undo as Patch[]);
    set((s) => ({
      project: next,
      issues: validateProject(next),
      past: past.slice(0, -1),
      future: [last, ...s.future],
    }));
  },

  redo() {
    const { future, project } = get();
    const first = future[0];
    if (!first) return;
    const next = applyPatches(project, first.redo as Patch[]);
    set((s) => ({
      project: next,
      issues: validateProject(next),
      past: [...s.past, first],
      future: future.slice(1),
    }));
  },
}));

/** Sélecteurs utilitaires. */
export const selectCanUndo = (s: AppState): boolean => s.past.length > 0;
export const selectCanRedo = (s: AppState): boolean => s.future.length > 0;
export const selectErrors = (s: AppState): readonly Issue[] =>
  s.issues.filter((i) => i.level === 'erreur');
export const selectWarnings = (s: AppState): readonly Issue[] =>
  s.issues.filter((i) => i.level === 'avertissement');
