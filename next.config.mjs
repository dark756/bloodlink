/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Google profile pictures shown in the header and profile page.
    remotePatterns: [{ protocol: "https", hostname: "lh3.googleusercontent.com" }],
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
