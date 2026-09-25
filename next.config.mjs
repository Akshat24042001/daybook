/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  // instrumentation.ts runs automatically in Next.js 15 — no extra flag needed
  poweredByHeader: false,
  // bootstrap.ts applies db/migrations/*.sql on cold start: make sure the files ship with every function
  outputFileTracingIncludes: { "/**": ["./db/migrations/*.sql"] },
  webpack(config) {
    // Only when node_modules is a junction to another drive (local machine with a nearly full D:).
    if (process.env.DAYBOOK_LINKED_MODULES === "1") {
      config.resolve.symlinks = false;
      config.resolveLoader = { ...config.resolveLoader, symlinks: false };
    }
    return config;
  },
};
export default nextConfig;
