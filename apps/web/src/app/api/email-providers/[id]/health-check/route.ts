import { NextResponse } from "next/server";
import {
  getEmailProviderById,
  getEmailProviderApiKey,
  updateProviderHealthCheck,
} from "@/lib/email-providers/repository";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr);
    const provider = await getEmailProviderById(id);

    if (!provider) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 }
      );
    }

    const apiKey = await getEmailProviderApiKey(id);

    if (!apiKey) {
      await updateProviderHealthCheck(id, "down", "API key not configured");
      return NextResponse.json({
        status: "down",
        message: "API key not configured",
      });
    }

    // 根据不同的提供商类型执行健康检查
    let healthStatus: "healthy" | "degraded" | "down" = "healthy";
    let message = "Health check passed";

    try {
      if (provider.provider_type === "moemail") {
        const response = await fetch(`${provider.api_url}/api/health`, {
          headers: { "X-API-Key": apiKey },
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          healthStatus = "down";
          message = `API returned ${response.status}`;
        }
      } else {
        // 其他提供商的健康检查逻辑
        message = "Health check not implemented for this provider";
      }
    } catch (error) {
      healthStatus = "down";
      message = error instanceof Error ? error.message : "Connection failed";
    }

    await updateProviderHealthCheck(id, healthStatus, message);

    return NextResponse.json({
      status: healthStatus,
      message,
    });
  } catch (error) {
    console.error("Failed to perform health check:", error);
    return NextResponse.json(
      { error: "Failed to perform health check" },
      { status: 500 }
    );
  }
}
