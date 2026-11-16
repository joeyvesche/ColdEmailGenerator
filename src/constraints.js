// Hard constraints that the final cold email must obey. These checks are cheaper
// and more deterministic than trying to reason about them in the language model.
const MAX_WORDS = 30;

const BANNED_PHRASES = [
  'hope this message finds you well',
  'plays a crucial role',
  'significantly',
  'streamline',
  'high-touch',
  'complex space',
  'came across',
  'impressed by',
  'impressed with',
  'caught my eye',
];

// Split natural-language text into sentence-like chunks so the validation logic can
// check each one individually without depending on a full parser.
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstWord(sentence) {
  const m = sentence.match(/[\p{L}\p{N}']+/u);
  return m ? m[0].toLowerCase() : '';
}

// Deterministic fixes that do not require another model round. These changes are
// intentionally narrow and safe.
function sanitize(text) {
  let out = text.replace(/\s*[\u2014\u2015]\s*/g, ', ');
  let seen = false;
  out = out.replace(/!/g, () => {
    if (!seen) {
      seen = true;
      return '!';
    }
    return '.';
  });
  return out.trim();
}

// Returns a list of violations (empty if clean). This is the gate that decides
// whether the draft is acceptable or should be rewritten.
function validate(text, input) {
  const problems = [];

  if (/[\u2014\u2015]/.test(text)) problems.push('Contains an em dash.');
  if (/fantastic/i.test(text)) problems.push('Contains the word "fantastic".');
  BANNED_PHRASES.forEach((p) => {
    if (text.toLowerCase().includes(p)) problems.push(`Contains the phrase "${p}".`);
  });
  if ((text.match(/!/g) || []).length > 1) {
    problems.push('Contains more than one exclamation mark.');
  }

  const sentences = splitSentences(text);

  sentences.forEach((s) => {
    if (/^(furthermore|additionally)\b/i.test(s)) {
      problems.push(`A sentence starts with "${firstWord(s)}": "${s}"`);
    }
    const words = s.split(/\s+/).filter(Boolean).length;
    if (words > MAX_WORDS) {
      problems.push(`A sentence has ${words} words (max ${MAX_WORDS}): "${s}"`);
    }
  });

  for (let i = 1; i < sentences.length; i++) {
    const a = firstWord(sentences[i - 1]);
    const b = firstWord(sentences[i]);
    if (a && a === b) {
      problems.push(`Two consecutive sentences start with "${a}": "${sentences[i - 1]}" / "${sentences[i]}"`);
    }
  }
  // Required elements from the task. Only checked when input is provided.
  if (input) {
    const firstName = input.name.trim().split(/\s+/)[0];
    const lower = text.toLowerCase();
    if (!lower.includes(firstName.toLowerCase())) {
      problems.push(`Must greet the recipient by name ("${firstName}").`);
    }
    if (!lower.includes(input.company.trim().toLowerCase())) {
      problems.push(`Must mention the company name ("${input.company.trim()}").`);
    }
    if (!/\b(call|chat|meet|meeting|conversation)\b/i.test(text)) {
      problems.push('Must suggest a short call or meeting.');
    }
    if (!/raphie/i.test(text)) problems.push('Must mention Raphie.');
  }
  return problems;
}

module.exports = { validate, sanitize, splitSentences, MAX_WORDS };