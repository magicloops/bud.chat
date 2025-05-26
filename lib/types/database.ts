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
      workspace: {
        Row: {
          id: string
          name: string
          owner_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          owner_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          owner_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      conversation: {
        Row: {
          id: string
          workspace_id: string
          title: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          title?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          title?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          }
        ]
      }
      message: {
        Row: {
          id: string
          convo_id: string | null
          parent_id: string | null
          path: string
          role: Database["public"]["Enums"]["role"]
          content: string
          metadata: Json
          revision: number | null
          supersedes_id: string | null
          token_count: number | null
          usage_ms: number | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          convo_id?: string | null
          parent_id?: string | null
          path: string
          role: Database["public"]["Enums"]["role"]
          content: string
          metadata?: Json
          revision?: number | null
          supersedes_id?: string | null
          token_count?: number | null
          usage_ms?: number | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          convo_id?: string | null
          parent_id?: string | null
          path?: string
          role?: Database["public"]["Enums"]["role"]
          content?: string
          metadata?: Json
          revision?: number | null
          supersedes_id?: string | null
          token_count?: number | null
          usage_ms?: number | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_convo_id_fkey"
            columns: ["convo_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      usage: {
        Row: {
          id: string
          user_id: string | null
          message_id: string | null
          model: string
          prompt_tokens: number
          completion_tokens: number
          cost_cents: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          message_id?: string | null
          model: string
          prompt_tokens?: number
          completion_tokens?: number
          cost_cents?: number
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          message_id?: string | null
          model?: string
          prompt_tokens?: number
          completion_tokens?: number
          cost_cents?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message"
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
      role: "system" | "user" | "assistant" | "tool"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}