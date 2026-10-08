/**
 * Django project persistence.
 *
 * `data` has exactly one approved shape, enforced by both a service-layer
 * validator and database CHECK constraints:
 *
 *     { version: 1, values: {...}, themeSelections: {...} }
 *
 * `values` and `themeSelections` are deliberately opaque to the backend —
 * it never inspects or reshapes them. That is why this module needs no
 * per-product branching: Love Story Timeline's `TimelineValues` and Where
 * We Met's `MapValues` travel through the same endpoint untouched, and a
 * future product needs no backend change at all.
 *
 * IDENTITY IS REQUIRED. Every endpoint here resolves the session customer
 * and returns 401 `customer_identity_required` without one, which is only
 * established by `POST /guest/ {email}`. Per the approved flow, projects
 * are therefore persisted at checkout — after the email step — and the
 * Studio holds personalization in local React state until then.
 */

import { apiFetch } from "./client";

export const PROJECT_DATA_VERSION = 1;

/** The exact top-level shape the backend accepts. Extra or missing keys
 * are rejected with `invalid_project_data`. */
export interface ProjectData {
  version: number;
  values: Record<string, unknown>;
  /** `string | number` because theme axes include ranges as well as
   * discrete options (see `ThemeSelections`). Django stores this opaquely,
   * so both round-trip unchanged. */
  themeSelections: Record<string, string | number>;
}

export type ProjectStatus = "draft" | "completed";

/** Mirrors `apps/projects/serializers.py::ProjectSerializer`. */
export interface ApiProject {
  id: string;
  projectId: string;
  /** The Django product slug (`heart-map`), never the public URL slug. */
  productId: string;
  data: ProjectData;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export function buildProjectData(
  values: Record<string, unknown>,
  themeSelections: Record<string, string | number>
): ProjectData {
  return { version: PROJECT_DATA_VERSION, values, themeSelections };
}

/**
 * `backendProductId` must be the Django slug — use `toBackendProductId()`.
 * Passing the public `where-we-met` would fail with `product_not_found`.
 */
export async function createProject(
  backendProductId: string,
  data: ProjectData,
  status: ProjectStatus = "draft",
  signal?: AbortSignal
): Promise<ApiProject> {
  return apiFetch<ApiProject>("/projects", {
    method: "POST",
    body: { productId: backendProductId, data, status },
    signal,
  });
}

export async function getProject(projectId: string, signal?: AbortSignal): Promise<ApiProject> {
  return apiFetch<ApiProject>(`/projects/${projectId}`, { method: "GET", signal });
}

/**
 * Partial update. `data` is replaced wholesale when supplied — the backend
 * does not merge, so callers send the complete current state.
 */
export async function updateProject(
  projectId: string,
  update: { data?: ProjectData; status?: ProjectStatus },
  signal?: AbortSignal
): Promise<ApiProject> {
  return apiFetch<ApiProject>(`/projects/${projectId}`, { method: "PATCH", body: update, signal });
}

export async function deleteProject(projectId: string, signal?: AbortSignal): Promise<void> {
  await apiFetch<void>(`/projects/${projectId}`, { method: "DELETE", parse: "none", signal });
}
