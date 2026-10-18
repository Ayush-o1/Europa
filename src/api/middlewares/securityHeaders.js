/**
 * @fileoverview Defense-in-Depth HTTP Security Headers Middleware
 *
 * Enforces protective response headers guarding against MIME-sniffing, clickjacking,
 * cross-site framing, and unauthorized browser feature utilization.
 */

export function securityHeaders(req, res, next) {
  // Prevent browser MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Guard against clickjacking in external frames
  res.setHeader('X-Frame-Options', 'DENY');

  // Disable legacy browser XSS filtering which can introduce vulnerabilities
  res.setHeader('X-XSS-Protection', '0');

  // Control referrer information leakage
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restrict sensitive browser APIs
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content Security Policy tailored for Europa SPA workbench
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none';",
  );

  next();
}
