// CS2 match share codes ("CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"). A code packs
// the match ID, outcome (reservation) ID and a token in base 57; it identifies
// a match but does not contain the replay, which only Valve's Game
// Coordinator can hand out (see services/replayProvider.js).
const DICTIONARY = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
const FORMAT = /^CSGO(-[ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789]{5}){5}$/;

class ShareCodeError extends Error {
  constructor(message) {
    super(message);
    this.code = 'invalid_share_code';
  }
}

const normalise = (input) => String(input || '').trim().replace(/^steam:\/\/rungame\/730\/\d+\/\+csgo_download_match%20/i, '');

function decodeShareCode(input) {
  const code = normalise(input);
  if (!FORMAT.test(code)) {
    throw new ShareCodeError('That is not a CS2 match share code. It looks like CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx.');
  }
  const chars = code.slice(5).replace(/-/g, '').split('').reverse();
  let big = 0n;
  for (const c of chars) big = big * 57n + BigInt(DICTIONARY.indexOf(c));
  if (big >= 1n << 144n) throw new ShareCodeError('That share code is not valid.');
  // 18 bytes, big-endian; each field is stored little-endian.
  const bytes = [];
  for (let i = 0; i < 18; i += 1) { bytes.unshift(Number(big & 0xffn)); big >>= 8n; }
  const le = (from, to) => bytes.slice(from, to).reverse().reduce((n, b) => (n << 8n) | BigInt(b), 0n);
  const matchId = le(0, 8);
  if (matchId === 0n) throw new ShareCodeError('That share code is not valid.');
  return { share_code: code, match_id: matchId.toString(), outcome_id: le(8, 16).toString(), token: Number(le(16, 18)) };
}

function encodeShareCode({ match_id: matchId, outcome_id: outcomeId, token }) {
  const toLe = (value, size) => {
    let n = BigInt(value);
    const out = [];
    for (let i = 0; i < size; i += 1) { out.push(Number(n & 0xffn)); n >>= 8n; }
    return out;
  };
  const bytes = [...toLe(matchId, 8), ...toLe(outcomeId, 8), ...toLe(token, 2)];
  let big = bytes.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
  let code = '';
  for (let i = 0; i < 25; i += 1) { code += DICTIONARY[Number(big % 57n)]; big /= 57n; }
  return `CSGO-${code.match(/.{5}/g).join('-')}`;
}

module.exports = { decodeShareCode, encodeShareCode, ShareCodeError };
