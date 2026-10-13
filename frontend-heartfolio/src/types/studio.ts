import type { ComponentType, RefObject } from "react";
import type { ProductEntry } from "@/lib/products/types";

/* ============================================================
 * Shared Condition type
 * ------------------------------------------------------------
 * Originally introduced only for pricing rules. Field/axis
 * visibility needs the exact same "read a dot-path, compare it"
 * primitive, so it's promoted here and reused by both — one
 * evaluator (`lib/studio/conditions.ts`), not two.
 * ============================================================ */

export interface Condition {
  /** Dot-path into the evaluation context, e.g. "values.premiumModule"
   * or "theme.format". */
  path: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "includes" | "exists";
  value?: unknown;
}

/** @deprecated use `Condition` — kept as an alias so existing pricing
 * code reads naturally without a second type. */
export type PricingCondition = Condition;

/* ============================================================
 * Localization
 * ------------------------------------------------------------
 * Every string a person sees (field labels, axis/option labels,
 * pricing line items, export format names) is a *translation
 * key* resolved against the Product Module's own message
 * dictionary — not a literal string. A module owns its content
 * exactly like it owns its schema/pricing/etc; the Shell never
 * needs a central messages file touched to add a product. Keys
 * that aren't found fall back to the raw key itself, so a
 * missing translation degrades to visible-but-ugly rather than
 * a crash.
 * ============================================================ */

export type LocaleCode = "en" | "fr" | "ar";

export type MessageDictionary = Record<string, string>;

export type ProductModuleMessages = Partial<Record<LocaleCode, MessageDictionary>>;

/* ============================================================
 * Form Schema
 * ------------------------------------------------------------
 * Open, extensible field vocabulary. `type` is a string, not a
 * closed union, so a Product Module can introduce a field type
 * the Shell doesn't have a renderer for yet (location,
 * coordinates, richText, ...) without a type-level change here.
 * `GenericForm` falls back to an "unsupported field" placeholder
 * for any `type` it doesn't recognize, so registering a schema
 * never crashes the Shell.
 * ============================================================ */

export interface FieldSchemaBase {
  id: string;
  /** Translation key into the module's `messages` dictionary. */
  label: string;
  type: string;
  required?: boolean;
  /** Translation key. */
  helpText?: string;
  /** Value a freshly-added item gets (only meaningful for fields nested
   * inside a `group`'s `itemFields` — top-level defaults come from
   * `createInitialState`). */
  defaultValue?: unknown;
  /** Only rendered when every condition holds against `{ values, theme }`.
   * Omitted = always visible. */
  visibleWhen?: Condition[];
}

export interface TextFieldSchema extends FieldSchemaBase {
  type: "text" | "textarea";
  maxLength?: number;
  /** Translation key. */
  placeholder?: string;
}

export interface DateFieldSchema extends FieldSchemaBase {
  type: "date";
}

export interface BooleanFieldSchema extends FieldSchemaBase {
  type: "boolean";
}

export interface SelectOption {
  value: string;
  /** Translation key. */
  label: string;
}

export interface SelectFieldSchema extends FieldSchemaBase {
  type: "select" | "multiSelect";
  options: SelectOption[];
}

