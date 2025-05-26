import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspace_id')
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')

    let query = supabase
      .from('usage')
      .select(`
        *,
        message:message_id (
          convo_id,
          conversation:convo_id (
            workspace_id,
            title
          )
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (workspaceId) {
      // Filter by workspace through message -> conversation -> workspace relationship
      query = query.filter('message.conversation.workspace_id', 'eq', workspaceId)
    }

    if (startDate) {
      query = query.gte('created_at', startDate)
    }

    if (endDate) {
      query = query.lte('created_at', endDate)
    }

    const { data: usage, error } = await query

    if (error) {
      return new Response('Error fetching usage data', { status: 500 })
    }

    // Calculate totals
    const totals = usage?.reduce((acc, record) => {
      acc.totalTokens += (record.prompt_tokens + record.completion_tokens)
      acc.totalCostCents += Number(record.cost_cents)
      acc.totalMessages += 1
      
      if (!acc.byModel[record.model]) {
        acc.byModel[record.model] = {
          tokens: 0,
          costCents: 0,
          messages: 0
        }
      }
      
      acc.byModel[record.model].tokens += (record.prompt_tokens + record.completion_tokens)
      acc.byModel[record.model].costCents += Number(record.cost_cents)
      acc.byModel[record.model].messages += 1
      
      return acc
    }, {
      totalTokens: 0,
      totalCostCents: 0,
      totalMessages: 0,
      byModel: {} as Record<string, { tokens: number; costCents: number; messages: number }>
    }) || {
      totalTokens: 0,
      totalCostCents: 0,
      totalMessages: 0,
      byModel: {}
    }

    return Response.json({
      usage,
      totals
    })
  } catch (error) {
    return new Response('Internal server error', { status: 500 })
  }
}