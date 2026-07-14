export interface RealtimeAdapter {
  close: (id: string) => Promise<void>
  connect: () => Promise<{ id: string; userId: string }>
  send: (id: string, opCode: number, payload: Record<string, unknown>) => Promise<void>
}

export function createRealtimeChannel(adapter: RealtimeAdapter) {
  let connection: null | { id: string; userId: string } = null

  return {
    async close() {
      if (!connection) {
        return
      }

      const current = connection
      connection = null
      await adapter.close(current.id)
    },
    async connect() {
      if (!connection) {
        connection = await adapter.connect()
      }

      return connection
    },
    async send(opCode: number, payload: Record<string, unknown>) {
      const current = await this.connect()
      await adapter.send(current.id, opCode, payload)
    }
  }
}
