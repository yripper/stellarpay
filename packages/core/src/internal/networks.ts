import type { NetworkId } from "../types.js";

export interface NetworkPreset {
  networkId: NetworkId;
  facilitatorUrl: string;
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  channelsUrl: string;
}

export const NETWORKS: Record<NetworkId, NetworkPreset> = {
  "stellar:testnet": {
    networkId: "stellar:testnet",
    facilitatorUrl: "https://channels.openzeppelin.com/x402/testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    channelsUrl: "https://channels.openzeppelin.com/testnet",
  },
  "stellar:pubnet": {
    networkId: "stellar:pubnet",
    facilitatorUrl: "https://channels.openzeppelin.com/x402",
    rpcUrl: "https://soroban-rpc.mainnet.stellar.gateway.fm",
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    channelsUrl: "https://channels.openzeppelin.com",
  },
};
