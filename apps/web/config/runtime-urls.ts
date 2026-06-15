type RuntimeEnv = Record<string, string | undefined>;

export function resolveRemoteApiUrl(env: RuntimeEnv): string {
  const explicitRemote = env.REMOTE_API_URL?.trim();
  if (explicitRemote) return explicitRemote;

  const publicApi = env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApi) return publicApi;

  // Do not read PORT here: `next dev` sets PORT to the frontend listen port
  // (3000), which would proxy /api and /auth back to itself and hang.
  const port =
    env.BACKEND_PORT?.trim() ||
    env.API_PORT?.trim() ||
    env.SERVER_PORT?.trim();
  if (port) return `http://localhost:${port}`;

  return "http://localhost:8080";
}
