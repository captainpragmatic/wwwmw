/**
 * Type definitions for WWWMW API
 */

export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  status: CheckStatus;
  message: string;
  score: number;
  details: Record<string, any>;
}

export interface CheckResults {
  ssl: CheckResult;
  dns: CheckResult;
  serverResponse: CheckResult;
  pageSpeed: CheckResult;
  mobile: CheckResult;
  https: CheckResult;
  availability: CheckResult;
  email: CheckResult;
}

export interface ScanResponse {
  url: string;
  timestamp: string;
  overallScore: number;
  scoreLevel: string;
  scoreColor: string;
  checks: CheckResults;
  criticalIssues: string[];
  recommendations: string[];
}

export interface ScoreConfig {
  min: number;
  max: number;
  level: string;
  color: string;
}

export interface Env {
  GOOGLE_PAGESPEED_API_KEY: string;
  RATE_LIMITER: KVNamespace;
}

export interface DNSResponse {
  Status: number;
  AD?: boolean; // Authenticated Data flag (DNSSEC)
  Answer?: Array<{
    name: string;
    type: number;
    TTL: number;
    data: string;
  }>;
}

export interface PageSpeedResponse {
  lighthouseResult: {
    categories: {
      performance: {
        score: number;
      };
    };
    audits: {
      "first-contentful-paint": {
        displayValue: string;
        numericValue: number;
      };
      "largest-contentful-paint": {
        displayValue: string;
        numericValue: number;
      };
      "cumulative-layout-shift": {
        displayValue: string;
        numericValue: number;
      };
    };
  };
}
