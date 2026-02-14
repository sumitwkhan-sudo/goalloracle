import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import GoalOracle from './goaloracle';

const privyConfig = {
  loginMethods: ['wallet', 'email', 'google'],
  appearance: {
    theme: 'light',
    accentColor: '#FF3B30',
  },
  embeddedWallets: {
    createOnLogin: 'users-without-wallets',
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={privyConfig}
    >
      <GoalOracle />
    </PrivyProvider>
  </React.StrictMode>
);