const ENDPOINT =
  'https://code-challenge-basic-463015353641.us-central1.run.app/company-analysis';

const TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Confidence tiers.
 * A wrong detail in a cold email (calling a supplier an operator, mentioning
 * crypto to a non-crypto company) is worse than a generic email.
 * - >= 0.75  high:   trust the hints and use all useful fields.
 * - 0.4-0.75 medium: use only broad fields (vertical, companyType) and phrase
 *                   them tentatively.
 * - < 0.4   low:    treat as noise, rely on the user's description only.
 * A failed or missing response is handled like low.
 */
const HIGH = 0.75;
const MEDIUM = 0.4;

function tierFor(confidence) {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return 'none';
  if (confidence >= HIGH) return 'high';
  if (confidence >= MEDIUM) return 'medium';
  return 'low';
}

function isUsable(data) {
  return data && typeof data === 'object' && typeof data.confidence === 'number';
}

// Never throws. Returns null if no usable response, so the caller can fall back.
async function fetchCompanyAnalysis(name, { fetchImpl = fetch, log = () => {} } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.ok) {
        const data = await res.json();
        if (isUsable(data)) return data;
        log('Helper returned an unexpected payload, ignoring it.');
        return null;
      }
      if (res.status < 500) {
        log(`Helper returned ${res.status}, ignoring it.`);
        return null;
      }
      log(`Helper returned ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS}).`);
    } catch (err) {
      log(`Helper request failed: ${err.name} (attempt ${attempt}/${MAX_ATTEMPTS}).`);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
  }
  return null;
}

const COMPANY_TYPE_LABELS = {
  operator: 'a betting/gaming operator that serves players directly',
  b2b: 'a B2B platform or supplier that serves operators',
  supplier: 'a B2B supplier that serves operators',
  affiliate: 'an affiliate that sends traffic to operators',
  payments: 'a payments business serving operators and players',
};

const SUPPORT_MOTION_LABELS = {
  high_volume: 'high volume of repetitive tickets',
  mixed: 'a mix of operator-side and player-side requests',
  low_volume: 'lower volume but complex cases',
};

const humanize = (v) => String(v).replace(/_/g, ' ');

function buildHints(data) {
  const tier = data ? tierFor(data.confidence) : 'none';
  if (tier === 'low' || tier === 'none') return { tier, context: '' };

  const lines = [];
  if (data.vertical) lines.push(`Vertical: ${humanize(data.vertical)}`);
  if (data.companyType) {
    lines.push(
      `Company type: ${COMPANY_TYPE_LABELS[data.companyType] || humanize(data.companyType)}`
    );
  }

  if (tier === 'high') {
    if (Array.isArray(data.operatingRegions) && data.operatingRegions.length) {
      lines.push(`Operating regions: ${data.operatingRegions.join(', ')}`);
    }
    if (data.supportMotion) {
      lines.push(
        `Support motion: ${SUPPORT_MOTION_LABELS[data.supportMotion] || humanize(data.supportMotion)}`
      );
    }
    if (data.kycAmlIntensity) lines.push(`KYC/AML intensity: ${data.kycAmlIntensity}`);
    // Only mention crypto when true; "false" is noise.
    if (data.isCryptoRelated === true) {
      lines.push('Crypto related: yes (wallets, on-ramps, chain confirmations may drive tickets)');
    }
  }

  const guidance =
    tier === 'high'
      ? 'These hints are reliable in general, but the description the user typed always wins. If a hint is not supported by the description, leave it out. Use hints to choose the framing and the examples of support pain.'
      : 'These hints are only moderately reliable. Use them lightly, phrase anything derived from them tentatively (for example "from the outside" or "looks like"), and do not state them as fact. When they conflict with the description, trust the description.';

  return { tier, context: `${lines.join('\n')}\n${guidance}` };
}

module.exports = { fetchCompanyAnalysis, buildHints, tierFor, HIGH, MEDIUM };