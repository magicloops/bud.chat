#!/usr/bin/env node

// Simple HTTP MCP server compatible with OpenAI Responses API
import express from 'express'

const app = express()
app.use(express.json())

// Enable CORS for all origins (for testing)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
  if (req.method === 'OPTIONS') {
    res.sendStatus(200)
  } else {
    next()
  }
})

// Store for request logging
const requestLog = []

// Log all requests
app.use((req, res, next) => {
  const timestamp = new Date().toISOString()
  console.log(`\n📨 [${timestamp}] ${req.method} ${req.url}`)
  console.log('Headers:', JSON.stringify(req.headers, null, 2))
  console.log('Body:', JSON.stringify(req.body, null, 2))
  
  requestLog.push({
    timestamp,
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body
  })
  
  next()
})

// MCP JSON-RPC endpoint
app.post('/mcp', async (req, res) => {
  const { method, params, id } = req.body
  
  console.log(`🔧 Processing MCP method: ${method}`)
  
  try {
    switch (method) {
      case 'initialize':
        console.log('🚀 Initializing MCP server with params:', params)
        res.json({
          jsonrpc: '2.0',
          result: {
            protocolVersion: '2025-03-26', // Match OpenAI's version
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'simple-calculator',
              version: '1.0.0'
            }
          },
          id
        })
        break
        
      case 'tools/list':
        console.log('📋 Listing available tools')
        res.json({
          jsonrpc: '2.0',
          result: {
            tools: [
              {
                name: 'add',
                description: 'Add two numbers together',
                inputSchema: {
                  type: 'object',
                  properties: {
                    a: {
                      type: 'number',
                      description: 'First number'
                    },
                    b: {
                      type: 'number', 
                      description: 'Second number'
                    }
                  },
                  required: ['a', 'b'],
                  additionalProperties: false,
                  $schema: 'http://json-schema.org/draft-07/schema#'
                }
              },
              {
                name: 'multiply',
                description: 'Multiply two numbers',
                inputSchema: {
                  type: 'object',
                  properties: {
                    a: {
                      type: 'number',
                      description: 'First number'
                    },
                    b: {
                      type: 'number',
                      description: 'Second number'
                    }
                  },
                  required: ['a', 'b'],
                  additionalProperties: false,
                  $schema: 'http://json-schema.org/draft-07/schema#'
                }
              }
            ]
          },
          id
        })
        break
        
      case 'tools/call':
        console.log('🔧 Calling tool:', params?.name)
        const toolName = params?.name
        const args = params?.arguments || {}
        
        let result
        switch (toolName) {
          case 'add':
            result = {
              content: [
                {
                  type: 'text',
                  text: `${args.a} + ${args.b} = ${args.a + args.b}`
                }
              ]
            }
            break
            
          case 'multiply':
            result = {
              content: [
                {
                  type: 'text',
                  text: `${args.a} × ${args.b} = ${args.a * args.b}`
                }
              ]
            }
            break
            
          default:
            throw new Error(`Unknown tool: ${toolName}`)
        }
        
        res.json({
          jsonrpc: '2.0',
          result,
          id
        })
        break
        
      case 'initialized':
      case 'notifications/initialized':
        console.log('✅ MCP server initialized')
        // Notifications don't need a response with id
        if (method === 'notifications/initialized') {
          res.status(200).end() // Empty response for notifications
        } else {
          res.json({
            jsonrpc: '2.0',
            result: {},
            id
          })
        }
        break
        
      default:
        console.log('❓ Unknown method:', method)
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          },
          id
        })
    }
  } catch (error) {
    console.error('❌ Error processing request:', error)
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: `Internal error: ${error.message}`
      },
      id
    })
  }
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    requestCount: requestLog.length 
  })
})

// Request log endpoint for debugging
app.get('/logs', (req, res) => {
  res.json(requestLog.slice(-10)) // Last 10 requests
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`🚀 Simple MCP Server listening on port ${PORT}`)
  console.log(`📊 Health check: http://localhost:${PORT}/health`)
  console.log(`📋 Request logs: http://localhost:${PORT}/logs`)
})