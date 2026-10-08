import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] text-[15px] font-medium transition-[background-color,box-shadow,color] duration-300 ease-[var(--ease-heartfolio)] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none",
  {
    variants: {
      variant: {
        primary:
          "bg-ink-navy text-champagne-gold hover:bg-[#1c2540] hover:shadow-[var(--shadow-lift)] shadow-[var(--shadow-whisper)]",
        secondary:
          "border border-heading/70 text-body bg-transparent hover:border-champagne-gold hover:text-heading",
        ghost:
          "text-body hover:text-heading underline decoration-champagne-gold decoration-2 underline-offset-4",
        onDark:
          "bg-champagne-gold text-ink-navy hover:bg-[var(--color-champagne-gold-bright)] hover:shadow-[var(--shadow-candle)]",
      },
      size: {
        default: "h-13 px-8 py-3.5",
        lg: "h-14 px-10 py-4 text-base",
        sm: "h-10 px-5 text-sm",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
