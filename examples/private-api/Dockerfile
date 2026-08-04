# private-api needs two native binaries no Node image ships with:
#   * `spp`     — Stellar Private Payments CLI. Does the Groth16 proving and note scanning that
#                 shielded payments require. The published `stellar-private-payments` npm package
#                 is a BROWSER build (wasm + Web Workers), so a server process cannot drive it.
#   * `stellar` — the Stellar CLI, which `spp` shells out to for key/network/signing operations.
#
# `spp` is compiled here from its own public repo rather than committed as a binary: Railway's
# builders are amd64, so this compiles at native speed, and nothing 8MB-and-opaque lands in this
# repo. The clone also carries the circuit artifacts (committed there, ~18MB for the policy set),
# so the prover's inputs come from the same pinned commit as the binary.
FROM rust:1.90-bookworm AS spp-builder

# Pinned: an unpinned clone would silently change the prover under a redeploy. Bump deliberately.
ARG SPP_REPO=https://github.com/yripper/openzeppelin-stellar-privacy-wallet.git
ARG SPP_REF=0be2a77a90016d9133973655a6c32c9fb92e83bf

RUN git clone --no-checkout "$SPP_REPO" /spp-src \
  && cd /spp-src \
  && git checkout "$SPP_REF"

WORKDIR /spp-src/vendor/stellar-private-payments
RUN cargo build --release --bin spp

# Keep only the policy circuits this pool proves against. The selective-disclosure artifacts in
# the same directory are ~25MB and are never loaded by deposit/transfer.
RUN mkdir -p /circuits \
  && cp sdk/web/dist/circuits/policy_tx_2_2* sdk/web/dist/circuits/artifact_hashes.json /circuits/

FROM node:22-bookworm-slim

ARG STELLAR_CLI_VERSION=23.1.4
ENV DEBIAN_FRONTEND=noninteractive

# libdbus-1-3 is NOT optional: the Stellar CLI links against it for its OS secure-store
# integration, and node:slim omits it. Without it every `stellar` invocation dies with
# "error while loading shared libraries: libdbus-1.so.3" — which surfaces as an unrelated-looking
# "identity did not resolve", since the CLI never gets far enough to read the identity at all.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libdbus-1-3 \
  && curl -fsSL "https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/stellar-cli-${STELLAR_CLI_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
     | tar -xz -C /usr/local/bin stellar \
  && chmod +x /usr/local/bin/stellar \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
  && stellar --version

RUN corepack enable

WORKDIR /app

# Workspace manifests first so an unchanged dependency set reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY examples/private-api/package.json examples/private-api/
RUN pnpm install --filter @stellarpay-examples/private-api --frozen-lockfile

COPY examples/private-api examples/private-api
COPY vendor/spp/deployments.json /opt/spp/deployments.json
COPY --from=spp-builder /spp-src/vendor/stellar-private-payments/target/release/spp /usr/local/bin/spp
COPY --from=spp-builder /circuits /opt/spp/circuits
RUN chmod +x /usr/local/bin/spp /app/examples/private-api/docker-entrypoint.sh

# Explicit HOME: the entrypoint writes the Stellar CLI identity under $HOME/.config, and the
# CLI must resolve the same path when it reads it back.
ENV HOME=/root \
    SPP_BIN=/usr/local/bin/spp \
    SPP_CIRCUITS_DIR=/opt/spp/circuits \
    SPP_DEPLOYMENT=/opt/spp/deployments.json \
    SPP_DATA_DIR=/data/spp

EXPOSE 4606
ENTRYPOINT ["/app/examples/private-api/docker-entrypoint.sh"]
