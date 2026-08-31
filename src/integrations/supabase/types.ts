export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      jrc_check_runs: {
        Row: {
          created_at: string
          id: string
          message: string
          proposals_created: number
          rows_parsed: number
          source_type: string
          source_url: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string
          proposals_created?: number
          rows_parsed?: number
          source_type?: string
          source_url?: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          proposals_created?: number
          rows_parsed?: number
          source_type?: string
          source_url?: string
          status?: string
        }
        Relationships: []
      }
      jrc_source_snapshots: {
        Row: {
          created_at: string
          entry_key: string
          fingerprint: string
          id: string
          source_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entry_key: string
          fingerprint: string
          id?: string
          source_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entry_key?: string
          fingerprint?: string
          id?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      jrc_update_proposals: {
        Row: {
          card_id: string | null
          changes: Json
          country: string
          created_at: string
          fingerprint: string
          generation: string
          id: string
          jrc_card_name: string
          jrc_certificate: string
          jrc_date: string
          jrc_eov: string
          jrc_manufacturer: string
          jrc_type_approval: string
          kind: string
          payload: Json
          source_label: string
          source_type: string
          source_url: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          card_id?: string | null
          changes?: Json
          country?: string
          created_at?: string
          fingerprint: string
          generation?: string
          id?: string
          jrc_card_name?: string
          jrc_certificate?: string
          jrc_date?: string
          jrc_eov?: string
          jrc_manufacturer?: string
          jrc_type_approval?: string
          kind?: string
          payload?: Json
          source_label?: string
          source_type?: string
          source_url?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          card_id?: string | null
          changes?: Json
          country?: string
          created_at?: string
          fingerprint?: string
          generation?: string
          id?: string
          jrc_card_name?: string
          jrc_certificate?: string
          jrc_date?: string
          jrc_eov?: string
          jrc_manufacturer?: string
          jrc_type_approval?: string
          kind?: string
          payload?: Json
          source_label?: string
          source_type?: string
          source_url?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jrc_update_proposals_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "tachograph_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      tachograph_card_overrides: {
        Row: {
          card_id: string
          created_at: string
          edited_by: string | null
          id: string
          patch: Json
          updated_at: string
        }
        Insert: {
          card_id: string
          created_at?: string
          edited_by?: string | null
          id?: string
          patch?: Json
          updated_at?: string
        }
        Update: {
          card_id?: string
          created_at?: string
          edited_by?: string | null
          id?: string
          patch?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tachograph_card_overrides_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: true
            referencedRelation: "tachograph_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      tachograph_cards: {
        Row: {
          application: string
          certificate_holder: string
          certified_security_platform: string
          chip_certificate: string
          chip_platform_vendor: string
          country: string
          country_flag: string
          created_at: string
          current_manufacturer: string
          current_manufacturer_normalized: string
          data_reference_date: string
          date_status: string
          distinction_from_manufacturer: string
          functional_certificate_lab: string
          generation: string
          id: string
          issued_by_authority: string
          jrc_certificate_source: string
          jrc_interoperability_status: string
          latest_tender: string
          primary_source: string
          procurement_scope: string
          procurement_status: string
          security_certificate: string
          security_certificate_lab: string
          tachograph_application_os: string
          tender_source: string
          type_approval_number: string
          updated_at: string
          verification_note: string
          winner_contractor: string
        }
        Insert: {
          application?: string
          certificate_holder?: string
          certified_security_platform?: string
          chip_certificate?: string
          chip_platform_vendor?: string
          country: string
          country_flag?: string
          created_at?: string
          current_manufacturer?: string
          current_manufacturer_normalized?: string
          data_reference_date?: string
          date_status?: string
          distinction_from_manufacturer?: string
          functional_certificate_lab?: string
          generation?: string
          id?: string
          issued_by_authority?: string
          jrc_certificate_source?: string
          jrc_interoperability_status?: string
          latest_tender?: string
          primary_source?: string
          procurement_scope?: string
          procurement_status?: string
          security_certificate?: string
          security_certificate_lab?: string
          tachograph_application_os?: string
          tender_source?: string
          type_approval_number?: string
          updated_at?: string
          verification_note?: string
          winner_contractor?: string
        }
        Update: {
          application?: string
          certificate_holder?: string
          certified_security_platform?: string
          chip_certificate?: string
          chip_platform_vendor?: string
          country?: string
          country_flag?: string
          created_at?: string
          current_manufacturer?: string
          current_manufacturer_normalized?: string
          data_reference_date?: string
          date_status?: string
          distinction_from_manufacturer?: string
          functional_certificate_lab?: string
          generation?: string
          id?: string
          issued_by_authority?: string
          jrc_certificate_source?: string
          jrc_interoperability_status?: string
          latest_tender?: string
          primary_source?: string
          procurement_scope?: string
          procurement_status?: string
          security_certificate?: string
          security_certificate_lab?: string
          tachograph_application_os?: string
          tender_source?: string
          type_approval_number?: string
          updated_at?: string
          verification_note?: string
          winner_contractor?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
