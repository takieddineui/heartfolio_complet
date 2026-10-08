"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      className={`relative flex h-10 w-10 items-center justify-center rounded-full text-body transition-colors hover:bg-subtle/40 ${className ?? ""}`}
    >
      <Sun
        className={`absolute h-[18px] w-[18px] transition-all duration-500 ease-[var(--ease-heartfolio)] ${
          theme === "dark" ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
        }`}
        strokeWidth={1.5}
      />
      <Moon
        className={`absolute h-[18px] w-[18px] transition-all duration-500 ease-[var(--ease-heartfolio)] ${
          theme === "dark" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"
        }`}
        strokeWidth={1.5}
      />
    </button>
  );
}
