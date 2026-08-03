// `dollarToDecimal`/`decimalToBaseUnits`/`NETWORKS` moved to `@stellarpay/core`'s
// `src/internal/` (see docs/modules/shared.md) so the three publishable packages that use
// them don't depend on this private, unpublished package at runtime. Re-exported here so
// any existing importer of `@stellarpay/shared` keeps working unchanged.
export { dollarToDecimal, decimalToBaseUnits, NETWORKS } from "@stellarpay/core";
export type { NetworkPreset } from "@stellarpay/core";
export * from "./channels.js";
