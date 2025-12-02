import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { z } from "zod"
import fs from "node:fs/promises"
import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js"
import express from "express"

const server = new McpServer({
  name: "test-video",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
    prompts: {},
  },
})

server.resource(
  "users",
  "users://all",
  {
    description: "Get all users data from the database",
    title: "Users",
    mimeType: "application/json",
  },
  async uri => {
    const users = await import("./data/users.json", {
      with: { type: "json" },
    }).then(m => m.default)

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(users),
          mimeType: "application/json",
        },
      ],
    }
  }
)

server.resource(
  "user-details",
  new ResourceTemplate("users://{userId}/profile", { list: undefined }),
  {
    description: "Get a user's details from teh database",
    title: "User Details",
    mimeType: "application/json",
  },
  async (uri, { userId }) => {
    const users = await import("./data/users.json", {
      with: { type: "json" },
    }).then(m => m.default)
    const user = users.find((u: any) => u.id === parseInt(userId as string))

    if (user == null) {
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({ error: "User not found" }),
            mimeType: "application/json",
          },
        ],
      }
    }

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(user),
          mimeType: "application/json",
        },
      ],
    }
  }
)

server.tool(
  "create-user",
  "Create a new user in the database",
  {
    name: z.string(),
    email: z.string(),
    address: z.string(),
    phone: z.string(),
  },
  {
    title: "Create User",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async params => {
    try {
      const id = await createUser(params)

      return {
        content: [{ type: "text", text: `User ${id} created successfully` }],
      }
    } catch {
      return {
        content: [{ type: "text", text: "Failed to save user" }],
      }
    }
  }
)

server.tool(
  "create-random-user",
  "Create a random user with fake data",
  {
    title: "Create Random User",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async () => {
    const res = await server.server.request(
      {
        method: "sampling/createMessage",
        params: {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Generate fake user data. The user should have a realistic name, email, address, and phone number. Return this data as a JSON object with no other text or formatter so it can be used with JSON.parse.",
              },
            },
          ],
          maxTokens: 1024,
        },
      },
      CreateMessageResultSchema
    )

    if (res.content.type !== "text") {
      return {
        content: [{ type: "text", text: "Failed to generate user data" }],
      }
    }

    try {
      const fakeUser = JSON.parse(
        res.content.text
          .trim()
          .replace(/^```json/, "")
          .replace(/```$/, "")
          .trim()
      )

      const id = await createUser(fakeUser)
      return {
        content: [{ type: "text", text: `User ${id} created successfully` }],
      }
    } catch {
      return {
        content: [{ type: "text", text: "Failed to generate user data" }],
      }
    }
  }
)

server.prompt(
  "generate-fake-user",
  "Generate a fake user based on a given name",
  {
    name: z.string(),
  },
  ({ name }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Generate a fake user with the name ${name}. The user should have a realistic email, address, and phone number.`,
          },
        },
      ],
    }
  }
)

async function createUser(user: {
  name: string
  email: string
  address: string
  phone: string
}) {
  type User = {
    id: number
    name: string
    email: string
    address: string
    phone: string
  }

  const users = await import("./data/users.json", {
    with: { type: "json" },
  }).then(m => m.default as any[])

  const id: number = users.length + 1

  users.push({ id, ...user })

  await fs.writeFile("./src/data/users.json", JSON.stringify(users, null, 2))

  return id
}

async function main() {
  const app = express()
  const PORT = 3000

  const transports = new Map<string, SSEServerTransport>()

  app.get("/sse", async (req: any, res: any) => {
    console.log("New SSE connection attempt")
    const transport = new SSEServerTransport("/message", res)

    // Store the transport so we can find it when messages arrive
    transports.set(transport.sessionId, transport)

    transport.onclose = () => {
      console.log("SSE connection closed")
      transports.delete(transport.sessionId)
    }

    await server.connect(transport)
  })

  app.post("/message", async (req: any, res: any) => {
    const sessionId = req.query.sessionId as string
    const transport = transports.get(sessionId)

    if (!transport) {
      console.log(`Session not found: ${sessionId}`)
      res.status(404).send("Session not found")
      return
    }

    await transport.handlePostMessage(req, res)
  })

  app.listen(PORT, () => {
    console.log(`MCP server listening on http://localhost:${PORT}`)
  })
}

main()