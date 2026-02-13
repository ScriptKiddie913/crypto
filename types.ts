export interface Transaction {
  txid: string;
  version: number;
  locktime: number;
  vin: {
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey_address: string;
      value: number;
    } | null;
    scriptsig: string;
  }[];
  vout: {
    scriptpubkey_address: string;
    value: number;
  }[];
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

export interface AddressInfo {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

export interface WalletIdentification {
  blockchain: 'Bitcoin' | 'Ethereum' | 'Solana' | 'Multi-Chain' | 'Unknown';
  walletType?: 'Hot Wallet' | 'Cold Wallet' | 'Custodial' | 'Non-Custodial';
  walletCategory?: 'Mobile Wallet' | 'Desktop Wallet' | 'Browser Extension' | 'Exchange Wallet' | 'Hardware Wallet' | 'Paper Wallet' | 'Multi-Chain Wallet' | 'Multi-Signature Wallet' | 'MPC Wallet';
  walletBrand?: string; // e.g., 'MetaMask', 'Ledger', 'Trezor', etc.
  confidence: number; // 0-1
  detectionMethod?: string;
}

export interface NodeData {
  id: string;
  type: 'address' | 'transaction' | 'block' | 'eth_address' | 'entity' | 'social' | 'github' | 'osint_confirmed';
  label: string;
  details?: any;
  riskScore?: number;
  isRoot?: boolean;
  walletInfo?: WalletIdentification;
}

export interface LinkData {
  source: string;
  target: string;
  value: number;
  label?: string;
}

export enum SearchType {
  ADDRESS = 'address',
  ETH_ADDRESS = 'eth_address',
  TX = 'tx',
  BLOCK = 'block',
  UNKNOWN = 'unknown'
}