/**
 * The real Project Engine — replaces the `notImplemented` placeholder that
 * shipped with the Studio Shell.
 *
 * The Shell's contract is unchanged: `save` returns a projectId, `load`
 * returns `{ productId, state }` or `null`. Only the body is real now, so
 * nothing that calls it needed to change.
 *
 * ONE CONTRACT REFINEMENT: `state` was typed `unknown` because nothing
 * implemented it. It is now `ProjectEngineState` — the Studio's two pieces
 * of live state plus the product it belongs to. `productId` has to travel
 * with the state because creating a project requires telling Django which
 * product it is, and `load` has to return it so `/project/:id` knows which
 * Product Module to mount.
 *
 * WHEN THIS RUNS: not while editing. Django requires a customer identity
 * for every project endpoint, and identity requires the email collected at
 * checkout, so `save` is called at checkout — after `POST /guest/` — and
 * the Studio keeps personalization in React state until then.
 */

import {
  buildProjectData,
  createProject,
  getProject,
  updateProject,
  type ApiProject,
  type ProjectStatus,
} from "@/lib/api/projects";
import { ApiError } from "@/lib/api/errors";
import type { ProjectEngine, ProjectEngineState } from "@/lib/studio/extension-points";

export const realProjectEngine: ProjectEngine = {
  /**
   * Creates on first save, updates thereafter. The Studio holds the
   * complete state, and the backend replaces `data` wholesale rather than
   * merging, so sending all of it is both correct and simplest.
   */
  async save(projectId: string | undefined, state: ProjectEngineState): Promise<{ projectId: string }> {
    const data = buildProjectData(state.values, state.themeSelections);

    const project: ApiProject = projectId
      ? await updateProject(projectId, { data, ...(state.status ? { status: state.status } : {}) })
      : await createProject(state.productId, data, state.status ?? "draft");

    return { projectId: project.projectId };
  },

  /**
   * Returns `null` for a project that does not exist or is not this
   * guest's, so the Shell can render its existing "project unavailable"
   * state rather than crash. The 403/404 distinction the backend
   * deliberately preserves is not surfaced here yet — how a returning
   * customer re-identifies to reach their own project is a Step 9
   * decision, and inventing a behaviour now would prejudge it.
   *
   * Any other failure (network, 5xx) is rethrown: that is not "no such
   * project", and silently showing an empty Studio would lose real work.
   */
  async load(projectId: string): Promise<{ productId: string; state: ProjectEngineState } | null> {
    try {
      const project = await getProject(projectId);
      return {
        productId: project.productId,
        state: {
          productId: project.productId,
          values: project.data.values,
          themeSelections: project.data.themeSelections,
          status: project.status,
        },
      };
    } catch (error) {
      if (error instanceof ApiError && (error.isNotFound || error.isAccessDenied || error.isIdentityRequired)) {
        return null;
      }
      throw error;
    }
  },
};

export type { ProjectStatus };
