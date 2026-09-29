/**
 * Pre-flight RPC Health Check Endpoint (#1343)
 *
 * Proactively validates RPC endpoint connectivity before transaction submission.
 * Returns detailed health status of all endpoints in the pool, enabling the client
 * to surface warnings or block wallet confirmation if all endpoints are degraded.
 *
 * GET /api/health/preflight?network=mainnet
 * Response: { success: boolean, endpoints: HealthEndpoint[], message?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getPoolHealth, startProbing } from "@/lib/config/rpc-fallback";
import { type NetworkName } from "@/lib/config/network";

interface HealthEndpoint {
  url: string;
  latencyMs: number;
  errorRate: number;
  status: "healthy" | "degraded" | "unreachable";
}

interface PreflightResponse {
  success: boolean;
  endpoints: HealthEndpoint[];
  poolStatus: "healthy" | "degraded" | "critical";
  message?: string;
}

/** Map numeric health metrics to human-readable status. */
function getStatus(latencyMs: number, errorRate: number): HealthEndpoint["status"] {
  if (latencyMs === Infinity || errorRate >= 0.5) return "unreachable";
  if (latencyMs > 1000 || errorRate >= 0.2) return "degraded";
  return "healthy";
}

/** Derive overall pool health from individual endpoints. */
function getPoolStatus(endpoints: HealthEndpoint[]): PreflightResponse["poolStatus"] {
  const healthy = endpoints.filter((e) => e.status === "healthy").length;
  const total = endpoints.length;

  // Critical: less than 50% of endpoints healthy
  if (healthy < total / 2) return "critical";
  // Degraded: at least one endpoint degraded or unreachable
  if (endpoints.some((e) => e.status !== "healthy")) return "degraded";
  return "healthy";
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const network = (searchParams.get("network") || "mainnet") as NetworkName;

    // Validate network param
    if (!["mainnet", "testnet"].includes(network)) {
      return NextResponse.json(
        { success: false, message: "Invalid network parameter" },
        { status: 400 },
      );
    }

    // Ensure probing is started
    startProbing(network);

    // Get current pool health snapshot
    const poolHealth = getPoolHealth(network);
    const endpoints: HealthEndpoint[] = poolHealth.map((health) => ({
      url: health.url,
      latencyMs: health.latencyMs === Infinity ? -1 : health.latencyMs,
      errorRate: Math.round(health.errorRate * 100) / 100,
      status: getStatus(health.latencyMs, health.errorRate),
    }));

    const poolStatus = getPoolStatus(endpoints);

    return NextResponse.json(
      {
        success: poolStatus !== "critical",
        endpoints,
        poolStatus,
        message:
          poolStatus === "critical"
            ? "All RPC endpoints are degraded or unreachable. Transaction submission may fail."
            : poolStatus === "degraded"
              ? "Some RPC endpoints are degraded. Retrying is recommended."
              : "All RPC endpoints are healthy.",
      } as PreflightResponse,
      { status: poolStatus === "critical" ? 503 : 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        success: false,
        message: `Pre-flight check failed: ${message}`,
      },
      { status: 500 },
    );
  }
}
