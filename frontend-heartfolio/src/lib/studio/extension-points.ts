import { realProjectEngine } from "@/lib/studio/engines/project-engine";
import type {
  ExportFormat,
  FormSchemaConfig,
  PricingConfig,
  PricingResult,
  ThemeEngineConfig,
  ValidationResult,
} from "@/types/studio";

/**
 * Engine interfaces for the Studio Runtime. Per the ownership split:
 * the Shell owns *how* these run (generic, product-agnostic
 * implementations live alongside this file — `form-engine.ts`,
 * `pricing-engine.ts`, `export-engine.ts`); a Product Module only ever
 * supplies *data* (`FormSchemaConfig`, `PricingConfig`, ...), never a
 * competing implementation of these interfaces.
 *
 * `FormEngine` intentionally has no `renderFields` method. An earlier
 * draft returned `unknown` from it, which begged the question of what
 * rendered that value — in practice "generate the Content panel's UI
 * from a schema" is Shell UI (`components/studio/generic-form`), not
 * engine logic, so it doesn't belong on this interface at all.
 */
export interface FormEngine {
  validate(schema: FormSchemaConfig, values: unknown): ValidationResult;
}

export interface ThemeEngine {
  /** Merges every axis's selected tokens (discrete) or transformed value
   * (range) into a single CSS-custom-property map handed to the
   * renderer. Structural axis selections (layout, frame, format) are
   * *not* included here — those are read directly from
   * `ThemeSelections` by the Product Module's renderer. */
  resolveTokens(config: ThemeEngineConfig, selections: Record<string, string | number>): Record<string, string>;
}

export interface PricingEngine {
  computeTotal(config: PricingConfig, context: { values: unknown; theme: Record<string, string | number> }): PricingResult;
}

export interface AssetManager {
  upload(file: File): Promise<{ assetId: string; url: string; mimeType: string; filename: string }>;
  remove(assetId: string): Promise<void>;
}

/**
 * Persists and restores in-progress projects. IMPLEMENTED — see
 * `lib/studio/engines/project-engine.ts`, backed by Django's
 * `/projects/` endpoints.
 *
 * `state` was `unknown` while this was a placeholder; it is now a concrete
 * type, because creating a project requires telling the backend which
 * product it belongs to, and loading one has to report that back so the
 * right Product Module can be mounted.
 */
export interface ProjectEngineState {
  /** The Django product slug (`heart-map`), not the public URL slug. */
  productId: string;
  values: Record<string, unknown>;
  themeSelections: Record<string, string | number>;
  status?: "draft" | "completed";
}

export interface ProjectEngine {
  save(projectId: string | undefined, state: ProjectEngineState): Promise<{ projectId: string }>;
  load(projectId: string): Promise<{ productId: string; state: ProjectEngineState } | null>;
}

/**
 * Payment + order flow. IMPLEMENTED, but not through this interface —
 * `lib/studio/engines/checkout-engine.ts` orchestrates it directly.
 *
 * The single-call `startCheckout(session) -> { redirectUrl }` shape was
 * written for a redirect-style provider. The real flow neither redirects
 * (Paddle opens an overlay in place) nor happens in one step: it identifies
 * the guest, uploads photos, saves the project, creates a server-priced
 * order and only then starts payment, reporting progress at each stage. The
 * interface is kept here as the documented extension point, unimplemented,
 * rather than being contorted into a shape the real provider doesn't have.
 */
export interface CheckoutEngine {
  startCheckout(session: unknown): Promise<{ redirectUrl: string }>;
}

/**
 * REMOVED IMPLEMENTATION — the interface stays as a documented extension
 * point; nothing implements it.
 *
 * Client-side rasterization used to produce the customer's deliverables in
 * the browser, which meant the finished files could be downloaded for free
 * before paying. Real deliverables are rendered server-side by Django from
 * the saved project and released only against a paid entitlement, so a
 * browser-side exporter is not just unnecessary but a way to give the
 * product away.
 */
export interface ExportEngine {
  exportNode(node: HTMLElement, format: ExportFormat): Promise<{ blob: Blob; filename: string }>;
}

function notImplemented(engine: string): never {
  throw new Error(
    `${engine} is not implemented yet. This is a Studio Shell extension ` +
      `point — see STUDIO_INTEGRATION_GUIDE.md and lib/studio/module-loader.ts.`
  );
}

/** Real, Django-backed. Exported from here so every existing import of
 * `projectEngine` keeps working untouched. */
export const projectEngine: ProjectEngine = realProjectEngine;

export const checkoutEngine: CheckoutEngine = {
  startCheckout: async () => notImplemented("CheckoutEngine.startCheckout"),
};
