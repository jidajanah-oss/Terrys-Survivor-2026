export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      league_snapshots: {
        Row: { league_id: string; state: Json; updated_at: string; updated_by: string | null };
        Insert: { league_id: string; state: Json; updated_at?: string; updated_by?: string | null };
        Update: { state?: Json; updated_at?: string; updated_by?: string | null };
        Relationships: [];
      };
      profiles: {
        Row: { id: string; display_name: string; email: string | null; created_at: string; updated_at: string };
        Insert: { id: string; display_name: string; email?: string | null; created_at?: string; updated_at?: string };
        Update: { display_name?: string; email?: string | null; updated_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
