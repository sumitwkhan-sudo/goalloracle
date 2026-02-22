/**
 * Wallet utilities for reading token balances on Polygon
 * Uses public RPC — no API key needed
 */

// Polygon USDC (native, Circle) address
const TOKENS = {
  USDC: {
    address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    decimals: 6,
    symbol: 'USDC',
    name: 'USD Coin',
  },
  POL: {
    address: null, // native token
    decimals: 18,
    symbol: 'POL',
    name: 'Polygon',
  },
};

// Public Polygon RPC endpoints (CORS-friendly only)
const RPC_URLS = [
  'https://rpc.ankr.com/polygon',
  'https://polygon.gateway.tenderly.co',
  'https://1rpc.io/matic',
];

// ERC-20 balanceOf(address) selector
const BALANCE_OF_SELECTOR = '0x70a08231';

async function rpcCall(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  for (const url of RPC_URLS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue; // skip non-200 responses
      const data = await res.json();
      if (data.result !== undefined) return data.result;
    } catch {
      continue; // try next RPC
    }
  }
  return null;
}

/**
 * Get native POL balance
 */
async function getNativeBalance(walletAddress) {
  const result = await rpcCall('eth_getBalance', [walletAddress, 'latest']);
  if (!result) return '0';
  return formatUnits(result, 18);
}

/**
 * Get ERC-20 token balance
 */
async function getTokenBalance(walletAddress, tokenAddress, decimals) {
  // balanceOf(address) — ABI encode the address parameter
  const paddedAddr = walletAddress.slice(2).toLowerCase().padStart(64, '0');
  const data = BALANCE_OF_SELECTOR + paddedAddr;
  const result = await rpcCall('eth_call', [
    { to: tokenAddress, data },
    'latest',
  ]);
  if (!result || result === '0x') return '0';
  return formatUnits(result, decimals);
}

/**
 * Format hex wei value to human-readable string
 */
function formatUnits(hexValue, decimals) {
  const raw = BigInt(hexValue);
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 2); // 2 decimal places
  const formatted = `${whole}.${fracStr}`;
  return formatted;
}

/**
 * Get all relevant balances for a wallet on Polygon
 * Returns { USDC: '125.50', POL: '2.31' }
 */
export async function getWalletBalances(walletAddress) {
  if (!walletAddress) return { USDC: '0.00', POL: '0.00' };

  const [usdc, pol] = await Promise.all([
    getTokenBalance(walletAddress, TOKENS.USDC.address, TOKENS.USDC.decimals),
    getNativeBalance(walletAddress),
  ]);

  return { USDC: usdc, POL: pol };
}

/**
 * Format balance for display — hides tiny amounts, shows 2 decimals
 */
export function formatBalance(val) {
  const num = parseFloat(val);
  if (isNaN(num) || num === 0) return '0.00';
  if (num < 0.01) return '<0.01';
  return num.toFixed(2);
}

export { TOKENS };
