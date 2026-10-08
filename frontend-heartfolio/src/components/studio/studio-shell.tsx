"use client";

import { useStudioSession } from "@/hooks/use-studio-session";
import { ProductStateProvider, useProductState } from "@/lib/studio/product-state-context";
import { AppearanceSection } from "@/components/studio/left-panel/appearance-section";
import { AssetsSection } from "@/components/studio/left-panel/assets-section";
import { CheckoutFlow } from "@/components/studio/checkout/checkout-flow";
import { ContentSection } from "@/components/studio/left-panel/content-section";
import { ContinueButton } from "@/components/studio/left-panel/continue-button";
import { ExportSection } from "@/components/studio/left-panel/export-section";
import { PricingSummary } from "@/components/studio/left-panel/pricing-summary";
import { PreviewPane } from "@/components/studio/preview/preview-pane";
import { ProductHeader } from "@/components/studio/product-header";
import { StudioErrorState } from "@/components/studio/states/studio-error-state";
import { StudioLoadingState } from "@/components/studio/states/studio-loading-state";
import { StudioLayout } from "@/components/studio/studio-layout";

interface StudioShellProps {
  /** Known up front for `/studio/:slug`. Omitted for `/project/:id`,
   * where the saved project reports which product it belongs to. */
  productSlugOrId?: string;
  projectId?: string;
}

/**
 * Studio Entry flow, per the brief:
 *
 *   read productId → load registry → locate product → loading state
 *   → initialize studio → load product module → render
 *
 * `useStudioSession` owns the state machine; this component only maps
 * each state to a view. A missing product always renders the error state
 * — it never throws.
 */
export function StudioShell({ productSlugOrId, projectId }: StudioShellProps) {
  const state = useStudioSession(productSlugOrId, projectId);

  if (state.status === "loading") return <StudioLoadingState />;
  if (state.status === "not-found") return <StudioErrorState variant="not-found" />;
  if (state.status === "error") return <StudioErrorState variant="error" />;

  const { session } = state;

  return (
    <ProductStateProvider session={session}>
      <StudioLayout
        header={<ProductHeader product={session.product} />}
        panels={
          <>
            <ContentSection />
            <AppearanceSection />
            <AssetsSection />
            <ExportSection />
          </>
        }
        footer={
          <div className="space-y-3 border-t border-subtle pt-4">
            <PricingSummary />
            <ContinueButton />
          </div>
        }
        preview={<PreviewPane session={session} />}
      />
      <CheckoutMount />
    </ProductStateProvider>
  );
}

function CheckoutMount() {
  const { checkoutOpen } = useProductState();
  return checkoutOpen ? <CheckoutFlow /> : null;
}
