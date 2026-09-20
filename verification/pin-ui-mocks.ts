// Deliberately disconnected from Supabase. Only loaded by pin-ui.config.ts.
export const cloudConfigured = true;
const memberships = [
  { memberId: "entry-one", leagueId: "fixture", displayName: "Player One", email: "player@example.test", role: "player", status: "active" },
  { memberId: "entry-two", leagueId: "fixture", displayName: "Player Two", email: "player@example.test", role: "player", status: "active" },
];
export const getCurrentSession = async () => null;
export const subscribeToAuth = () => () => {};
export const claimMembershipByEmail = async () => memberships[0];
export const getMyMemberships = async () => memberships;
export const bootstrapLeague = async () => memberships[0];
export const signOut = async () => {};
export const sendEmailOtp = async () => {};
export const verifyEmailOtp = async () => ({ user: { email: "player@example.test" } });
export const signInWithPin = async (name: string, pin: string, beforeSession: (id: string) => void) => {
  if (pin !== "0042" || !memberships.some(m => m.displayName.toLowerCase() === name.toLowerCase())) {
    throw new Error("Entry name or PIN was not accepted. Ask Terry or Jimbo to reset your PIN, or use email sign-in.");
  }
  beforeSession(memberships.find(m => m.displayName.toLowerCase() === name.toLowerCase())!.memberId);
  return { user: { email: "player@example.test" } };
};
export const listLeagueRosterMemberships = async () => memberships.map(m => ({ ...m, id: m.memberId, userId: "owner" }));
let status = { configured: false, enabled: false, locked: false, lastSuccessAt: null };
export const managePin = async (action: string) => {
  if (action === "configure") status = { ...status, configured: true, enabled: true };
  if (action === "disable") status = { ...status, enabled: false };
  return { ...status };
};
