'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

type SortConfig = {
  column: string
  ascending?: boolean
}

type UseRealtimeTableResult<T> = {
  data: T[]
  loading: boolean
  error: string | null
}

/**
 * Generic hook for fetching a Supabase table and subscribing to realtime changes.
 *
 * @param table  - The table name in the 'public' schema (e.g. 'comments')
 * @param sort   - Optional { column, ascending } sort applied to the initial fetch
 */
export default function useRealtimeTable<T extends { id: string | number }>(
  table: string,
  sort?: SortConfig
): UseRealtimeTableResult<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        let query = supabase.from(table).select('*')

        if (sort) {
          query = query.order(sort.column, {
            ascending: sort.ascending ?? true,
          })
        }

        const { data: rows, error: fetchError } = await query

        if (fetchError) throw fetchError

        if (!cancelled) {
          setData((rows ?? []) as T[])
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch data')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()

    const channel = supabase
      .channel(`${table}-realtime`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload: RealtimePostgresChangesPayload<T>) => {
          if (cancelled) return

          const { eventType, new: newRow, old: oldRow } = payload

          setData((prev) => {
            switch (eventType) {
              case 'INSERT':
                return [newRow as T, ...prev]

              case 'UPDATE':
                return prev.map((item) =>
                  item.id === (newRow as T).id ? (newRow as T) : item
                )

              case 'DELETE': {
                const deletedId =
                  (oldRow as Record<string, unknown>)?.id ??
                  (newRow as Record<string, unknown>)?.id
                return prev.filter((item) => item.id !== deletedId)
              }

              default:
                return prev
            }
          })
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [table, JSON.stringify(sort)])

  return { data, loading, error }
}
