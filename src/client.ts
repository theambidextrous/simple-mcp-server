import { input, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool } from "@modelcontextprotocol/sdk/spec.types";

const client = new Client(
    {
        name: "mcp-simple-app",
        version: "1.0.0",
    },
    {
        capabilities: { sampling: {} }
    }
);

const transport = new StdioClientTransport({
    command: "node",
    args: ["./build/server.js"],
    stderr: "ignore",
})

async function main() {
    await client.connect(transport);
    const [{ prompts }, { tools }, { resources }, { resourceTemplates }] = await Promise.all([
        client.listPrompts(),
        client.listTools(),
        client.listResources(),
        client.listResourceTemplates()
    ]);
    console.log("Client connected to server successfully.");
    while (true) {
        const option = await select({
            message: "Select an option:",
            choices: ["Query", "Tools", "Resources", "Prompts"]
        });

        switch (option) {
            case "Query":
                break;
            case "Tools":
                const toolName = await select({
                    message: "Select a tool to execute:",
                    choices: tools.map(tool => ({
                        name: tool.annotations?.title || tool.name,
                        value: tool.name,
                        description: tool.description
                    }))
                });
                console.log(`You selected: ${toolName}`);
                if (toolName) {
                    const tool = tools.find(t => t.name === toolName);
                    if (tool) {
                        await handleToolExecution(tool);
                    }
                }
                break;
            case "Resources":
                break;
            case "Prompts":
                console.log(`You selected: ${option}`);
                break;
            default:
                console.log("Invalid option selected.");
        }
    }
}

main().catch(err => {
    console.error("Error in client:", err);
    process.exit(1);
});

async function handleToolExecution(tool: Tool) {
    const collectArguments = async (
        properties: Record<string, unknown>,
        parentPath = "",
    ): Promise<Record<string, unknown>> => {
        const args: Record<string, unknown> = {};

        for (const [key, schema] of Object.entries(properties)) {
            const path = parentPath ? `${parentPath}.${key}` : key;
            const propertySchema = schema as {
                type?: string;
                properties?: Record<string, unknown>;
            };

            if (propertySchema.type === "object") {
                args[key] = await collectArguments(
                    propertySchema.properties ?? {},
                    path,
                );
            } else {
                args[key] = await input({
                    message: `Enter value for ${path} (${propertySchema.type ?? "string"}):`,
                });
            }
        }

        return args;
    };

    const args = await collectArguments(tool.inputSchema.properties ?? {});

    const res = await client.callTool({
        name: tool.name,
        arguments: args,
    })

    console.log((res.content as [{ text: string }])[0].text)
}
