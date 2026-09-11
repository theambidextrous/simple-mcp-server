import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import z from 'zod';
import * as fs from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { CreateMessageResultSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new McpServer({
    name: 'mcp-simple-app',
    version: '1.0.0',
});

server.registerTool(
    "mcp-create-user",
    {
        title: "Create User",
        description: "Add new user into the db",
        inputSchema: z.object({
            name: z.string().min(3).max(55),
            email: z.string().email(),
            phone: z.string().min(10).max(15),
            address: z.object({
                street: z.string().min(3).max(100),
                city: z.string().min(2).max(50),
                state: z.string().min(2).max(50),
                zip: z.string().min(5).max(10),
            }),
        }),
        outputSchema: z.object({
            success: z.boolean(),
            message: z.string(),
            userDetails: z.object({
                id: z.number(),
                name: z.string(),
                email: z.string().email()
            })
        })
    },
    async (args: any) => {
        try {
            const user = await createUser(args);
            const output = {
                success: true,
                message: `User ${args.name} created successfully with email ${args.email}.`,
                userDetails: {
                    id: user.id,
                    name: user.name,
                    email: user.email
                }
            };
            return { 
                content: [{ type: 'text', text: JSON.stringify(output) }],
                structuredContent: output
            };
        } catch (error) {
            return { 
                content: [{ type: 'text', text: `Error creating user: ${error}` }],
                structuredContent: {
                    success: false,
                    message: `Error creating user: ${error}`,
                    userDetails: null
                }
            };
        }
    }
)

server.registerResource(
    "mcp-users-resource",
    "users://all",
    {
        title: "Users Resource",
        mimeType: "application/json",
    },
    async (uri) => {
        try {
            const users = await fetchAllUsers();

            const output = {
                users: users
            };

            return { 
                contents: [
                    { 
                        uri: uri.href,
                        mimeType: "application/json",
                        text: JSON.stringify(output) 
                    }
                ],
                structuredContent: output
            };
        } catch (error) {
            return { 
                contents: [
                    { 
                        uri: uri.href,
                        mimeType: "application/json", 
                        text: `Error fetching users: ${error}` 
                    }
                ],
                structuredContent: {
                    users: []
                }
            };
        }
    }
);

server.registerResource(
    "mcp-user-details-resource",
    new ResourceTemplate("users://details/{id}", { list: undefined }),
    {
        title: "User Details Resource",
        mimeType: "application/json",
    },
    async (uri, vars) => {
        const allUsers = await fetchAllUsers();
        const targetUserId = vars.id as string;
        const user = allUsers.find(u => u.id === parseInt(targetUserId));
        if (user) {
            return { 
                contents: [
                    { 
                        uri: uri.href,
                        mimeType: "application/json",
                        text: JSON.stringify(user)
                    }
                ],
                structuredContent: user
            };
        }

        return { contents: [{ uri: uri.href, text: `User not found` }] }
    }

);

server.registerPrompt("mcp-generate-user", {
    title: "Generate user prompt",
    description: "Prompt to generate fake user data given a name",
    argsSchema: z.object({
        name: z.string().min(2).max(100)
    }),
}, async ({ name }) => {
    return {
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Generate fake user data for ${name} with realistic email, phone number, and address.`
                }
            }
        ]
    }
});

/** Sampling -  mcp server to request LLM mid-task with human approval*/
server.registerTool(
    "mcp-create-random-user",
    {
        title: "Create Random User",
        description: "Add new randomuser with fake data into the db",
    },
    async () => {
        const res = await server.server.request({
            method: "sampling/createMessage",
            params: {
                promptId: "mcp-generate-user",
                args: {  },
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: "Generate fake user data. The user should have a realistic name, email, phone number, and address. Return the data in JSON format so it can be easily parsed using JSON.parse()"
                        }
                    }
                ],
                maxTokens: 1024,
            }
        }, CreateMessageResultSchema);

        if(res.content.type !== "text") {
            return {
                content: [{ type: 'text', text: `Error generating random user: Unexpected response format` }],
                structuredContent: {
                    success: false,
                    message: `Error generating random user: Unexpected response format`,
                    userDetails: null
                }
            };
        }
        try {
            const userData = JSON.parse(res.content.text.trim().replace(/```json|```/g, '').replace(/'/g, '"'));

            const id = await createUser(userData);
            const output = {...userData, id };
            return {
                content: [{ type: 'text', text: `Random user created successfully` }],
                structuredContent: {
                    success: true,
                    message: `Random user created successfully`,
                    userDetails: output
                }
            };
        } 
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error generating random user: ${error}` }],
                structuredContent: {
                    success: false,
                    message: `Error generating random user: ${error}`,
                    userDetails: null
                }
            };
        }
    }
)

const main = () => {
    const transport = new StdioServerTransport();
    server.connect(transport);
}

main();

async function fetchAllUsers() {
    return await import("./data/users.json", {
            with: { type: "json" },
        }).then(m => m.default)
}

async function createUser(user: {
  name: string
  email: string
  address: string
  phone: string
}) {
  const users = await fetchAllUsers();

  const id = users.length + 1

  users.push({ id, ...user })

  await fs.writeFile("./src/data/users.json", JSON.stringify(users, null, 2))

  const newUser = { ...user, id };
  return newUser
}