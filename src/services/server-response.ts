/**
 * Server Response Time Check
 * Measures Time To First Byte (TTFB)
 */

import type { CheckResult } from "../types";

export async function checkServerResponse(url: string): Promise<CheckResult> {
  try {
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

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
    const endTime = Date.now();
    const ttfb = endTime - startTime;

    const details = {
      ttfb,
      statusCode: response.status,
      statusText: response.statusText,
    };

    // Check for successful response
    if (response.status < 200 || response.status >= 400) {
      return {
        status: "warn",
        message: `Server returned ${response.status} status`,
        score: 5,
        details,
      };
    }

    // Score based on TTFB
    if (ttfb < 200) {
      return {
        status: "pass",
        message: `Fast server response (${ttfb}ms TTFB)`,
        score: 15,
        details,
      };
    } else if (ttfb < 500) {
      return {
        status: "warn",
        message: `Moderate server response (${ttfb}ms TTFB)`,
        score: 10,
        details,
      };
    } else {
      return {
        status: "fail",
        message: `Slow server response (${ttfb}ms TTFB)`,
        score: 5,
        details,
      };
    }
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";

    if (error.name === "AbortError") {
      return {
        status: "fail",
        message: "Server response timed out (>10s)",
        score: 0,
        details: {
          error: "Timeout",
          ttfb: 10000,
        },
      };
    }

    return {
      status: "fail",
      message: "Unable to reach server",
      score: 0,
      details: {
        error: errorMessage,
      },
    };
  }
}
