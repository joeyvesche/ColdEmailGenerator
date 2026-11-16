#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

// Tiny .env loader so no extra dependency is needed.
function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function ask(rl, question) {
  while (true) {
    const answer = (await rl.question(question)).trim();
    if (answer) return answer;
    console.log('This field is required.');
  }
}

async function askTone(rl) {
  while (true) {
    const answer = (await rl.question('Tone (direct/warm): ')).trim().toLowerCase();
    if (answer === 'direct' || answer === 'warm') return answer;
    console.log('Please type "direct" or "warm".');
  }
}

async function main() {
  loadEnv();

  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY. Add it to your .env file.');
    process.exit(1);
  }

  const OpenAI = require('openai');
  const { fetchCompanyAnalysis, buildHints } = require('./helper');
  const { generateEmail } = require('./generate');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let input;
  try {
    input = {
      name: await ask(rl, "Recipient's name: "),
      company: await ask(rl, 'Company name: '),
      description: await ask(rl, 'Short company description: '),
      tone: await askTone(rl),
    };
  } finally {
    rl.close();
  }

  console.log('\nLooking up company hints...');
  const analysis = await fetchCompanyAnalysis(input.company, {
    log: (msg) => console.error(`  [helper] ${msg}`),
  });
  
  const { tier } = buildHints(analysis);
  const conf = analysis ? analysis.confidence : 'n/a';
  console.log(`Helper confidence: ${conf} (${tier === 'none' ? 'unavailable, using description only' : tier})`);

  console.log('Generating email...\n');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { email, problems, rounds } = await generateEmail(client, input, analysis, {
    model: process.env.OPENAI_MODEL,
  });

  console.log('----------------------------------------');
  console.log(email);
  console.log('----------------------------------------');

  if (problems.length) {
    console.warn(`\nWarning: still violates rules after ${rounds} attempts:`);
    problems.forEach((p) => console.warn(`  - ${p}`));
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});