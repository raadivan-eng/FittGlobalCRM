import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Fuera del bundle de Next para que OpenNext resuelva Prisma con la condición
  // `workerd` (motor wasm) y no con el binario nativo de Node.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
