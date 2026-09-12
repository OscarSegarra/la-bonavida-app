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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      dietary_tags: {
        Row: {
          category: string
          code: string
          id: number
          sort_order: number
        }
        Insert: {
          category: string
          code: string
          id?: never
          sort_order: number
        }
        Update: {
          category?: string
          code?: string
          id?: never
          sort_order?: number
        }
        Relationships: []
      }
      food_groups: {
        Row: {
          code: string
          id: number
          sort_order: number
          source_note: string | null
        }
        Insert: {
          code: string
          id?: never
          sort_order: number
          source_note?: string | null
        }
        Update: {
          code?: string
          id?: never
          sort_order?: number
          source_note?: string | null
        }
        Relationships: []
      }
      household_invites: {
        Row: {
          created_at: string
          household_id: number
          id: number
          invited_by: string | null
          role: string
          token: string
        }
        Insert: {
          created_at?: string
          household_id: number
          id?: never
          invited_by?: string | null
          role: string
          token?: string
        }
        Update: {
          created_at?: string
          household_id?: number
          id?: never
          invited_by?: string | null
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_invites_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          created_at: string
          household_id: number
          id: number
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id: number
          id?: never
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: number
          id?: never
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          id: number
          name: string
          region_id: number
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          region_id: number
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          region_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "households_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_allowed_units: {
        Row: {
          ingredient_id: number
          is_default: boolean
          unit_id: number
        }
        Insert: {
          ingredient_id: number
          is_default?: boolean
          unit_id: number
        }
        Update: {
          ingredient_id?: number
          is_default?: boolean
          unit_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_allowed_units_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_allowed_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_dietary_tags: {
        Row: {
          ingredient_id: number
          tag_id: number
        }
        Insert: {
          ingredient_id: number
          tag_id: number
        }
        Update: {
          ingredient_id?: number
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_dietary_tags_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_dietary_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "dietary_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_nutrients: {
        Row: {
          amount: number
          ingredient_id: number
          nutrient_id: number
        }
        Insert: {
          amount: number
          ingredient_id: number
          nutrient_id: number
        }
        Update: {
          amount?: number
          ingredient_id?: number
          nutrient_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_nutrients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_nutrients_nutrient_id_fkey"
            columns: ["nutrient_id"]
            isOneToOne: false
            referencedRelation: "nutrients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_seasonality: {
        Row: {
          ingredient_id: number
          month: number
          region_id: number
        }
        Insert: {
          ingredient_id: number
          month: number
          region_id: number
        }
        Update: {
          ingredient_id?: number
          month?: number
          region_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_seasonality_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_seasonality_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_translations: {
        Row: {
          ingredient_id: number
          locale: string
          name: string
        }
        Insert: {
          ingredient_id: number
          locale: string
          name: string
        }
        Update: {
          ingredient_id?: number
          locale?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_translations_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_translations_locale_fkey"
            columns: ["locale"]
            isOneToOne: false
            referencedRelation: "locales"
            referencedColumns: ["code"]
          },
        ]
      }
      ingredients: {
        Row: {
          code: string
          created_at: string
          density_g_per_ml: number | null
          food_group_id: number
          grams_per_unit: number | null
          id: number
          nutrition_basis: string
          retired_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          density_g_per_ml?: number | null
          food_group_id: number
          grams_per_unit?: number | null
          id?: never
          nutrition_basis: string
          retired_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          density_g_per_ml?: number | null
          food_group_id?: number
          grams_per_unit?: number | null
          id?: never
          nutrition_basis?: string
          retired_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_food_group_id_fkey"
            columns: ["food_group_id"]
            isOneToOne: false
            referencedRelation: "food_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      locales: {
        Row: {
          code: string
          is_default: boolean
          name: string
        }
        Insert: {
          code: string
          is_default?: boolean
          name: string
        }
        Update: {
          code?: string
          is_default?: boolean
          name?: string
        }
        Relationships: []
      }
      nutrients: {
        Row: {
          category: string
          code: string
          eu_mandatory: boolean
          id: number
          measure_unit: string
          sort_order: number
        }
        Insert: {
          category: string
          code: string
          eu_mandatory?: boolean
          id?: never
          measure_unit: string
          sort_order: number
        }
        Update: {
          category?: string
          code?: string
          eu_mandatory?: boolean
          id?: never
          measure_unit?: string
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          alias: string
          created_at: string
          id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      regions: {
        Row: {
          code: string
          id: number
          is_default: boolean
        }
        Insert: {
          code: string
          id?: never
          is_default?: boolean
        }
        Update: {
          code?: string
          id?: never
          is_default?: boolean
        }
        Relationships: []
      }
      units: {
        Row: {
          code: string
          dimension: string
          id: number
          to_base_factor: number
        }
        Insert: {
          code: string
          dimension: string
          id?: never
          to_base_factor: number
        }
        Update: {
          code?: string
          dimension?: string
          id?: never
          to_base_factor?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_household_invite: { Args: { _token: string }; Returns: number }
      create_household: { Args: { _name: string }; Returns: number }
      get_household_invite: {
        Args: { _token: string }
        Returns: {
          household_id: number
          household_name: string
          role: string
        }[]
      }
      set_ingredient_retired: {
        Args: { _code: string; _retired: boolean }
        Returns: number
      }
      upsert_ingredient: { Args: { payload: Json }; Returns: number }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
