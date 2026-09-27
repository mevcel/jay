// SPDX-License-Identifier: MIT
// Pons Family: read-only Robinhood Chain client for Jay, the pons.family support agent.

import {
  createPublicClient,
  defineChain,
  erc20Abi,
  formatEther,
  http,
  isAddress,
  isHash,
  type Address,
  type Hash,
} from "viem";

/** Robinhood Chain mainnet as documented at docs.ponsfamily.com. */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

/** Live V1 factory (`PonsLaunchFactory`). */
export const PONS_V1_FACTORY: Address = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB";
/** Pre-upgrade V1 factory; older tokens (and the docs' reference token) live here. */
export const PONS_V1_LEGACY_FACTORY: Address = "0x0c37a24F5D23A486FA692d1500881d698B1F77a4";

/** Only the two view functions Jay needs, copied from the verified factory ABI. */
const factoryAbi = [
  {
    type: "function",
    name: "graduationStatus",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "pairedPrincipal", type: "uint256" },
      { name: "threshold", type: "uint256" },
      { name: "graduated", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getLaunchedToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "deployer", type: "address" },
          { name: "pairedToken", type: "address" },
          { name: "positionManager", type: "address" },
          { name: "positionId", type: "uint256" },
          { name: "dexId", type: "uint256" },
          { name: "launchConfigId", type: "uint256" },
          { name: "restrictionsEndBlock", type: "uint256" },
          { name: "supply", type: "uint256" },
          { name: "isToken0", type: "bool" },
          { name: "poolFee", type: "uint24" },
          { name: "exists", type: "bool" },
          { name: "initialBuyAmount", type: "uint256" },
        ],
      },
    ],
  },
] as const;

/**
 * Read-only chain access. Jay never holds a key and never sends a transaction.
 *
 * Why read-only by construction: a support agent that can sign is a support
 * agent that can be socially engineered into signing. There is no wallet
 * client anywhere in this codebase.
 */
export class PonsChainReader {
  private readonly client;

  constructor(
    rpcUrl: string,
    private readonly blockscoutApiUrl: string,
  ) {
    this.client = createPublicClient({
      chain: robinhoodChain,
      transport: http(rpcUrl, { timeout: 10_000 }),
    });
  }

  /** Receipt summary for a transaction hash, or `found: false`. */
  async transaction(hash: string) {
    if (!isHash(hash)) return { error: "Not a valid 0x-prefixed 32-byte transaction hash." };
    const h = hash as Hash;
    const [tx, receipt] = await Promise.all([
      this.client.getTransaction({ hash: h }).catch(() => null),
      this.client.getTransactionReceipt({ hash: h }).catch(() => null),
    ]);
    if (!tx)
      return {
        found: false,
        hint: "Not on Robinhood Chain. It may be on another network or never broadcast.",
      };
    return {
      found: true,
      status: receipt ? receipt.status : "pending",
      from: tx.from,
      to: tx.to,
      valueEth: formatEther(tx.value),
      blockNumber: receipt?.blockNumber?.toString() ?? null,
      gasUsed: receipt?.gasUsed?.toString() ?? null,
      explorer: `https://robinhoodchain.blockscout.com/tx/${hash}`,
    };
  }

  /** Native ETH balance on Robinhood Chain. The usual "cannot pay gas" check. */
  async balance(address: string) {
    if (!isAddress(address)) return { error: "Not a valid 0x address." };
    const wei = await this.client.getBalance({ address: address as Address });
    return { address, ethOnRobinhoodChain: formatEther(wei) };
  }

  /**
   * Pons launch record and graduation progress for a token, checked against
   * the live V1 factory first and the legacy factory second.
   */
  async ponsToken(address: string) {
    if (!isAddress(address)) return { error: "Not a valid 0x address." };
    const token = address as Address;
    for (const [label, factory] of [
      ["v1", PONS_V1_FACTORY],
      ["v1-legacy", PONS_V1_LEGACY_FACTORY],
    ] as const) {
      const rec = await this.client
        .readContract({
          address: factory,
          abi: factoryAbi,
          functionName: "getLaunchedToken",
          args: [token],
        })
        .catch(() => null);
      if (!rec?.exists) continue;
      const [paired, threshold, graduated] = await this.client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "graduationStatus",
        args: [token],
      });
      const block = await this.client.getBlockNumber();
      const pct = threshold > 0n ? Number((paired * 10_000n) / threshold) / 100 : 0;
      return {
        isPonsToken: true,
        factory: label,
        deployer: rec.deployer,
        supply: formatEther(rec.supply),
        poolFeeBps: rec.poolFee / 100,
        antiSnipeActive: block < rec.restrictionsEndBlock,
        graduation: {
          pairedEth: formatEther(paired),
          thresholdEth: formatEther(threshold),
          progressPct: Math.min(pct, 100),
          graduated,
        },
        ...(await this.tokenMeta(token)),
      };
    }
    return {
      isPonsToken: false,
      note: "Not launched through a Pons V1 factory. It may be a V2 launch, a token from elsewhere, or an impostor.",
      ...(await this.tokenMeta(token)),
    };
  }

  /**
   * Name and symbol straight from the token contract, plus holder count from
   * Blockscout when its API is reachable. Never throws.
   *
   * Why the chain first: the explorer API sits behind bot protection and can
   * refuse server-side requests; the contract itself is always the truth.
   */
  private async tokenMeta(token: Address) {
    const [name, symbol] = await Promise.all([
      this.client
        .readContract({ address: token, abi: erc20Abi, functionName: "name" })
        .catch(() => null),
      this.client
        .readContract({ address: token, abi: erc20Abi, functionName: "symbol" })
        .catch(() => null),
    ]);
    let holders: string | null = null;
    try {
      const res = await fetch(`${this.blockscoutApiUrl}/tokens/${token}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok)
        holders = ((await res.json()) as { holders_count?: string }).holders_count ?? null;
    } catch {
      // explorer unavailable: holders stays null
    }
    return { name, symbol, holders };
  }
}
