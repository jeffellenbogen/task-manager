import { sendWebPush } from './push.js';

// Allow requests from GitHub Pages and local dev
const ALLOWED_ORIGINS = [
  'https://jeffellenbogen.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function handleRequest(request, env) {
  const origin = request.headers.get('Origin') || '';
  const { pathname } = new URL(request.url);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // POST /subscribe — store or update a reminder in KV
  if (request.method === 'POST' && pathname === '/subscribe') {
    const { subscription, taskId, taskTitle, reminderMs } = await request.json();

    if (!subscription?.endpoint || !taskId || !reminderMs) {
      return new Response('Missing required fields', {
        status: 400,
        headers: corsHeaders(origin),
      });
    }

    const value = JSON.stringify({ subscription, taskTitle, reminderMs });
    await env.REMINDERS.put(`reminder:${taskId}`, value);

    return new Response('OK', { status: 200, headers: corsHeaders(origin) });
  }

  // DELETE /reminder — remove a reminder from KV
  if (request.method === 'DELETE' && pathname === '/reminder') {
    const { taskId } = await request.json();
    if (!taskId) {
      return new Response('Missing taskId', { status: 400, headers: corsHeaders(origin) });
    }
    await env.REMINDERS.delete(`reminder:${taskId}`);
    return new Response('OK', { status: 200, headers: corsHeaders(origin) });
  }

  return new Response('Not Found', { status: 404, headers: corsHeaders(origin) });
}

async function handleScheduled(env) {
  // Implemented in Task 7
}

export default {
  fetch: handleRequest,
  scheduled: (event, env) => handleScheduled(env),
};
