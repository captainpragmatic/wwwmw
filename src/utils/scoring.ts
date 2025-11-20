/**
 * Scoring and recommendation logic
 */

import type { CheckResults, ScoreConfig } from "../types";

const SCORE_LEVELS: ScoreConfig[] = [
  {
    min: 85,
    max: 100,
    level: "EXCELLENT - Great website health!",
    color: "#28a745",
  },
  {
    min: 70,
    max: 84,
    level: "GOOD - Minor improvements needed",
    color: "#17a2b8",
  },
  {
    min: 50,
    max: 69,
    level: "NEEDS WORK - Several issues to fix",
    color: "#ffc107",
  },
  {
    min: 0,
    max: 49,
    level: "POOR - Serious problems detected",
    color: "#dc3545",
  },
];

export function calculateOverallScore(checks: CheckResults): number {
  const scores = [
    checks.ssl.score,
    checks.dns.score,
    checks.serverResponse.score,
    checks.pageSpeed.score,
    checks.mobile.score,
    checks.https.score,
    checks.availability.score,
    checks.email.score,
  ];

  return scores.reduce((sum, score) => sum + score, 0);
}

export function getScoreLevel(score: number): { level: string; color: string } {
  const config = SCORE_LEVELS.find(
    (level) => score >= level.min && score <= level.max
  );

  return {
    level: config?.level || "Unknown",
    color: config?.color || "#6c757d",
  };
}

export function identifyCriticalIssues(checks: CheckResults): string[] {
  const issues: string[] = [];

  if (checks.ssl.status === "fail") {
    issues.push("No HTTPS - Site is insecure");
  }

  if (checks.availability.status === "fail") {
    issues.push("Site is currently offline");
  }

  if (checks.serverResponse.status === "fail") {
    issues.push("Server response is very slow");
  }

  if (checks.pageSpeed.status === "fail") {
    issues.push(
      "Poor page performance - significantly impacts user experience"
    );
  }

  return issues;
}

export function generateRecommendations(checks: CheckResults): string[] {
  const recommendations: string[] = [];

  // SSL/HTTPS recommendations
  const sslDetails = checks.ssl.details || {};

  if (checks.ssl.status === "fail" || checks.https.status === "fail") {
    recommendations.push(
      "Enable HTTPS with Let's Encrypt (free, 30 min setup)"
    );
  } else if (checks.ssl.status === "warn") {
    // Check for certificate expiration warning
    if (
      sslDetails.expiringSoon ||
      (sslDetails.daysUntilExpiry && sslDetails.daysUntilExpiry < 30)
    ) {
      recommendations.push(
        `Renew your SSL certificate soon (expires in ${sslDetails.daysUntilExpiry} days)`
      );
    } else if (sslDetails.expired) {
      recommendations.push(
        "Your SSL certificate has expired - renew immediately to maintain security"
      );
    }
  }

  // PageSpeed recommendations
  if (checks.pageSpeed.status === "fail") {
    recommendations.push(
      "Optimize images and enable caching to improve load times"
    );
  } else if (checks.pageSpeed.status === "warn") {
    recommendations.push(
      "Consider optimizing images and minifying CSS/JS for better performance"
    );
  }

  // Server response recommendations
  if (checks.serverResponse.status === "fail") {
    recommendations.push(
      "Consider upgrading hosting for faster response times"
    );
  } else if (checks.serverResponse.status === "warn") {
    recommendations.push(
      "Server response could be faster - consider CDN or server optimization"
    );
  }

  // DNS recommendations
  const dnsDetails = checks.dns.details || {};

  if (checks.dns.status === "fail") {
    recommendations.push(
      "Move to a faster DNS provider (Cloudflare or Google DNS recommended)"
    );
  } else if (checks.dns.status === "warn") {
    recommendations.push(
      "Optimize DNS by using an Anycast resolver for better global performance"
    );
  }

  // DNSSEC recommendation
  if (dnsDetails.dnssecValid === false) {
    recommendations.push(
      "Enable DNSSEC on your domain for tamper protection and security"
    );
  }

  // CDN recommendation (if slow DNS and no CDN detected)
  if (
    !dnsDetails.cdnDetected &&
    (checks.dns.status === "warn" || checks.dns.status === "fail")
  ) {
    recommendations.push(
      "Consider using a CDN (Cloudflare/Fastly) for edge caching and faster global access"
    );
  }

  // Mobile recommendations
  if (checks.mobile.status === "fail") {
    recommendations.push(
      "Improve mobile responsiveness and mobile-specific optimizations"
    );
  } else if (checks.mobile.status === "warn") {
    recommendations.push(
      "Fine-tune mobile experience for better user engagement"
    );
  }

  // Email recommendations
  if (checks.email.status === "warn") {
    recommendations.push(
      "Configure MX records to enable email for your domain"
    );
  }

  // If everything is good
  if (recommendations.length === 0) {
    recommendations.push("Great job! Keep monitoring your site regularly");
  }

  return recommendations;
}
