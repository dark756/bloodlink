const isDevelopment = process.env.NODE_ENV === "development";
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "";

// The browser talks only to the app itself, Supabase (sign-in) and CARTO (map tiles).
// eRaktKosh, OSRM, Open-Meteo and Nominatim are called by the server. Next.js needs
// inline scripts without nonces, and React needs eval in development only.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://basemaps.cartocdn.com",
  "font-src 'self'",
  `connect-src 'self' ${supabaseOrigin}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  // No other site may frame bloodLink; X-Frame-Options covers older browsers.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Only bloodLink's own pages may ask for the location ("Use My Location").
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // The full policy is reported in the browser console, not enforced, until it has
  // been checked on every page.
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Google profile pictures shown in the header and profile page.
    remotePatterns: [{ protocol: "https", hostname: "lh3.googleusercontent.com" }],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  async redirects() {
    // The old search iterations now live in archive/; keep their URLs working.
    return ["v1", "v2", "v3"].map((version) => ({
      source: `/search/${version}`,
      destination: "/search",
      permanent: false,
    }));
  },
};

export default nextConfig;
