import type { SurvivorState } from "../types/survivor";

export interface StateRepository {
  load(): Promise<SurvivorState | null>;
  save(state: SurvivorState): Promise<void>;
}

export class LocalStateRepository implements StateRepository {
  constructor(private readonly storageKey: string) {}
  async load(): Promise<SurvivorState | null> {
    const raw = localStorage.getItem(this.storageKey);
    return raw ? JSON.parse(raw) as SurvivorState : null;
  }
  async save(state: SurvivorState): Promise<void> {
    localStorage.setItem(this.storageKey, JSON.stringify(state));
  }
}

// Supabase implementation will replace this adapter without changing UI/domain code.
export class SupabaseStateRepository implements StateRepository {
  async load(): Promise<SurvivorState | null> { throw new Error("Supabase is not configured yet."); }
  async save(_state: SurvivorState): Promise<void> { throw new Error("Supabase is not configured yet."); }
}
