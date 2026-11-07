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
      admin_users: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          role: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          role?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      approval_records: {
        Row: {
          approver: string | null
          approver_role: string | null
          comments: string | null
          decision: string
          id: string
          proposal_id: string
          proposal_title: string | null
          stage: string
          timestamp: string | null
        }
        Insert: {
          approver?: string | null
          approver_role?: string | null
          comments?: string | null
          decision?: string
          id: string
          proposal_id: string
          proposal_title?: string | null
          stage: string
          timestamp?: string | null
        }
        Update: {
          approver?: string | null
          approver_role?: string | null
          comments?: string | null
          decision?: string
          id?: string
          proposal_id?: string
          proposal_title?: string | null
          stage?: string
          timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_records_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_templates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          opportunity_type: string | null
          sections: Json
          status: string
          tags: string[]
          updated_at: string
          version: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          opportunity_type?: string | null
          sections?: Json
          status?: string
          tags?: string[]
          updated_at?: string
          version?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          opportunity_type?: string | null
          sections?: Json
          status?: string
          tags?: string[]
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      proposals: {
        Row: {
          approval_progress: number | null
          client_group: string | null
          client_name: string
          created_at: string | null
          currency: string | null
          deal_type: string | null
          discount: number | null
          expected_duration: string | null
          expected_revenue: number | null
          geography: string | null
          gross_margin: number | null
          id: string
          industry: string | null
          lob: string | null
          modules: string[]
          opportunity_type: string | null
          owner: string | null
          priority: string | null
          risk_level: string | null
          status: string
          submission_date: string | null
          title: string
          updated_at: string | null
          metadata: Json | null
        }
        Insert: {
          approval_progress?: number | null
          client_group?: string | null
          client_name?: string
          created_at?: string | null
          currency?: string | null
          deal_type?: string | null
          discount?: number | null
          expected_duration?: string | null
          expected_revenue?: number | null
          geography?: string | null
          gross_margin?: number | null
          id: string
          industry?: string | null
          lob?: string | null
          modules?: string[]
          opportunity_type?: string | null
          owner?: string | null
          priority?: string | null
          risk_level?: string | null
          status?: string
          submission_date?: string | null
          title: string
          updated_at?: string | null
          metadata?: Json | null
        }
        Update: {
          approval_progress?: number | null
          client_group?: string | null
          client_name?: string
          created_at?: string | null
          currency?: string | null
          deal_type?: string | null
          discount?: number | null
          expected_duration?: string | null
          expected_revenue?: number | null
          geography?: string | null
          gross_margin?: number | null
          id?: string
          industry?: string | null
          lob?: string | null
          modules?: string[]
          opportunity_type?: string | null
          owner?: string | null
          priority?: string | null
          risk_level?: string | null
          status?: string
          submission_date?: string | null
          title?: string
          updated_at?: string | null
          metadata?: Json | null
        }
        Relationships: []
      }
      proposal_resources: {
        Row: {
          id: string
          proposal_id: string
          role_id: string
          role: string
          hours: number
          billing_rate: number
          cost_rate: number
          loaded_cost_rate: number
          location_type: string
          geography: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          proposal_id: string
          role_id: string
          role: string
          hours?: number
          billing_rate: number
          cost_rate: number
          loaded_cost_rate: number
          location_type: string
          geography: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          proposal_id?: string
          role_id?: string
          role?: string
          hours?: number
          billing_rate?: number
          cost_rate?: number
          loaded_cost_rate?: number
          location_type?: string
          geography?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_items: {
        Row: {
          id: string
          title: string
          type: string
          lob: string
          industry: string
          geography: string
          modules: string[]
          version: string
          approval_status: string
          owner: string
          upload_date: string
          last_updated: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          title: string
          type: string
          lob: string
          industry: string
          geography: string
          modules?: string[]
          version?: string
          approval_status?: string
          owner: string
          upload_date: string
          last_updated: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          type?: string
          lob?: string
          industry?: string
          geography?: string
          modules?: string[]
          version?: string
          approval_status?: string
          owner?: string
          upload_date?: string
          last_updated?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      resources: {
        Row: {
          availability: string
          billing_rate: number
          bio: string | null
          certifications: string[]
          cost_loading_percentage: number
          cost_rate: number
          created_at: string
          currency: string
          designation: string
          email: string | null
          employment_type: string
          geography: string
          id: string
          key_projects: string[]
          languages: string[]
          name: string
          phone: string | null
          profile_summary: string | null
          sap_modules: string[]
          skills: string[]
          updated_at: string
          years_of_experience: number
        }
        Insert: {
          availability?: string
          billing_rate?: number
          bio?: string | null
          certifications?: string[]
          cost_loading_percentage?: number
          cost_rate?: number
          created_at?: string
          currency?: string
          designation?: string
          email?: string | null
          employment_type?: string
          geography?: string
          id?: string
          key_projects?: string[]
          languages?: string[]
          name: string
          phone?: string | null
          profile_summary?: string | null
          sap_modules?: string[]
          skills?: string[]
          updated_at?: string
          years_of_experience?: number
        }
        Update: {
          availability?: string
          billing_rate?: number
          bio?: string | null
          certifications?: string[]
          cost_loading_percentage?: number
          cost_rate?: number
          created_at?: string
          currency?: string
          designation?: string
          email?: string | null
          employment_type?: string
          geography?: string
          id?: string
          key_projects?: string[]
          languages?: string[]
          name?: string
          phone?: string | null
          profile_summary?: string | null
          sap_modules?: string[]
          skills?: string[]
          updated_at?: string
          years_of_experience?: number
        }
        Relationships: []
      }
      workflow_stages: {
        Row: {
          approver: string
          created_at: string
          id: string
          mandatory: boolean
          sort_order: number
          stage: string
          updated_at: string
        }
        Insert: {
          approver?: string
          created_at?: string
          id?: string
          mandatory?: boolean
          sort_order?: number
          stage: string
          updated_at?: string
        }
        Update: {
          approver?: string
          created_at?: string
          id?: string
          mandatory?: boolean
          sort_order?: number
          stage?: string
          updated_at?: string
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