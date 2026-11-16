const test = require('node:test');
const assert = require('node:assert');
const { validate, sanitize } = require('../src/constraints');
const { buildHints, tierFor, fetchCompanyAnalysis } = require('../src/helper');
const { generateEmail } = require('../src/generate');

test('validate catches each rule', () => {
  assert.ok(validate('Hi Jo, this is it \u2014 really.').some((p) => /em dash/.test(p)));
  assert.ok(validate('A fantastic idea.').some((p) => /fantastic/.test(p)));
  assert.ok(validate('Wow! Great! Yes.').some((p) => /exclamation/.test(p)));
  assert.ok(validate('Hi Jo,\nAdditionally we help.').some((p) => /dditionally/.test(p)));
  assert.ok(validate('We help teams. We cut costs.').some((p) => /consecutive/.test(p)));
  const long = Array(31).fill('word').join(' ') + '.';
  assert.ok(validate(long).some((p) => /31 words/.test(p)));
});

test('sanitize removes em dashes and extra exclamation marks', () => {
  const out = sanitize('Hello \u2014 there! Yes! Done!');
  assert.ok(!out.includes('\u2014'));
  assert.strictEqual((out.match(/!/g) || []).length, 1);
});

test('confidence tiers and hints', () => {
  assert.strictEqual(tierFor(0.85), 'high');
  assert.strictEqual(tierFor(0.55), 'medium');
  assert.strictEqual(tierFor(0.15), 'low');
  const data = { vertical: 'igaming', companyType: 'operator', operatingRegions: ['US'], kycAmlIntensity: 'high' };
  assert.match(buildHints({ ...data, confidence: 0.85 }).context, /Operating regions: US/);
  assert.doesNotMatch(buildHints({ ...data, confidence: 0.5 }).context, /Operating regions/);
  assert.strictEqual(buildHints({ ...data, confidence: 0.15 }).context, '');
});

test('helper retries on 503 then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 2) return { ok: false, status: 503 };
    return { ok: true, status: 200, json: async () => ({ confidence: 0.9 }) };
  };
  const data = await fetchCompanyAnalysis('X', { fetchImpl });
  assert.strictEqual(data.confidence, 0.9);
  assert.strictEqual(calls, 2);
});

test('generateEmail retries with feedback until rules pass', async () => {
  const replies = [
    'Hi Jane,\nWe help teams \u2014 fast. Fantastic results!',
    'Hi Jane,\nI work at Raphie. We automate support for Riverline. Want a quick call?\nBest,\nRaphie',
  ];
  let i = 0;
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: replies[i++] } }] }) } } };
  const res = await generateEmail(client, { name: 'Jane', company: 'Riverline', description: 'd', tone: 'direct' }, null);
  assert.strictEqual(res.rounds, 2);
  assert.deepStrictEqual(res.problems, []);
});