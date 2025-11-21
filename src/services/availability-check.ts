/**
 * Site Availability Check
 * Verifies if the site is currently up and responding
 */

import type { CheckResult } from "../types";

export async function checkAvailability(url: string): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "WWWMW/1.0 (+https://captainpragmatic.com/tools/website-health-scanner)",
      },
    });

    clearTimeout(timeoutId);

    const details = {
      statusCode: response.status,
      statusText: response.statusText,
      available: true,
    };

    // 2xx status codes indicate success
    if (response.status >= 200 && response.status < 300) {
      return {
        status: "pass",
        message: "Site is online and responding",
        score: 15,
        details,
      };
    }

    // 3xx redirects are acceptable
    if (response.status >= 300 && response.status < 400) {
      return {
        status: "pass",
        message: "Site is online (with redirect)",
        score: 15,
        details,
      };
    }

    // 4xx client errors
    if (response.status >= 400 && response.status < 500) {
      return {
        status: "warn",
        message: `Site responding but with ${response.status} error`,
        score: 8,
        details,
      };
    }

    // 5xx server errors
    return {
      status: "fail",
      message: `Site has server error (${response.status})`,
      score: 0,
      details: {
        ...details,
        available: false,
      },
    };
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";

    if (error.name === "AbortError") {
      return {
        status: "fail",
        message: "Site is not responding (timeout)",
        score: 0,
        details: {
          error: "Timeout after 5 seconds",
          available: false,
        },
      };
    }

    // Connection failed
    return {
      status: "fail",
      message: "Site is offline or unreachable",
      score: 0,
      details: {
        error: errorMessage,
        available: false,
      },
    };
  }
}
