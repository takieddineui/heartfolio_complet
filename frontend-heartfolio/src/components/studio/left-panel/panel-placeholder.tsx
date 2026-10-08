import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/studio/ui/card";

interface PanelPlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

/**
 * Every left-panel section (Content, Appearance, Assets, Export...) is
 * this same shell until its matching engine exists. Keeping one shared
 * placeholder means a future engine only needs to replace its section's
 * body — the header, spacing, and card treatment stay identical across
 * every product, satisfying "no product-specific implementation."
 */
export function PanelPlaceholder({ icon: Icon, title, description }: PanelPlaceholderProps) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-champagne-gold" strokeWidth={1.75} />
        <h2 className="text-[15px] font-medium text-heading">{title}</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-body/60">{description}</p>
    </Card>
  );
}
