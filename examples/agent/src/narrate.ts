import { createReceiptReporter } from "./reportReceipt.js";

export type Narrator = (message: string) => void;

/** Posts agent narration to the dashboard feed and mirrors it to stdout. */
export function createNarrator(opts: { dashboardUrl: string | undefined; ingestSecret: string | undefined }): Narrator {
  const report = createReceiptReporter({ service: "agent", dashboardUrl: opts.dashboardUrl, ingestSecret: opts.ingestSecret });
  return (message) => {
    console.log(`[agent] ${message}`);
    report({ kind: "agent-log", message });
  };
}
