/** Harmless stdio MCP server for the isolated Desktop bridge regression harness. */
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const tool = {
  name: 'echo',
  description: 'Return the supplied text without performing any external action.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
};

interface Request {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

// Only the test supplies this path, inside its fresh temporary directory. Record
// method names, never configuration, credentials, or tool arguments.
const trace = process.env.SDM_MCP_FIXTURE_TRACE;
function record(method: string): void {
  if (trace) appendFileSync(trace, `${JSON.stringify({ pid: process.pid, method })}\n`, { mode: 0o600 });
}

function respond(request: Request): unknown {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: request.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'sdm-desktop-mcp-fixture', version: '1.0.0' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: [tool] };
    case 'tools/call': {
      const args = request.params?.arguments as Record<string, unknown> | undefined;
      if (request.params?.name !== tool.name || typeof args?.text !== 'string') {
        throw { code: -32602, message: 'Expected echo with a string text argument' };
      }
      return { content: [{ type: 'text', text: args.text }], isError: false };
    }
    default:
      throw { code: -32601, message: `Unsupported fixture method: ${request.method}` };
  }
}

record('fixture/started');
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (!line.trim()) return;
  let request: Request;
  try {
    request = JSON.parse(line) as Request;
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } })}\n`);
    return;
  }
  record(request.method ?? 'invalid');
  if (request.id === undefined) return; // Notifications never receive responses.
  let response: unknown;
  try {
    response = { jsonrpc: '2.0', id: request.id, result: respond(request) };
  } catch (error) {
    response = { jsonrpc: '2.0', id: request.id, error };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
// App Server owns our input pipe. Closing that pipe ends the fixture naturally;
// no detached workers, network, real Desktop pipe, or user state are involved.
input.on('close', () => { process.exitCode = 0; });
