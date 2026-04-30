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
    // Metadata lets the cron filter due entries without an extra get() per key
    await env.REMINDERS.put(`reminder:${taskId}`, value, {
      metadata: { reminderMs },
    });

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
  const now = Date.now();
  const { keys } = await env.REMINDERS.list({ prefix: 'reminder:' });

  await Promise.all(keys.map(async ({ name, metadata }) => {
    // Fast path: skip non-due entries via metadata, no get() needed
    if (metadata?.reminderMs > now) return;

    const raw = await env.REMINDERS.get(name);
    if (!raw) return;
    const { subscription, taskTitle, reminderMs } = JSON.parse(raw);
    if (reminderMs > now) return; // re-check for entries written before metadata

    // Due: send push and delete (delete even if push fails to avoid repeat fires)
    await env.REMINDERS.delete(name);
    await sendWebPush(subscription, 'Task Reminder', taskTitle, env);
  }));
}

export default {
  fetch: handleRequest,
  scheduled: (event, env) => handleScheduled(env),
};
