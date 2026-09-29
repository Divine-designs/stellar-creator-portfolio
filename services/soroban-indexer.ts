/**
 * Soroban Indexer Service — Contract Simulation Pre-flight (#1343)
 *
 * Provides RPC simulation endpoints that validate transactions before
 * wallet confirmation, parsing gas estimates and surfacing failures early.
 */

import StellarSdk from "stellar-sdk";
import { getNetworkConfig } from "@/lib/config/network";
import { rpcCall, startProbing } from "@/lib/config/rpc-fallback";

export interface SimulateParams {
  contractId: string;
  method: string;
  args: unknown[];
  sourceAccount: string;
}

export interface SimulationResult {
  success: boolean;
  gasEstimate?: number;
  error?: string;
  rawResult?: unknown;
}

/**
 * Simulate a Soroban contract invocation against the configured RPC endpoint.
 * Returns gas estimate on success or a structured error before wallet prompt.
 */
export async function simulateContractCall(
  params: SimulateParams
): Promise<SimulationResult> {
  const { network } = getNetworkConfig();
  startProbing(network);

  let result: { result?: { cost?: { cpuInsns?: string }; error?: string } };
  try {
    const rpcResult = await rpcCall<{ cost?: { cpuInsns?: string }; error?: string }>(
      network,
      "simulateTransaction",
      { transaction: buildTransactionEnvelope(params) },
    );
    result = { result: rpcResult.data };
  } catch (err) {
    return {
      success: false,
      error: `RPC connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const res = result.result;
  if (!res) return { success: false, error: "Empty simulation result" };
  if (res.error) return { success: false, error: res.error };

  const gasEstimate = res.cost?.cpuInsns
    ? parseInt(res.cost.cpuInsns, 10)
    : undefined;

  return { success: true, gasEstimate, rawResult: res };
}

/**
 * Minimal transaction envelope builder using Stellar SDK XDR encoding.
 * Constructs a valid Soroban transaction for RPC simulation without signing.
 *
 * @throws if the sourceAccount cannot be parsed as a valid Stellar address
 */
function buildTransactionEnvelope(params: SimulateParams): string {
  const { network: networkName } = getNetworkConfig();
  const network = networkName === "mainnet"
    ? StellarSdk.Networks.PUBLIC_NETWORK_PASSPHRASE
    : StellarSdk.Networks.TESTNET_NETWORK_PASSPHRASE;

  // Build a contract invocation operation
  const sourceAccount = new StellarSdk.Account(params.sourceAccount, "0");
  const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: network,
    timebounds: { minTime: 0, maxTime: 0 }, // Simulation; time bounds irrelevant
  });

  // Convert args to Soroban native types
  const scArgs = params.args.map((arg) => {
    if (typeof arg === "string") return StellarSdk.nativeToScVal(arg);
    if (typeof arg === "number") return StellarSdk.nativeToScVal(arg);
    if (typeof arg === "boolean") return StellarSdk.nativeToScVal(arg);
    return StellarSdk.nativeToScVal(String(arg)); // fallback: stringify
  });

  // Add contract invocation operation
  txBuilder.addOperation(
    StellarSdk.Operation.invokeContractFunction({
      contract: params.contractId,
      function: params.method,
      args: scArgs,
    }),
  );

  // Build and encode as XDR (unsigned, for simulation only)
  const tx = txBuilder.build();
  return tx.toXDR();
}
