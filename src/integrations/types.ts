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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      acampantes: {
        Row: {
          apellido_materno: string | null
          apellido_paterno: string | null
          created_at: string
          dni: string
          fecha_nacimiento: string | null
          fuente: string
          nombre_completo: string
          nombres: string | null
          updated_at: string
        }
        Insert: {
          apellido_materno?: string | null
          apellido_paterno?: string | null
          created_at?: string
          dni: string
          fecha_nacimiento?: string | null
          fuente?: string
          nombre_completo: string
          nombres?: string | null
          updated_at?: string
        }
        Update: {
          apellido_materno?: string | null
          apellido_paterno?: string | null
          created_at?: string
          dni?: string
          fecha_nacimiento?: string | null
          fuente?: string
          nombre_completo?: string
          nombres?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      empleador: {
        Row: {
          id: boolean
          razon_social: string
          ruc: string
          tolerancia_min: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          razon_social?: string
          ruc?: string
          tolerancia_min?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          razon_social?: string
          ruc?: string
          tolerancia_min?: number
          updated_at?: string
        }
        Relationships: []
      }
      jornadas: {
        Row: {
          created_at: string
          dni: string
          entrada_at: string
          fecha: string
          id: string
          programada_fin: string | null
          programada_inicio: string | null
          refrigerio_min: number
          tolerancia_min: number
          turno_id: string | null
          turno_nombre: string | null
        }
        Insert: {
          created_at?: string
          dni: string
          entrada_at: string
          fecha: string
          id?: string
          programada_fin?: string | null
          programada_inicio?: string | null
          refrigerio_min?: number
          tolerancia_min?: number
          turno_id?: string | null
          turno_nombre?: string | null
        }
        Update: {
          created_at?: string
          dni?: string
          entrada_at?: string
          fecha?: string
          id?: string
          programada_fin?: string | null
          programada_inicio?: string | null
          refrigerio_min?: number
          tolerancia_min?: number
          turno_id?: string | null
          turno_nombre?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jornadas_dni_fkey"
            columns: ["dni"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["dni"]
          },
          {
            foreignKeyName: "jornadas_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos"
            referencedColumns: ["id"]
          },
        ]
      }
      marcas: {
        Row: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          created_at: string
          dni: string
          id: string
          jornada_id: string
          marcado_at: string
          motivo: string | null
          origen: string
          registrado_por: string
          tipo: string
        }
        Insert: {
          anulada_at?: string | null
          anulada_motivo?: string | null
          anulada_por?: string | null
          created_at?: string
          dni: string
          id?: string
          jornada_id: string
          marcado_at?: string
          motivo?: string | null
          origen?: string
          registrado_por: string
          tipo: string
        }
        Update: {
          anulada_at?: string | null
          anulada_motivo?: string | null
          anulada_por?: string | null
          created_at?: string
          dni?: string
          id?: string
          jornada_id?: string
          marcado_at?: string
          motivo?: string | null
          origen?: string
          registrado_por?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "marcas_jornada_id_fkey"
            columns: ["jornada_id"]
            isOneToOne: false
            referencedRelation: "jornadas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marcas_dni_fkey"
            columns: ["dni"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["dni"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          role: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          role?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      scan_lists: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          padron: Json | null
          padron_archivo: string | null
          title: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          padron?: Json | null
          padron_archivo?: string | null
          title: string
          user_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          padron?: Json | null
          padron_archivo?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      scanned_records: {
        Row: {
          dni_number: string
          fuente: string | null
          full_name: string
          id: string
          scan_list_id: string
          scanned_at: string
          user_id: string
        }
        Insert: {
          dni_number: string
          fuente?: string | null
          full_name: string
          id?: string
          scan_list_id: string
          scanned_at?: string
          user_id: string
        }
        Update: {
          dni_number?: string
          fuente?: string | null
          full_name?: string
          id?: string
          scan_list_id?: string
          scanned_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scanned_records_scan_list_id_fkey"
            columns: ["scan_list_id"]
            isOneToOne: false
            referencedRelation: "scan_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      trabajadores: {
        Row: {
          activo: boolean
          area: string | null
          cargo: string | null
          created_at: string
          dni: string
          nombre_completo: string
          turno_id: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          area?: string | null
          cargo?: string | null
          created_at?: string
          dni: string
          nombre_completo: string
          turno_id?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          area?: string | null
          cargo?: string | null
          created_at?: string
          dni?: string
          nombre_completo?: string
          turno_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trabajadores_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos"
            referencedColumns: ["id"]
          },
        ]
      }
      turnos: {
        Row: {
          activo: boolean
          created_at: string
          hora_fin: string
          hora_inicio: string
          id: string
          nombre: string
          refrigerio_min: number
        }
        Insert: {
          activo?: boolean
          created_at?: string
          hora_fin: string
          hora_inicio: string
          id?: string
          nombre: string
          refrigerio_min?: number
        }
        Update: {
          activo?: boolean
          created_at?: string
          hora_fin?: string
          hora_inicio?: string
          id?: string
          nombre?: string
          refrigerio_min?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      anular_marca: {
        Args: { p_id: string; p_motivo: string }
        Returns: undefined
      }
      es_rrhh: { Args: Record<PropertyKey, never>; Returns: boolean }
      marcar_asistencia: {
        Args: { p_dni: string; p_tipo?: string }
        Returns: Json
      }
      mi_rol: { Args: Record<PropertyKey, never>; Returns: string }
      registrar_marca_manual: {
        Args: {
          p_dni: string
          p_marcado_at: string
          p_motivo: string
          p_tipo: string
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
