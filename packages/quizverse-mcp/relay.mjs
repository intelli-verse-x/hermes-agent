#!/usr/bin/env node
import net from 'node:net'

const socketPath = process.env.QUIZVERSE_MCP_SERVER_SOCKET || ''

if (!socketPath) {
  process.stderr.write('QuizVerse MCP server socket is not configured\n')
  process.exit(1)
}

const socket = net.createConnection(socketPath)

socket.on('connect', () => {
  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
})
socket.on('error', error => {
  process.stderr.write(`QuizVerse MCP relay failed: ${error.message}\n`)
  process.exitCode = 1
})
socket.on('close', () => process.exit())
process.on('SIGTERM', () => socket.destroy())
