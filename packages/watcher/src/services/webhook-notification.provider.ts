import { Injectable } from "@nestjs/common";
import { createHmac } from "crypto";
import { isIP } from "net";
import { createHttpClient } from "@ever-jobs/common";
import {
  JobNotificationMessage,
  NotificationDestination,
  NotificationProvider,
  NotificationResult,
} from "../interfaces/watch.types";

@Injectable()
export class WebhookNotificationProvider implements NotificationProvider {
  readonly type = "webhook";

  async send(
    message: JobNotificationMessage,
    destination: NotificationDestination,
  ): Promise<NotificationResult> {
    const reference = destination.destinationRef ?? destination.secretRef;
    if (!["default", "GENERIC_WEBHOOK_URL"].includes(reference ?? "")) {
      return permanentConfigurationFailure(
        "Unknown generic webhook destinationRef",
      );
    }
    const configuredUrl = process.env.GENERIC_WEBHOOK_URL;
    if (!configuredUrl) {
      return permanentConfigurationFailure(
        "GENERIC_WEBHOOK_URL is not configured",
      );
    }

    let url: URL;
    try {
      url = new URL(configuredUrl);
    } catch {
      return permanentConfigurationFailure(
        "Generic webhook configuration is invalid",
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      isPrivateHost(url.hostname)
    ) {
      return permanentConfigurationFailure(
        "Generic webhook destination is unsafe",
      );
    }

    const payload = JSON.stringify({
      idempotencyKey: message.idempotencyKey,
      type: message.type,
      score: message.match.score,
      company: message.job.company,
      title: message.job.title,
      location: message.job.location,
      source: message.job.source,
      detectedAt: message.detectedAt.toISOString(),
      applyUrl: message.job.applicationUrl ?? message.job.jobUrl,
      watch: message.watch.name,
    });
    const signature = process.env.GENERIC_WEBHOOK_SECRET
      ? createHmac("sha256", process.env.GENERIC_WEBHOOK_SECRET)
          .update(payload)
          .digest("hex")
      : undefined;
    const client = createHttpClient({ timeout: 10, retries: 0 });

    try {
      const response = await client.post(url.toString(), payload, {
        headers: {
          "content-type": "application/json",
          ...(signature
            ? { "x-ever-jobs-signature": `sha256=${signature}` }
            : {}),
        },
        maxBodyLength: 64 * 1024,
        maxRedirects: 0,
        validateStatus: () => true,
      });
      const retryable = response.status === 429 || response.status >= 500;
      return response.status >= 200 && response.status < 300
        ? {
            status: "sent",
            providerResponse: {
              status: response.status,
              category: "success",
              retryable: false,
            },
          }
        : {
            status: "failed",
            errorMessage: `Generic webhook request failed (HTTP ${response.status})`,
            providerResponse: {
              status: response.status,
              category: retryable ? "provider_error" : "client_error",
              retryable,
            },
          };
    } catch {
      return {
        status: "failed",
        errorMessage: "Generic webhook network request failed",
        providerResponse: {
          category: "network_error",
          retryable: true,
        },
      };
    }
  }
}

@Injectable()
export class TelegramNotificationProvider implements NotificationProvider {
  readonly type = "telegram";

  async send(): Promise<NotificationResult> {
    return {
      status: "suppressed",
      errorMessage: "Telegram provider is not enabled in this release",
      providerResponse: {
        category: "configuration_error",
        retryable: false,
      },
    };
  }
}

function permanentConfigurationFailure(
  errorMessage: string,
): NotificationResult {
  return {
    status: "failed",
    errorMessage,
    providerResponse: {
      category: "configuration_error",
      retryable: false,
    },
  };
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  )
    return true;
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(normalized) === 6) {
    return (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }
  return false;
}

export { DiscordNotificationProvider } from "./discord-notification.provider";
