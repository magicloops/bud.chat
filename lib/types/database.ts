export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          created_at?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          id: string
          name: string
          owner_user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          owner_user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          owner_user_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      workspace_members: {
        Row: {
          workspace_id: string
          user_id: string
          role: string
        }
        Insert: {
          workspace_id: string
          user_id: string
          role?: string
        }
        Update: {
          workspace_id?: string
          user_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      buds: {
        Row: {
          id: string
          owner_user_id: string | null
          workspace_id: string | null
          name: string
          default_json: Json
          created_at: string
        }
        Insert: {
          id?: string
          owner_user_id?: string | null
          workspace_id?: string | null
          name: string
          default_json: Json
          created_at?: string
        }
        Update: {
          id?: string
          owner_user_id?: string | null
          workspace_id?: string | null
          name?: string
          default_json?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buds_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buds_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      }
      conversations: {
        Row: {
          id: string
          workspace_id: string
          root_msg_id: string | null
          bud_id: string | null
          title: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          root_msg_id?: string | null
          bud_id?: string | null
          title?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          root_msg_id?: string | null
          bud_id?: string | null
          title?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_bud_id_fkey"
            columns: ["bud_id"]
            isOneToOne: false
            referencedRelation: "buds"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      role: "system" | "user" | "assistant"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}