'use strict';

/**
 * Multi-Channel Notification Action — Node.js runtime
 *
 * Uses only Node.js built-in modules; no npm install required at runtime.
 * Apprise CLI must be installed before this script is called (see action.yml).
 */

const { spawnSync } = require('child_process');
const fs            = require('fs');
const path          = require('path');

// ── Read inputs ───────────────────────────────────────────────────────────────

const ACTION_PATH    = process.env.ACTION_PATH || path.resolve(__dirname, '..');
const status         = (process.env.INPUT_STATUS    || 'failure').toLowerCase().trim();
const jobName        = (process.env.INPUT_JOB_NAME  || '').trim();
const customTitle    = (process.env.INPUT_TITLE     || '').trim();
const customMessage  = (process.env.INPUT_MESSAGE   || '').trim();
const debugMode      = process.env.INPUT_DEBUG === 'true';
const channels       = (process.env.INPUT_CHANNELS  || 'slack')
  .split(',')
  .map(c => c.trim().toLowerCase())
  .filter(Boolean);

// ── GitHub context (always set on runners) ────────────────────────────────────

const repository = process.env.GITHUB_REPOSITORY  || '';
const refName    = process.env.GITHUB_REF_NAME    || '';
const workflow   = process.env.GITHUB_WORKFLOW    || '';
const sha        = process.env.GITHUB_SHA         || '';
const actor      = process.env.GITHUB_ACTOR       || '';
const serverUrl  = process.env.GITHUB_SERVER_URL  || 'https://github.com';
const runId      = process.env.GITHUB_RUN_ID      || '';

// ── Status metadata ───────────────────────────────────────────────────────────

const STATUS_META = {
  success:   { emoji: '🟢', color: 'success' },
  failure:   { emoji: '🔴', color: 'danger'  },
  cancelled: { emoji: '⚪️', color: 'warning' },
};
const meta = STATUS_META[status] || { emoji: '🔵', color: 'info' };

// ── Build notification content ────────────────────────────────────────────────

const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const runUrl     = `${serverUrl}/${repository}/actions/runs/${runId}`;
const title      = customTitle || `${capitalize(status)} — ${jobName}`;

const defaultMessage = [
  `Repository : ${repository}`,
  `Branch     : ${refName}`,
  `Workflow   : ${workflow}`,
  `Job        : ${jobName}`,
  `Commit     : ${sha}`,
  `Author     : ${actor}`,
  '',
  `View Run   : ${runUrl}`,
].join('\n');

const message = customMessage || defaultMessage;

// ── Template variables ────────────────────────────────────────────────────────

const VARS = {
  '{EMOJI}'      : meta.emoji,
  '{STATUS}'     : status,
  '{COLOR}'      : meta.color,
  '{TITLE}'      : title,
  '{MESSAGE}'    : message,
  '{REPOSITORY}' : repository,
  '{BRANCH}'     : refName,
  '{WORKFLOW}'   : workflow,
  '{JOB}'        : jobName,
  '{COMMIT}'     : sha,
  '{AUTHOR}'     : actor,
  '{RUN_URL}'    : runUrl,
};

// ── Template file map ─────────────────────────────────────────────────────────

const TEMPLATE_FILES = {
  slack    : 'slack.txt',
  discord  : 'discord.txt',
  telegram : 'telegram.txt',
  teams    : 'teams.txt',
  gchat    : 'gchat.txt',
  email    : 'email.html',
  sns      : 'sns.txt',
  gotify   : 'gotify.txt',
  ntfy     : 'ntfy.txt',
  webhook  : 'webhook.txt',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderTemplate(content) {
  return Object.entries(VARS).reduce((out, [k, v]) => out.split(k).join(v), content);
}

function resolveBody(channel) {
  const customTplPath  = (process.env[`INPUT_${channel.toUpperCase()}_TEMPLATE`] || '').trim();
  const bundledTplFile = TEMPLATE_FILES[channel] || `${channel}.txt`;
  const bundledTplPath = path.join(ACTION_PATH, 'templates', bundledTplFile);

  let tplPath = '';

  if (customTplPath && fs.existsSync(customTplPath)) {
    tplPath = customTplPath;
  } else if (!customMessage && fs.existsSync(bundledTplPath)) {
    // Only use the built-in template when no custom message was provided
    tplPath = bundledTplPath;
  }

  if (tplPath) {
    return renderTemplate(fs.readFileSync(tplPath, 'utf8'));
  }

  return message;
}

function sendNotification(channel, url, body) {
  const fullTitle = `${meta.emoji} ${title}`;

  console.log(`\n→ [${channel}] Sending notification…`);

  const appriseArgs = debugMode
    ? ['-vv', '-t', fullTitle, '-b', body, url]
    : ['-v',  '-t', fullTitle, '-b', body, url];

  const result = spawnSync('apprise', appriseArgs, {
    encoding : 'utf8',
    // Pipe all streams — avoids leaking the URL via shell expansion
    stdio    : ['pipe', 'pipe', 'pipe'],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    // spawnSync itself failed (e.g. apprise not found)
    console.error(`✗ [${channel}] spawn error: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.status !== 0) {
    console.error(`✗ [${channel}] notification failed (exit code: ${result.status})`);
    process.exitCode = 1;
  } else {
    console.log(`✓ [${channel}] notification sent successfully`);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

let notified = 0;

for (const channel of channels) {
  const url = (process.env[`INPUT_${channel.toUpperCase()}_URL`] || '').trim();

  if (!url) {
    console.log(`⚠  [${channel}] skipped — no URL configured (set ${channel}_url input)`);
    continue;
  }

  const body = resolveBody(channel);
  sendNotification(channel, url, body);
  notified++;
}

if (notified === 0) {
  console.warn('\n⚠  No channels were notified. Provide at least one *_url input with a valid Apprise URL.');
}
