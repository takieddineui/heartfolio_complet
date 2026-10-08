"use client";

import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ThemeAxis, ThemeEngineConfig, ThemeSelections } from "@/types/studio";
import { evaluateConditions } from "@/lib/studio/conditions";
import { resolveSmartDefault } from "@/lib/studio/theme-engine";
import { cn } from "@/lib/utils";
import type { Translator } from "./field-inputs";

const EASE = [0.22, 1, 0.36, 1] as const;

interface ThemePickerProps {
  config: ThemeEngineConfig;
  values: Record<string, unknown>;
  selections: ThemeSelections;
  onChange: (updater: (prev: ThemeSelections) => ThemeSelections) => void;
  t: Translator;
}

export function ThemePicker({ config, values, selections, onChange, t }: ThemePickerProps) {
  // Tracks which axes the person has explicitly touched, so a smart
  // default only ever suggests a value for an axis they haven't
  // overridden — never clobbers a deliberate choice.
  const touchedRef = useRef<Set<string>>(new Set());
  const visibilityContext = { values, theme: selections };

  function selectDiscrete(axis: ThemeAxis, optionId: string) {
    touchedRef.current.add(axis.id);
    onChange((prev) => {
      const next: ThemeSelections = { ...prev, [axis.id]: optionId };
      for (const otherAxis of config.axes) {
        if (otherAxis.id === axis.id || touchedRef.current.has(otherAxis.id)) continue;
        const suggestion = resolveSmartDefault(config, axis.id, optionId, otherAxis.id);
        if (suggestion) next[otherAxis.id] = suggestion;
      }
      return next;
    });
  }

  function selectRange(axis: Extract<ThemeAxis, { kind: "range" }>, value: number) {
    touchedRef.current.add(axis.id);
    onChange((prev) => ({ ...prev, [axis.id]: value }));
  }

  return (
    <div className="space-y-6">
      <AnimatePresence initial={false}>
        {config.axes
          .filter((axis) => evaluateConditions(axis.visibleWhen, visibilityContext))
          .map((axis) => (
            <motion.div
              key={axis.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              style={{ overflow: "hidden" }}
              className="space-y-2"
            >
              <label className="text-sm font-medium text-heading">{t(axis.label)}</label>

            {axis.kind === "range" ? (
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={axis.min}
                  max={axis.max}
                  step={axis.step ?? 1}
                  value={typeof selections[axis.id] === "number" ? (selections[axis.id] as number) : axis.defaultValue}
                  onChange={(e) => selectRange(axis, Number(e.target.value))}
                  className="w-full accent-[var(--color-champagne-gold)]"
                />
              </div>
            ) : axis.kind === "swatch" ? (
              <div className="flex flex-wrap gap-2">
                {axis.options.map((opt) => {
                  const active = (selections[axis.id] ?? axis.defaultOptionId) === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      title={t(opt.label)}
                      onClick={() => selectDiscrete(axis, opt.id)}
                      className={cn(
                        // §10 — a permanent, subtle outline on EVERY swatch,
                        // not only the active one. The dark-blue "Midnight"
                        // swatch sits close enough to the Studio's own
                        // background that with the old `border-transparent`
                        // default it was nearly invisible until selected —
                        // a contour visible against both light and dark
                        // backgrounds fixes that without changing the
                        // actual palette colour to solve a visibility
                        // problem that was never about the colour itself.
                        "h-8 w-8 rounded-full border-2 transition-transform",
                        "border-body/15",
                        active && "border-champagne-gold scale-110"
                      )}
                      style={{ backgroundColor: opt.swatch ?? "#ccc" }}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {axis.options.map((opt) => {
                  const active = (selections[axis.id] ?? axis.defaultOptionId) === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => selectDiscrete(axis, opt.id)}
                      className={cn(
                        "rounded-[var(--radius-md)] border px-3 py-1.5 text-xs font-medium transition-colors",
                        active
                          ? "border-champagne-gold bg-champagne-gold/15 text-heading"
                          : "border-subtle text-body/70 hover:text-heading"
                      )}
                    >
                      {t(opt.label)}
                    </button>
                  );
                })}
              </div>
            )}
            </motion.div>
          ))}
      </AnimatePresence>
    </div>
  );
}
