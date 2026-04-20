import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { HelmetProvider } from 'react-helmet-async';
import { polygon, base, arbitrum, optimism, mainnet } from 'viem/chains';
import { Analytics } from '@vercel/analytics/react';
import GoalOracle from './goaloracle';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      clientId={import.meta.env.VITE_PRIVY_CLIENT_ID}
      config={{
        appearance: {
          theme: 'light',
          accentColor: '#FF3B30',
        },
        loginMethods: ['email', 'wallet', 'google', 'twitter'],
        defaultChain: polygon,
        supportedChains: [polygon, base, arbitrum, optimism, mainnet],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      <GoalOracle />
      <Analytics />
    </PrivyProvider>
    </HelmetProvider>
  </React.StrictMode>
);