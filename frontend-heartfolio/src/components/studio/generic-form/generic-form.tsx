"use client";

import { useId, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { FieldSchema, FormSchemaConfig, ThemeSelections, ValidationError } from "@/types/studio";
import { evaluateConditions } from "@/lib/studio/conditions";
import { createGroupItemDefaults } from "@/lib/studio/form-engine";
import { resolveModuleText, resolveValidationMessage } from "@/lib/studio/i18n";
import { useProductState } from "@/lib/studio/product-state-context";
import { AddGroupItemButton, FieldInput, RemoveGroupItemButton, type Translator } from "./field-inputs";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * A field or theme axis whose `visibleWhen` condition just became true
 * or false used to be added or removed from the tree with nothing
 * between "not there" and "there" — a real gap, not a simplification:
 * Song Poster's own Sleeve palette picker (`theme-registry.ts`'s
 * `visibleWhen: [{ path: "theme.theme", op: "eq", value: "sleeve" }]`),
 * built this same session, is a live example of exactly this happening
 * every time a customer switches themes.
 *
 * Shared between `GenericForm` (twice — top-level fields and nested
 * group-item fields) and `ThemePicker`, which have the identical
 * `.filter(evaluateConditions).map(...)` shape in three places rather
 * than one, so the fix lives in one small wrapper instead of three
 * separately-drifting copies of the same fade+collapse.
 */
function AnimatedField({ id, children }: { id: string; children: ReactNode }) {
  return (
    <motion.div
      key={id}
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      style={{ overflow: "hidden" }}
    >
      {children}
    </motion.div>
  );
}

interface GenericFormProps {
  schema: FormSchemaConfig;
  values: Record<string, unknown>;
  themeSelections: ThemeSelections;
  errors: Record<string, ValidationError>;
  onChange: (fieldId: string, value: unknown) => void;
}

export function GenericForm({ schema, values, themeSelections, errors, onChange }: GenericFormProps) {
  const { session, locale } = useProductState();
  const t: Translator = (key, params) => resolveModuleText(key, locale, session.module.messages, params);
  const errorText = (error?: ValidationError) =>
    error ? resolveValidationMessage(error, locale, session.module.messages) : undefined;
  const visibilityContext = { values, theme: themeSelections };

  return (
    <div className="space-y-8">
      {schema.sections.map((section) => {
        const visibleFields = section.fields.filter((field) => evaluateConditions(field.visibleWhen, visibilityContext));
        // A section whose every field is hidden (a switched-off chapter, a
        // journey-only block under another journey) draws no header either.
        if (visibleFields.length === 0) return null;
        return (
          <section key={section.id} className="space-y-4">
            <h3 className="text-xs font-medium uppercase tracking-[0.1em] text-body/50">{t(section.title)}</h3>
            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {visibleFields.map((field) => (
                  <AnimatedField key={field.id} id={field.id}>
                    <FieldRow
                      field={field}
                      value={values[field.id]}
                      errorText={errorText(errors[field.id])}
                      nestedErrors={errors}
                      nestedErrorPrefix={field.id}
                      visibilityContext={visibilityContext}
                      t={t}
                      resolveError={errorText}
                      onChange={(v) => onChange(field.id, v)}
                    />
                  </AnimatedField>
                ))}
              </AnimatePresence>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FieldRow({
  field,
  value,
  errorText,
  nestedErrors,
  nestedErrorPrefix,
  visibilityContext,
  t,
  resolveError,
  onChange,
}: {
  field: FieldSchema;
  value: unknown;
  errorText?: string;
  /** The full flat error map, plus the `${groupId}.${index}` prefix this
   * row is nested under — only meaningful when `field.type === "group"`,
   * used to look up each item's own field errors (`errors["events.0.date"]`). */
  nestedErrors?: Record<string, ValidationError>;
  nestedErrorPrefix?: string;
  visibilityContext: { values: unknown; theme: unknown };
  t: Translator;
  resolveError: (error?: ValidationError) => string | undefined;
  onChange: (value: unknown) => void;
}) {
  // Called before the group branch returns so the hook order never changes.
  const inputId = useId();

  if (field.type === "group") {
    const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

    function updateItem(index: number, itemFieldId: string, itemValue: unknown) {
      const next = [...items];
      next[index] = { ...next[index], [itemFieldId]: itemValue };
      onChange(next);
    }
    function removeItem(index: number) {
      onChange(items.filter((_, i) => i !== index));
    }
    function addItem() {
      // Narrowed rather than cast: this renderer is only mounted for a
      // `group` field, and `maxItems`/`itemFields` exist only on that
      // member of the FieldSchema union.
      if (field.type !== "group") return;
      if (items.length >= field.maxItems) return;
      onChange([...items, createGroupItemDefaults(field.itemFields)]);
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-heading">{t(field.label)}</label>
          {items.length < field.maxItems && (
            <AddGroupItemButton onClick={addItem} label={`${t(field.label)} (${items.length}/${field.maxItems})`} />
          )}
        </div>

        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={index} className="rounded-[var(--radius-md)] border border-subtle bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-body/50">
                  {t(field.label)} {index + 1}
                </span>
                {items.length > field.minItems && <RemoveGroupItemButton onClick={() => removeItem(index)} />}
              </div>
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {field.itemFields
                    .filter((itemField) =>
                      evaluateConditions(itemField.visibleWhen, { values: item, theme: visibilityContext.theme })
                    )
                    .map((itemField) => (
                      <AnimatedField key={itemField.id} id={itemField.id}>
                        <FieldRow
                          field={itemField}
                          value={item[itemField.id]}
                          errorText={resolveError(nestedErrors?.[`${nestedErrorPrefix}.${index}.${itemField.id}`])}
                          // Passed down so a group NESTED inside a group item
                          // (Graduation Keepsake: message groups -> people)
                          // can look up its own items' errors, keyed
                          // `${group}.${i}.${nestedGroup}.${j}.${field}` by the
                          // form engine. Without these a nested group's errors
                          // were computed and never shown.
                          nestedErrors={nestedErrors}
                          nestedErrorPrefix={`${nestedErrorPrefix}.${index}.${itemField.id}`}
                          visibilityContext={visibilityContext}
                          t={t}
                          resolveError={resolveError}
                          onChange={(v) => updateItem(index, itemField.id, v)}
                        />
                      </AnimatedField>
                    ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
        {errorText && <p className="text-xs text-error-warm">{errorText}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-heading">
        {t(field.label)}
        {field.required && <span className="text-error-warm"> *</span>}
      </label>
      <FieldInput id={inputId} field={field} value={value} onChange={onChange} t={t} />
      {field.helpText && field.type !== "boolean" && <p className="text-xs text-body/50">{t(field.helpText)}</p>}
      {errorText && <p className="text-xs text-error-warm">{errorText}</p>}
    </div>
  );
}
