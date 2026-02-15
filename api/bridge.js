import { corsHeaders, verifyAuth } from './_lib/firebase.js';

// USDC contract addresses by chain
const USDC_ADDRESSES = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',     // Ethereum
  137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',    // Polygon (native USDC)
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',   // Base
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // Arbitrum
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',     // Optimism
};

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';

// Supported origin tokens (what users can send)
const SUPPORTED_ORIGIN_TOKENS = {
  ETH: { address: NATIVE_TOKEN, decimals: 18 },
  USDC: { decimals: 6 },  // address varies by chain, filled from USDC_ADDRESSES
  USDT: {
    1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    137: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    10: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e68',
    8453: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    decimals: 6,
  },
  POL: { address: NATIVE_TOKEN, chains: [137], decimals: 18 },
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  // GET: check bridge status
  if (req.method === 'GET') {
    const { requestId } = req.query;
    if (!requestId) return res.status(400).json({ error: 'requestId required' });

    try {
      const response = await fetch(`https://api.relay.link/intents/status?requestId=${requestId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST: get deposit address for bridge/swap
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    recipientAddress,
    originChainId,
    originToken,       // 'ETH', 'USDC', 'USDT', 'POL', or a raw address
    destinationChainId, // defaults to 137 (Polygon)
    amount,            // in smallest unit (wei/micro-units)
  } = req.body;

  if (!recipientAddress || !amount) {
    return res.status(400).json({ error: 'recipientAddress and amount required' });
  }

  const destChain = destinationChainId || 137; // Default: Polygon
  const srcChain = originChainId || 1;         // Default: Ethereum

  // Resolve origin token address
  let originCurrency;
  if (originToken === 'ETH' || originToken === 'POL') {
    originCurrency = NATIVE_TOKEN;
  } else if (originToken === 'USDC') {
    originCurrency = USDC_ADDRESSES[srcChain];
  } else if (originToken === 'USDT') {
    originCurrency = SUPPORTED_ORIGIN_TOKENS.USDT[srcChain];
  } else if (originToken?.startsWith('0x')) {
    originCurrency = originToken; // Raw address
  } else {
    originCurrency = NATIVE_TOKEN; // Fallback to native
  }

  if (!originCurrency) {
    return res.status(400).json({ error: `Token ${originToken} not supported on chain ${srcChain}` });
  }

  // Destination is always USDC on Polygon (or specified chain)
  const destinationCurrency = USDC_ADDRESSES[destChain];
  if (!destinationCurrency) {
    return res.status(400).json({ error: `USDC not supported on chain ${destChain}` });
  }

  try {
    const quoteResponse = await fetch('https://api.relay.link/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: recipientAddress,
        originChainId: srcChain,
        originCurrency,
        destinationChainId: destChain,
        destinationCurrency,
        tradeType: 'EXACT_INPUT',
        recipient: recipientAddress,
        amount: amount.toString(),
        usePermit: false,
        useExternalLiquidity: false,
        referrer: 'goaloracle.io',
        useDepositAddress: true,
        refundTo: recipientAddress,
      }),
    });

    if (!quoteResponse.ok) {
      const errText = await quoteResponse.text();
      return res.status(quoteResponse.status).json({ error: `Relay API error: ${errText}` });
    }

    const quote = await quoteResponse.json();

    // Extract deposit address and requestId
    const step = quote.steps?.[0];
    if (!step?.depositAddress) {
      return res.status(500).json({ error: 'No deposit address returned from Relay' });
    }

    return res.status(200).json({
      depositAddress: step.depositAddress,
      requestId: step.requestId,
      originChain: srcChain,
      originToken: originCurrency,
      destinationChain: destChain,
      destinationToken: destinationCurrency,
      estimatedOutput: quote.details?.currencyOut?.amount || null,
      fees: quote.fees || null,
    });
  } catch (e) {
    console.error('Relay bridge error:', e);
    return res.status(500).json({ error: e.message });
  }
}