export interface RangeFieldSchema extends FieldSchemaBase {
  type: "range";
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

/** Covers every uploadable media kind, not just photos — a single
 * "image"-only type was the concrete gap found in the architecture
 * review (Song Poster needs audio; a Digital Love Letter might want a
 * voice memo or video). `accept` overrides the kind-based default file
 * picker filter when a module needs something more specific. */
export interface MediaFieldSchema extends FieldSchemaBase {
  type: "image" | "gallery" | "audio" | "video" | "file";
  maxItems?: number;
  accept?: string;
  /**
   * `audio` only. An audio field is RECORD-ONLY by default (Love Story
   * Timeline's voice note: "a message you would like them to hear" should
   * not be satisfied by any audio file lying around). A product whose audio
   * is something the customer RECEIVED from someone else — Graduation
   * Keepsake's voice messages arrive as WhatsApp/iPhone files — sets this to
   * add a file picker beside the recorder.
   */
  allowUpload?: boolean;
  /**
   * `audio` only. A recording stops by itself at this length, and an
   * uploaded file longer than this is refused at pick time. The backend
   * enforces its own cap (`MAX_AUDIO_SECONDS`) authoritatively; this is so
   * the customer finds out immediately, not at checkout.
   */
  maxSeconds?: number;
}

export interface GroupFieldSchema extends FieldSchemaBase {
  type: "group";
  minItems: number;
  maxItems: number;
  itemFields: FieldSchema[];
}

/** §6 — a real place: `{ name, lat, lng, mapboxId? }`, from a Mapbox
 * search (`field-inputs.tsx`'s `LocationFieldInput`). Also accepts a plain
 * string for a milestone saved before this field existed — the backend's
 * `_location_field` validates both shapes. Not reduced to text: the
 * coordinates exist so AR and future experiences have real geography to
 * work with, not just a caption. */
export interface LocationFieldSchema extends FieldSchemaBase {
  type: "location";
}
/** Manual lat/lng entry — `{ lat, lng }`, two plain numbers, no search.
 *  Used by Where We Met Map, which wants exact GPS coordinates rather than
 *  a searched place name; left untouched by §6's work on the Timeline's
 *  `location` field above, which is a different, richer shape for a
 *  different need. Renderer: `field-inputs.tsx`'s `CoordinatesFieldInput`. */
export interface CoordinatesFieldSchema extends FieldSchemaBase {
  type: "coordinates";
}
export interface RichTextFieldSchema extends FieldSchemaBase {
  type: "richText";
}

export type FieldSchema =
  | TextFieldSchema
  | DateFieldSchema
  | BooleanFieldSchema
  | SelectFieldSchema
  | RangeFieldSchema
  | MediaFieldSchema
  | GroupFieldSchema
  | LocationFieldSchema
  | CoordinatesFieldSchema
  | RichTextFieldSchema;

/** Fields are grouped into sections purely for the Content panel's
 * headers — every prototype-turned-module organizes its inputs this
 * way, so the Shell renders section headers generically instead of a
 * flat wall of fields. */
export interface FormSection {
  id: string;
  /** Translation key. */
  title: string;
  fields: FieldSchema[];
}

export interface FormSchemaConfig {
  sections: FormSection[];
}

/** A validation failure is a *code* plus optional interpolation params,
 * never a finished string — resolving it to display text needs a
 * locale, which pure validation logic doesn't have. Generic codes
 * ("required", "maxLength", "minItems") are resolved against the
 * Shell's own message set; a module's own domain codes (e.g.
 * Timeline's "duplicateDate") are resolved against that module's
 * `messages` dictionary under a `validation.<code>` key. See
 * `lib/studio/i18n.ts`. */
export interface ValidationError {
  code: string;
  params?: Record<string, string | number>;
}

export interface ValidationResult {
  valid: boolean;
  /** field id -> error. Flat, even for fields inside a group — group
   * item errors are keyed as `${groupId}.${itemIndex}.${fieldId}`. */
  errors: Record<string, ValidationError>;
}

/* ============================================================
 * Theme Engine
 * ============================================================ */

export interface ThemeAxisOption {
  id: string;
  /** Translation key. */
  label: string;
  /** CSS custom properties this option contributes, merged by the Shell
   * (`lib/studio/theme-engine.ts`) and handed to the renderer as
   * `tokens`. Structural axes (layout, frame, format) may omit this and
   * instead be read directly from `themeSelections` by the renderer. */
  tokens?: Record<string, string>;
  swatch?: string;
}

export interface ThemeAxisBase {
  id: string;
  /** Translation key. */
  label: string;
  kind: "swatch" | "select" | "range";
  defaultOptionId?: string;
  /** Keyed `"${otherAxisId}:${otherOptionId}"` -> this axis's suggested
   * option id. Applied only when the person changes the *other* axis and
   * hasn't touched this one yet — a suggestion, never a lock. */
  defaultFor?: Record<string, string>;
  /** Only rendered when every condition holds against `{ values, theme }`. */
  visibleWhen?: Condition[];
}

export interface DiscreteThemeAxis extends ThemeAxisBase {
  kind: "swatch" | "select";
  options: ThemeAxisOption[];
}

export interface RangeThemeAxis extends ThemeAxisBase {
  kind: "range";
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  cssVar: string;
  transform?: (value: number) => string;
}

export type ThemeAxis = DiscreteThemeAxis | RangeThemeAxis;

export interface ThemeEngineConfig {
  axes: ThemeAxis[];
}

export type ThemeSelections = Record<string, string | number>;

/* ============================================================
 * Renderer
 * ============================================================ */

export interface ProductRendererProps<TValues = unknown> {
  values: TValues;
  tokens: Record<string, string>;
  themeSelections: ThemeSelections;
  /** Active app locale (e.g. "en"/"fr"/"ar") — for any renderer-owned
   * `Intl` formatting (dates, numbers) that isn't a translated string
   * and so doesn't go through `t`. */
  locale: string;
  /** Resolves a translation key from the module's own `messages` against
   * the active locale — for any static text the renderer itself needs to
   * draw (e.g. Timeline's "days together" label, a premium-module
   * badge). Added once it became clear during Timeline's own extraction
   * that renderer output, not just Shell chrome, needed localizing. */
  t: (key: string, params?: Record<string, string | number>) => string;
}

export interface ComponentRendererConfig<TValues = unknown> {
  kind: "component";
  component: ComponentType<ProductRendererProps<TValues>>;
  intrinsicSize: (values: TValues, themeSelections: ThemeSelections) => {
    width: number;
    height: number;
  };
}

/**
 * Generic in `TValues` so a Product Module can type its own renderer against
 * its own value shape. Previously this was non-generic, which pinned the
 * `component` member to `ProductRendererProps<unknown>` and made every real
 * module's `renderer` block fail to type-check against its own
 * `ProductModuleConfig<TValues>` — the reason both product modules and the
 * module registry had type errors before the Phase 2 merge. Defaults to
 * `unknown`, so every existing non-generic usage is unchanged.
 */
export type RendererConfig<TValues = unknown> =
  | { kind: "canvas" | "svg" | "webgl" | "image" | "unset" }
  | ComponentRendererConfig<TValues>;

/** Handed to a mounted renderer so it can (a) expose the DOM node(s) the
 * export pipeline should rasterize and (b) know which named target it's
 * registering, for products with more than one exportable surface. */
export interface ExportTargetRegistration {
  register: (targetId: string, node: RefObject<HTMLElement | null>) => void;
}

/* ============================================================
 * Pricing Engine
 * ============================================================ */

export interface PricingAction {
  type: "addFixed" | "addPercent" | "setBase" | "applyCoupon";
  amountCents?: number;
  percent?: number;
  couponCode?: string;
}

export interface PricingRule {
  id: string;
  /** Translation key. Shown as a line item in a price breakdown when the
   * rule fires. */
  label?: string;
  /** AND-combined. Omitted entirely = rule always applies. */
  when?: Condition[];
  then: PricingAction[];
}

export interface PricingConfig {
  /** ISO 4217 code. What currency a product is priced in is a business
   * decision the module makes; *how* an amount is formatted for display
   * is a presentation concern the Shell resolves from the active locale
   * — see `lib/studio/pricing-engine.ts#formatCents`. */
  currency: string;
  basePriceCents: number;
  rules: PricingRule[];
}

export interface PricingLineItem {
  ruleId: string;
  /** Already-resolved display text, not a key — line items are computed
   * post-hoc by `computeTotal`, which has no locale, so `PricingSummary`
   * resolves each rule's label key to text and passes it back in when
   * building the item for display. */
  label: string;
  deltaCents: number;
}

export interface PricingResult {
  totalCents: number;
  currency: string;
  lineItems: PricingLineItem[];
}

/* ============================================================
 * Delivery
 * ------------------------------------------------------------
 * The original `exportConfig: ExportEngineConfig` assumed every
 * product's deliverable is a downloadable raster image from a
 * single DOM node. That's true for poster-shaped products but
 * not for a hosted/interactive deliverable (a shareable link,
 * an animated page) — which "extended hosting" as a pricing
 * capability already implied needing. `DeliveryConfig` makes
 * the delivery *mode* explicit and lets `"hosted"`/`"interactive"`
 * exist as real (if still shallow) cases now, rather than forcing
 * a second reshape the moment a non-exported product is built.
 * ============================================================ */

export interface ExportFormat {
  id: string;
  /** Translation key. */
  label: string;
  /** Open — not just `image/png | image/jpeg` — so a future PDF or
   * multi-page export doesn't need another type-level change. */
  mimeType: string;
  width: number;
  height: number;
  /** Ties into pricing via a rule that checks
   * `{ path: "export.formatId", op: "eq", value: "<id>" }` once the
   * selected export format is tracked as persisted state (see the
   * open item in `export-section.tsx`). */
  isPremium?: boolean;
}

export interface ExportEngineConfig {
  /** Keyed by export target id (see `ExportTargetRegistration`); a
   * single-canvas product only ever populates `"default"`. Each target
   * can offer a different set of formats — e.g. a multi-card Wedding
   * Invitation might export its RSVP card at different sizes than its
   * cover.
   *
   * A FUNCTION OF `ThemeSelections`, OPTIONALLY — added when Song
   * Poster's Award and Sleeve themes exposed a real gap: a static
   * `Record` has no way to say "this size, the other way up" for a
   * theme whose own composition is landscape while its sibling themes
   * are portrait (see `print-sizes.ts`'s own `dimensionsFor(size,
   * orientation)`, built for exactly this and already used correctly
   * by the render engine — only the DISPLAYED dimensions here were
   * still hardcoded to the wrong orientation). Every existing module's
   * plain `Record` still satisfies this type unchanged; only a module
   * that actually needs per-theme dimensions provides a function
   * instead. `resolveExportTargets` below is the one place that reads
   * either shape, so no second call site needs to know both exist.
   */
  targets: Record<string, ExportFormat[]> | ((themeSelections: ThemeSelections) => Record<string, ExportFormat[]>);
  /**
   * §15 — opts a product OUT of `ExportSection`'s customer-facing list of
   * raw export dimensions (e.g. "A4 frameless, 2480×3508").
   *
   * `targets` above is kept either way: it's still real metadata other
   * code may read (the delivery pipeline, admin tooling). This flag only
   * controls whether `ExportSection` renders it as a sidebar panel —
   * added here, on the config, rather than hardcoding a product id inside
   * the shared shell or the shared component, so `studio-shell.tsx` and
   * `export-section.tsx` stay product-agnostic and each module states its
   * own preference. Default false/undefined preserves existing behaviour
   * for every product that doesn't set it.
   */
  hideCustomerFacingList?: boolean;
}

/**
 * Reads `ExportEngineConfig.targets` regardless of which of its two
 * shapes a module provided — the one place that distinction is
 * resolved, so `export-section.tsx` (and any future consumer) calls
 * this instead of re-deriving the same `typeof targets === "function"`
 * check independently.
 */
export function resolveExportTargets(
  config: ExportEngineConfig,
  themeSelections: ThemeSelections
): Record<string, ExportFormat[]> {
  return typeof config.targets === "function" ? config.targets(themeSelections) : config.targets;
}

export interface HostedDeliveryConfig {
  /** Placeholder shape — deliberately shallow. Real hosting (slug
   * generation, expiry, access control) is a checkout/back-end concern
   * that doesn't exist yet; this exists so `DeliveryConfig` can express
   * "this product isn't exported at all" today without guessing at
   * infrastructure no product has needed yet. */
  description?: string;
}

export interface InteractiveDeliveryConfig {
  description?: string;
  /** Translation key into the module's own `messages`, preferred over the
   * plain-English `description` so the panel reads in the active locale. */
  descriptionKey?: string;
}

export type DeliveryConfig =
  | { mode: "export"; export: ExportEngineConfig }
  | { mode: "hosted"; hosted: HostedDeliveryConfig }
  | { mode: "interactive"; interactive: InteractiveDeliveryConfig };

/* ============================================================
 * Product Module Config
 * ============================================================ */

export interface ProductModuleConfig<TValues = unknown> {
  formSchema: FormSchemaConfig;
  themes: ThemeEngineConfig;
  renderer: RendererConfig<TValues>;
  pricing: PricingConfig;
  delivery: DeliveryConfig;
  messages: ProductModuleMessages;
  createInitialState: () => TValues;
  createInitialThemeSelections: () => ThemeSelections;
  /** Product-specific rules beyond generic `required`/`maxLength`/
   * `minItems` checks (e.g. "no two milestones share a date"). Optional
   * — the Shell's generic schema validation always runs regardless. */
  validate?: (values: TValues) => ValidationResult;
  /**
   * Which preview tabs this product offers, in order; the first is the one
   * shown on load. Omitted = today's behaviour for every existing product:
   * `flat` and `framed`, plus `live` when `livePreview` is set.
   *
   * A product whose ONLY deliverable is the hosted page (Graduation
   * Keepsake) has no poster to show flat or framed, so it declares
   * `["live"]`; the tab strip is not drawn for a single mode. Config, never a
   * product id inside the Shell.
   */
  previewModes?: ("flat" | "framed" | "live")[];
  /**
   * §16 — a real interactive Digital preview, for products that have a
   * Live pack. Optional and product-agnostic on purpose: a product with
   * no Digital concept (Where We Met Map, today) simply never sets this,
   * and `PreviewModeTabs` never renders the tab for it — the same
   * config-level opt-in pattern already used for `hideCustomerFacingList`,
   * so the shared preview shell never needs to know a product id by name.
   *
   * Takes the SAME component that renders the real, purchased `/live/<id>`
   * page — `LiveKeepsake` needs only `values`/`themeSelections`/`media`/
   * `locale`, none of which requires an order or an entitlement to exist,
   * so the identical component works as a live, pre-purchase Studio
   * preview with no server round-trip at all. This is the "prefer an
   * existing architecture" case landing cleanly: no new preview stack.
   */
  livePreview?: {
    component: ComponentType<{
      values: TValues;
      themeSelections: ThemeSelections;
      locale: string;
    }>;
  };
}

/** What `module-loader.ts` actually resolves and hands to the Shell:
 * a `ProductModuleConfig` plus the `productId` the loader derived from
 * the `ProductEntry` it was already given. `productId` is intentionally
 * *not* part of the author-facing `ProductModuleConfig` — having each
 * module hand-author its own copy of an id the Shell already knows
 * (from routing) was the exact duplication the architecture review
 * flagged: it can drift from the registry with nothing catching it. */
export interface ResolvedProductModuleConfig<TValues = unknown> extends ProductModuleConfig<TValues> {
  productId: string;
}

export interface StudioSession<TValues = unknown> {
  product: ProductEntry;
  projectId?: string;
  module: ResolvedProductModuleConfig<TValues>;
  /**
   * Personalization restored from a saved Django project, when the Studio
   * was entered via `/project/:id`. Absent for a fresh session, in which
   * case the Product Module's own `createInitialState()` seeds the editor
   * exactly as before — so nothing about starting a new keepsake changed.
   */
  restored?: {
    values: Record<string, unknown>;
    themeSelections: ThemeSelections;
  };
}

export type StudioLoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; session: StudioSession };
