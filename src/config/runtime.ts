export const runtimeConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  nflProviderUrl: import.meta.env.VITE_NFL_PROVIDER_URL ?? "",
  leagueId: import.meta.env.VITE_SURVIVOR_LEAGUE_ID ?? "",
};

export const cloudConfigured = Boolean(runtimeConfig.supabaseUrl && runtimeConfig.supabaseAnonKey);
export const leagueConfigured = Boolean(runtimeConfig.leagueId);
