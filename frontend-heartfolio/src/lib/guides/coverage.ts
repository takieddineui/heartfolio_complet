/**
 * Visible products that no guide covers YET, each with the reason. Every
 * visible product must be in a guide (any status) or here
 * (`product-checklist.test.ts`), so adding a product forces the question
 * "which guide links to it?" (ADDING-A-PRODUCT.md). Remove an entry when its
 * guide exists; the test fails on a stale one.
 */
export const GUIDE_COVERAGE_PENDING: Record<string, string> = {
  // Empty since the last-minute guide covers Graduation Keepsake (27 Oct
  // 2026); its own graduation guide is still planned for March.
};
