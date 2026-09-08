import type { NextConfig } from "next";
import { networkInterfaces, type NetworkInterfaceInfo } from "os";

// A hardcoded LAN IP breaks phone testing the moment DHCP/Wi-Fi reassigns it, leaving the dev server to silently refuse cross-origin requests (page loads but never finishes hydrating, so every button looks present but does nothing).
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((iface): iface is NetworkInterfaceInfo => Boolean(iface))
  .filter((iface) => iface.family === "IPv4" && !iface.internal)
  .map((iface) => iface.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: [...new Set(["192.168.2.118", "127.0.0.1", "localhost", ...lanAddresses])],
};

export default nextConfig;
