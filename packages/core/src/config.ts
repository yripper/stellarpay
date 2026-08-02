import { z } from "zod";
import { NETWORKS, dollarToDecimal } from "@stellarpay/shared";
import type { NetworkId, Receipt, RouteRule, StellarpayConfig } from "./types.js";
import { StellarpayConfigError } from "./types.js";

/** Route keys look like `"GET /path"` — one of the standard HTTP methods, a space, then a path. */
const ROUTE_KEY_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/.*$/;

/** Stellar account (G...) or contract (C...) address: 1 prefix char + 55 base32 chars. */
const PAY_TO_PATTERN = /^[GC][A-Z2-7]{55}$/;

/** Soroban contract (asset) address: C... + 55 base32 chars. */
const ASSET_PATTERN = /^C[A-Z2-7]{55}$/;

/** Base-unit amounts are non-negative integer strings. */
const BASE_UNITS_PATTERN = /^\d+$/;

const SCHEMES = ["x402", "mpp-charge", "mpp-channel"] as const;

// Single source of truth for which network ids are accepted: derived from
// `@stellarpay/shared`'s NETWORKS presets rather than duplicating the list.
const NETWORK_IDS = Object.keys(NETWORKS) as [NetworkId, ...NetworkId[]];

const networkSchema = z.enum(NETWORK_IDS);

const dollarPriceSchema = z.string().refine(
  (value) => {
    try {
      dollarToDecimal(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'price must be a dollar string like "$0.01" (positive, decimal)' },
);

const assetPriceSchema = z
  .object({
    asset: z.string().regex(ASSET_PATTERN, "asset must be a valid Soroban contract address (C... + 55 base32 chars)"),
    amount: z.string().regex(BASE_UNITS_PATTERN, "amount must be a non-negative integer string (base units)"),
  })
  .strict();

const priceSchema = z.union([dollarPriceSchema, assetPriceSchema]);

const routeRuleSchema = z
  .object({
    price: priceSchema,
    scheme: z.enum(SCHEMES).optional(),
    sponsorGas: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict();

const routeKeySchema = z.string().regex(ROUTE_KEY_PATTERN, 'route key must look like "GET /path"');

const channelSchema = z
  .object({
    contract: z.string(),
    commitmentPublicKey: z.string(),
  })
  .strict();

// `onPayment` is a callback; runtime validation is limited to "is it callable".
const onPaymentSchema = z.custom<(receipt: Receipt) => void>((value) => typeof value === "function", {
  message: "onPayment must be a function",
});

const configSchema = z
  .object({
    network: networkSchema,
    payTo: z.string().regex(PAY_TO_PATTERN, "payTo must be a valid Stellar account (G...) or contract (C...) address"),
    routes: z.record(routeKeySchema, routeRuleSchema),
    facilitatorUrl: z.string().optional(),
    // Semi-sensitive, like mppSecretKey/sponsorSecret below: no format constraint (it's an
    // opaque bearer token from the facilitator, not a Stellar key), and formatZodError() never
    // echoes values — only field names — so this is never leaked in a validation error.
    facilitatorApiKey: z.string().optional(),
    mppSecretKey: z.string().optional(),
    sponsorSecret: z.string().optional(),
    channel: channelSchema.optional(),
    rpcUrl: z.string().optional(),
    onPayment: onPaymentSchema.optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const rules: RouteRule[] = Object.values(config.routes);
    const hasMppRoute = rules.some((rule) => rule.scheme?.startsWith("mpp-") ?? false);
    const hasSponsorGasRoute = rules.some((rule) => rule.sponsorGas === true);
    const hasMppChannelRoute = rules.some((rule) => rule.scheme === "mpp-channel");

    if (hasMppRoute && !config.mppSecretKey) {
      ctx.addIssue({
        code: "custom",
        message: "mppSecretKey is required when any route uses an mpp-* scheme",
        path: ["mppSecretKey"],
      });
    }
    if (hasSponsorGasRoute && !config.sponsorSecret) {
      ctx.addIssue({
        code: "custom",
        message: "sponsorSecret is required when any route sets sponsorGas",
        path: ["sponsorSecret"],
      });
    }
    if (hasMppChannelRoute && !config.channel) {
      ctx.addIssue({
        code: "custom",
        message: "channel is required when any route uses the mpp-channel scheme",
        path: ["channel"],
      });
    }
  });

/** Render a ZodError into a readable message that names fields but never echoes values (secrets must not leak). */
function formatZodError(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
  return `Invalid Stellarpay config: ${details}`;
}

/**
 * Validate and parse an unknown value into a {@link StellarpayConfig}.
 *
 * @throws {StellarpayConfigError} when `input` does not satisfy the config schema.
 */
export function parseConfig(input: unknown): StellarpayConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    throw new StellarpayConfigError(formatZodError(result.error));
  }
  return result.data;
}
