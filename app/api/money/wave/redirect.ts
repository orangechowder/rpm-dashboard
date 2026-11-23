// The address Wave sends the person back to after they allow access. Must match the Wave app's redirect URL exactly.
export function redirectUri(request: Request): string {
  return process.env.WAVE_REDIRECT_URI || `${new URL(request.url).origin}/api/money/wave/callback`;
}
