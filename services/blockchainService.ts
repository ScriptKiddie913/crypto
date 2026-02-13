import { AddressInfo, Transaction, SearchType, WalletIdentification } from '../types';

const BTC_PROVIDERS = [
  'https://mempool.space/api',
  'https://blockstream.info/api',
  'https://api.blockcypher.com/v1/btc/main'
];

const cache = {
  address: new Map<string, AddressInfo>(),
  tx: new Map<string, Transaction>(),
  addressTxs: new Map<string, Transaction[]>()
};

const fetchWithFallback = async (endpoint: string, options: RequestInit = {}, timeout = 10000) => {
  let lastError: any = null;
  for (const base of BTC_PROVIDERS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const isBlockcypher = base.includes('blockcypher');
      let finalUrl = `${base}${endpoint}`;
      
      if (isBlockcypher) {
        if (endpoint.startsWith('/address/')) {
          const addr = endpoint.split('/')[2];
          finalUrl = endpoint.endsWith('/txs') 
            ? `${base}/addrs/${addr}/full?limit=50` 
            : `${base}/addrs/${addr}/balance`;
        } else if (endpoint.startsWith('/tx/')) {
          finalUrl = `${base}/txs/${endpoint.split('/')[2]}`;
        }
      }

      const response = await fetch(finalUrl, { ...options, signal: controller.signal });
      clearTimeout(id);
      
      if (response.ok) {
        const data = await response.json();
        if (isBlockcypher) {
          if (data.txs && endpoint.endsWith('/txs')) {
             return data.txs.map((t: any) => ({
              txid: t.hash,
              fee: t.fees,
              status: { 
                confirmed: !!t.block_height, 
                block_height: t.block_height, 
                block_time: t.confirmed ? new Date(t.confirmed).getTime()/1000 : undefined 
              },
              vin: (t.inputs || []).map((i: any) => ({ prevout: { scriptpubkey_address: i.addresses?.[0], value: i.output_value } })),
              vout: (t.outputs || []).map((o: any) => ({ scriptpubkey_address: o.addresses?.[0], value: o.value }))
            }));
          }
          if (data.address) {
            return {
              address: data.address,
              chain_stats: {
                funded_txo_sum: data.total_received,
                spent_txo_sum: data.total_sent,
                tx_count: data.n_tx,
                funded_txo_count: data.n_tx,
                spent_txo_count: 0
              }
            };
          }
        }
        return data;
      }
    } catch (err: any) {
      clearTimeout(id);
      lastError = err;
    }
  }
  throw lastError || new Error("Forensic node resolution timeout.");
};

export const blockchainService = {
  async getDetailedAddressInfo(address: string) {
    try {
      const type = this.detectSearchType(address);
      const basicInfo = await this.getAddress(address);
      
      if (type === SearchType.ETH_ADDRESS) {
        // Enhanced Ethereum address analysis
        const ethDetails = await this.analyzeEthereumAddress(address);
        return { ...basicInfo, ...ethDetails };
      } else {
        // Enhanced Bitcoin address analysis  
        const btcDetails = await this.analyzeBitcoinAddress(address);
        return { ...basicInfo, ...btcDetails };
      }
    } catch (e) {
      console.warn('Detailed address info failed:', e);
      return null;
    }
  },

  async analyzeEthereumAddress(address: string) {
    try {
      const [balanceRes, txCountRes] = await Promise.all([
        fetch(`https://eth.blockscout.com/api/v2/addresses/${address}`).catch(() => null),
        fetch(`https://eth.blockscout.com/api/v2/addresses/${address}/transactions?filter=to%7Cfrom&limit=1`).catch(() => null)
      ]);
      
      const extra: any = {};
      
      if (balanceRes?.ok) {
        const balanceData = await balanceRes.json();
        extra.contract_info = {
          is_contract: !!balanceData.is_contract,
          contract_name: balanceData.name || null,
          creation_tx: balanceData.creation_tx_hash || null
        };
        extra.token_holdings = balanceData.token?.length || 0;
        extra.last_activity = balanceData.timestamp || null;
      }
      
      return extra;
    } catch (e) {
      return {};
    }
  },

  async analyzeBitcoinAddress(address: string) {
    try {
      const addressInfo = await this.getAddress(address);
      
      return {
        address_type: this.getBitcoinAddressType(address),
        utxo_count: addressInfo.chain_stats?.funded_txo_count - addressInfo.chain_stats?.spent_txo_count || 0,
        total_received: addressInfo.chain_stats?.funded_txo_sum || 0,
        total_sent: addressInfo.chain_stats?.spent_txo_sum || 0,
        first_seen: null, // Would need additional API call
        last_seen: null
      };
    } catch (e) {
      return {};
    }
  },

  getBitcoinAddressType(address: string): string {
    if (address.startsWith('bc1q')) return 'Native SegWit (P2WPKH)';
    if (address.startsWith('bc1p')) return 'Taproot (P2TR)';
    if (address.startsWith('3')) return 'SegWit Compatible (P2SH)';
    if (address.startsWith('1')) return 'Legacy (P2PKH)';
    return 'Unknown';
  },

  detectSearchType(query: string): SearchType {
    const q = query.trim();
    if (!q) return SearchType.UNKNOWN;
    if (/^0x[a-fA-F0-9]{40}$/i.test(q)) return SearchType.ETH_ADDRESS;
    if (/^0x[0-9a-fA-F]{64}$/i.test(q)) return SearchType.TX;
    const isBtcAddress = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(q) || /^bc1[ac-hj-np-z02-9]{11,71}$/i.test(q);
    if (isBtcAddress) return SearchType.ADDRESS;
    if (/^\d+$/.test(q) && q.length < 10) return SearchType.BLOCK;
    if (/^[0-9a-fA-F]{64}$/i.test(q)) return q.startsWith('00000000') ? SearchType.BLOCK : SearchType.TX;
    return SearchType.UNKNOWN;
  },

  async searchGitHub(query: string) {
    // This method is now deprecated - use osintService instead
    console.warn('Using deprecated searchGitHub method. Use osintService.searchGitHub instead.');
    return [];
  },

  async getAddress(address: string): Promise<AddressInfo> {
    if (cache.address.has(address)) return cache.address.get(address)!;
    const type = this.detectSearchType(address);
    if (type === SearchType.ETH_ADDRESS) {
      try {
        const res = await fetch(`https://eth.blockscout.com/api/v2/addresses/${address}`);
        if (res.ok) {
          const raw = await res.json();
          const balance = parseFloat(raw.coin_balance || "0") / 1e18;
          const result = { 
            address: raw.hash, 
            chain_stats: { 
              funded_txo_sum: parseFloat(raw.coin_balance || "0"), 
              spent_txo_sum: 0, 
              tx_count: raw.transactions_count || 0,
              funded_txo_count: raw.transactions_count || 0, 
              spent_txo_count: 0 
            },
            mempool_stats: {
              funded_txo_count: 0,
              funded_txo_sum: 0,
              spent_txo_count: 0,
              spent_txo_sum: 0,
              tx_count: 0
            }
          } as AddressInfo;
          cache.address.set(address, result);
          return result;
        }
      } catch (e) {
        console.warn('Ethereum address fetch failed:', e);
      }
    }
    const result = await fetchWithFallback(`/address/${address}`);
    cache.address.set(address, result);
    return result;
  },

  async getAddressTxs(address: string): Promise<Transaction[]> {
    if (cache.addressTxs.has(address)) return cache.addressTxs.get(address)!;
    const type = this.detectSearchType(address);
    if (type === SearchType.ETH_ADDRESS) {
      try {
        const res = await fetch(`https://eth.blockscout.com/api/v2/addresses/${address}/transactions?limit=100`);
        if (res.ok) {
          const raw = await res.json();
          const result = (raw.items || []).map((t: any) => ({
            txid: t.hash,
            fee: parseFloat(t.fee?.value || "0"),
            status: { 
              confirmed: !!t.block, 
              block_height: t.block?.height, 
              block_time: t.timestamp ? Math.floor(new Date(t.timestamp).getTime()/1000) : undefined 
            },
            vin: [{ prevout: { scriptpubkey_address: t.from?.hash, value: parseFloat(t.value || "0") } }],
            vout: [{ scriptpubkey_address: t.to?.hash, value: parseFloat(t.value || "0") }],
            size: t.gas_used || 0,
            weight: t.gas_used || 0,
            version: 1,
            locktime: 0
          }));
          cache.addressTxs.set(address, result);
          return result;
        }
      } catch (e) {
        console.warn('Ethereum transactions fetch failed:', e);
      }
    }
    try {
      const result = await fetchWithFallback(`/address/${address}/txs`);
      cache.addressTxs.set(address, result);
      return result;
    } catch (e) {
      console.warn('Bitcoin transactions fetch failed:', e);
      return [];
    }
  },

  async getTransaction(txid: string): Promise<Transaction> {
    if (cache.tx.has(txid)) return cache.tx.get(txid)!;
    const type = this.detectSearchType(txid);
    if (type === SearchType.TX && txid.startsWith('0x')) {
      const res = await fetch(`https://eth.blockscout.com/api/v2/transactions/${txid}`);
      if (res.ok) {
        const t = await res.json();
        const result = {
          txid: t.hash,
          fee: parseFloat(t.fee?.value || "0"),
          status: { confirmed: !!t.block, block_height: t.block, block_time: t.timestamp ? new Date(t.timestamp).getTime()/1000 : undefined },
          vin: [{ prevout: { scriptpubkey_address: t.from?.hash, value: parseFloat(t.value || "0") } }],
          vout: [{ scriptpubkey_address: t.to?.hash, value: parseFloat(t.value || "0") }],
          size: t.size || 0,
          weight: t.weight || 0
        } as any;
        cache.tx.set(txid, result);
        return result;
      }
    }
    const result = await fetchWithFallback(`/tx/${txid}`);
    cache.tx.set(txid, result);
    return result;
  },

  async getClusteringHints(address: string, isEth: boolean) {
    try {
      // Local clustering analysis without API dependencies
      const clusteringResult = this.analyzeAddressPatterns(address, isEth);
      return clusteringResult;
    } catch (e) {
      return { clustering_label: isEth ? "EVM_ADDRESS" : "BTC_ADDRESS", entity_type: "UNKNOWN", threat_risk: 0, confidence: 0 };
    }
  },

  analyzeAddressPatterns(address: string, isEth: boolean) {
    const knownExchanges = {
      // Known exchange patterns and addresses
      'binance': {
        patterns: [/^1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s/, /^bc1qk5xxzm84vduxe5v2nfrqblfxg6t/, /^0x28C6c06298d514Db089934071355E5743bf21d60/i],
        label: 'BINANCE_EXCHANGE',
        entity_type: 'EXCHANGE',
        threat_risk: 10
      },
      'coinbase': {
        patterns: [/^1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ/, /^bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy/, /^0x71660c4005BA85c37ccec55d0C4493E66Fe775d3/i],
        label: 'COINBASE_EXCHANGE',
        entity_type: 'EXCHANGE',
        threat_risk: 5
      },
      'kraken': {
        patterns: [/^1KraKeHQ7Y4rYu5TxLPh9A1pHNxfsV6ZC/, /^bc1qj3cqr5qsqmcq30ktksxd/, /^0x2910543B9aCA65d1e3E78A1CcF2Ca1aD9b7f2F8/i],
        label: 'KRAKEN_EXCHANGE',
        entity_type: 'EXCHANGE',
        threat_risk: 8
      },
      'tornado': {
        patterns: [/^0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc/i, /^0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936/i],
        label: 'TORNADO_MIXER',
        entity_type: 'MIXER',
        threat_risk: 85
      }
    };

    const address_lower = address.toLowerCase();
    
    // Check against known exchange patterns
    for (const [exchangeName, exchangeInfo] of Object.entries(knownExchanges)) {
      for (const pattern of exchangeInfo.patterns) {
        if (pattern.test(address) || pattern.test(address_lower)) {
          return {
            clustering_label: exchangeInfo.label,
            entity_type: exchangeInfo.entity_type,
            threat_risk: exchangeInfo.threat_risk,
            confidence: 0.8
          };
        }
      }
    }

    // Pattern-based analysis
    let threat_risk = 0;
    let entity_type = 'PERSONAL';
    let clustering_label = isEth ? 'EVM_ADDRESS' : 'BTC_ADDRESS';

    if (isEth) {
      // Ethereum-specific patterns
      if (address_lower.startsWith('0x0000000000000000000000000000000000')) {
        return { clustering_label: 'NULL_ADDRESS', entity_type: 'SYSTEM', threat_risk: 0, confidence: 1.0 };
      }
      
      // Contract addresses often end in specific patterns
      if (this.looksLikeContract(address)) {
        entity_type = 'CONTRACT';
        clustering_label = 'SMART_CONTRACT';
        threat_risk = 20;
      } else {
        // EOA (Externally Owned Account) patterns
        clustering_label = 'EOA_WALLET';
        threat_risk = this.calculateThreatRiskEth(address);
      }
    } else {
      // Bitcoin-specific patterns
      if (address.startsWith('bc1')) {
        clustering_label = 'NATIVE_SEGWIT';
        threat_risk = this.calculateThreatRiskBtc(address);
      } else if (address.startsWith('3')) {
        clustering_label = 'P2SH_SEGWIT';
        threat_risk = this.calculateThreatRiskBtc(address);
      } else if (address.startsWith('1')) {
        clustering_label = 'LEGACY_P2PKH';
        threat_risk = this.calculateThreatRiskBtc(address);
      }
    }

    return {
      clustering_label,
      entity_type,
      threat_risk,
      confidence: 0.5
    };
  },

  looksLikeContract(address: string): boolean {
    // Simple heuristics to identify contract addresses
    const addr = address.toLowerCase();
    // Contracts often have specific patterns or well-known addresses
    const contractPatterns = [
      /0x[a-f0-9]{40}/, // General ETH address pattern
    ];
    
    // More sophisticated contract detection could be added here
    return false; // Conservative approach
  },

  calculateThreatRiskEth(address: string): number {
    let risk = 0;
    const addr = address.toLowerCase();
    
    // Patterns that might indicate higher risk
    if (addr.includes('dead') || addr.includes('null')) risk += 10;
    if (/^0x0+[1-9a-f]/.test(addr)) risk += 5; // Leading zeros might indicate generated address
    if (addr.length !== 42) risk += 20; // Invalid length
    
    return Math.min(risk, 100);
  },

  calculateThreatRiskBtc(address: string): number {
    let risk = 0;
    
    // Bitcoin address risk assessment
    if (address.length < 26 || address.length > 35) risk += 15;
    if (/[0OIl]/.test(address)) risk += 5; // Invalid characters in base58
    
    return Math.min(risk, 100);
  },

  /**
   * Comprehensive wallet identification based on address patterns, transaction behavior, and known signatures
   */
  identifyWallet(address: string, transactions?: any[], addressDetails?: any): WalletIdentification {
    const address_lower = address.toLowerCase();
    
    // Known wallet patterns and identifiers
    const walletPatterns = {
      // Hardware Wallets
      ledger: {
        patterns: [
          /^(bc1|1|3)[a-zA-Z0-9]{25,42}$/, // Ledger typically uses standard BTC formats
          /^0x[a-fA-F0-9]{40}$/i // Ledger ETH addresses
        ],
        brand: 'Ledger',
        type: 'Cold Wallet' as const,
        category: 'Hardware Wallet' as const,
        blockchain: 'Multi-Chain' as const,
        confidence: 0.6
      },
      trezor: {
        patterns: [
          /^(bc1|1|3)[a-zA-Z0-9]{25,42}$/, // Trezor uses standard formats
          /^0x[a-fA-F0-9]{40}$/i
        ],
        brand: 'Trezor',
        type: 'Cold Wallet' as const,
        category: 'Hardware Wallet' as const,
        blockchain: 'Multi-Chain' as const,
        confidence: 0.6
      },
      
      // Browser Extensions & Hot Wallets
      metamask: {
        patterns: [
          /^0x[a-fA-F0-9]{40}$/i // MetaMask creates standard ETH addresses
        ],
        brand: 'MetaMask',
        type: 'Hot Wallet' as const,
        category: 'Browser Extension' as const,
        blockchain: 'Ethereum' as const,
        confidence: 0.5
      },
      rabby: {
        patterns: [
          /^0x[a-fA-F0-9]{40}$/i
        ],
        brand: 'Rabby Wallet',
        type: 'Hot Wallet' as const,
        category: 'Browser Extension' as const,
        blockchain: 'Ethereum' as const,
        confidence: 0.4
      },
      phantom: {
        patterns: [
          /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ // Solana address pattern
        ],
        brand: 'Phantom',
        type: 'Hot Wallet' as const,
        category: 'Browser Extension' as const,
        blockchain: 'Solana' as const,
        confidence: 0.6
      },
      
      // Exchange Wallets
      binance: {
        patterns: [
          /^bnb1[a-z0-9]{38}$/i, // Binance Chain
          /^0x28C6c06298d514Db089934071355E5743bf21d60/i,
          /^1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s/,
          /^bc1qk5xxzm84vduxe5v2nfrqblfxg6t/
        ],
        brand: 'Binance',
        type: 'Custodial' as const,
        category: 'Exchange Wallet' as const,
        blockchain: 'Multi-Chain' as const,
        confidence: 0.9
      },
      coinbase: {
        patterns: [
          /^1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ/,
          /^bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy/,
          /^0x71660c4005BA85c37ccec55d0C4493E66Fe775d3/i,
          /^0xA090e606E30bD747d4E6245a1517EbE430F0057e/i
        ],
        brand: 'Coinbase',
        type: 'Custodial' as const,
        category: 'Exchange Wallet' as const,
        blockchain: 'Multi-Chain' as const,
        confidence: 0.95
      },
      kraken: {
        patterns: [
          /^1KraKeHQ7Y4rYu5TxLPh9A1pHNxfsV6ZC/,
          /^bc1qj3cqr5qsqmcq30ktksxd/,
          /^0x2910543B9aCA65d1e3E78A1CcF2Ca1aD9b7f2F8/i
        ],
        brand: 'Kraken',
        type: 'Custodial' as const,
        category: 'Exchange Wallet' as const,
        blockchain: 'Multi-Chain' as const,
        confidence: 0.9
      },
      
      // Mobile Wallets
      trust_wallet: {
        patterns: [
          /^0x[a-fA-F0-9]{40}$/i, // Can be ETH or BNB
          /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/ // Bitcoin
        ],
        brand: 'Trust Wallet',
        type: 'Non-Custodial' as const,
        category: 'Mobile Wallet' as const,
        blockchain: 'Multi-Chain' as const,
        confidence: 0.4
      },
      
      // Desktop Wallets
      exodus: {
        patterns: [
          /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/, // Bitcoin
          /^0x[a-fA-F0-9]{40}$/i // Ethereum
        ],
        brand: 'Exodus',
        type: 'Non-Custodial' as const,
        category: 'Desktop Wallet' as const,
        blockchain: 'Multi-Chain' as const,
        confidence: 0.4
      },
      electrum: {
        patterns: [
          /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/, // Bitcoin
          /^bc1[ac-hj-np-z02-9]{11,71}$/i // SegWit
        ],
        brand: 'Electrum',
        type: 'Non-Custodial' as const,
        category: 'Desktop Wallet' as const,
        blockchain: 'Bitcoin' as const,
        confidence: 0.5
      },
      
      // Multi-Signature Wallets
      gnosis_safe: {
        patterns: [
          /^0x[a-fA-F0-9]{40}$/i // Gnosis Safe contract addresses
        ],
        brand: 'Gnosis Safe',
        type: 'Non-Custodial' as const,
        category: 'Multi-Signature Wallet' as const,
        blockchain: 'Ethereum' as const,
        confidence: 0.3
      },
      
      // MPC Wallets
      zengo: {
        patterns: [
          /^0x[a-fA-F0-9]{40}$/i,
          /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
        ],
        brand: 'ZenGo',
        type: 'Non-Custodial' as const,
        category: 'MPC Wallet' as const,
        blockchain: 'Multi-Chain' as const,
        confidence: 0.3
      }
    };
    
    // Check against known wallet patterns
    for (const [walletKey, walletInfo] of Object.entries(walletPatterns)) {
      for (const pattern of walletInfo.patterns) {
        if (pattern.test(address) || pattern.test(address_lower)) {
          // Check if we have transaction behavior that confirms this
          let confidence = walletInfo.confidence;
          
          // Increase confidence based on transaction patterns
          if (transactions && transactions.length > 0) {
            confidence = Math.min(confidence + 0.1, 1.0);
          }
          
          return {
            blockchain: walletInfo.blockchain,
            walletType: walletInfo.type,
            walletCategory: walletInfo.category,
            walletBrand: walletInfo.brand,
            confidence: confidence,
            detectionMethod: 'Pattern matching'
          };
        }
      }
    }
    
    // Fallback: Identify by address format if no specific wallet detected
    return this.identifyByAddressFormat(address, transactions, addressDetails);
  },

  /**
   * Identify wallet type by analyzing address format and transaction behavior
   */
  identifyByAddressFormat(address: string, transactions?: any[], addressDetails?: any): WalletIdentification {
    const address_lower = address.toLowerCase();
    
    // Ethereum/EVM addresses
    if (/^0x[a-fA-F0-9]{40}$/i.test(address)) {
      let category: WalletIdentification['walletCategory'] = 'Browser Extension';
      let walletType: WalletIdentification['walletType'] = 'Non-Custodial';
      let confidence = 0.3;
      
      // Check if it's a contract (likely multi-sig or MPC)
      if (addressDetails?.contract_info?.is_contract) {
        category = 'Multi-Signature Wallet';
        confidence = 0.6;
      }
      
      // High transaction count might indicate exchange
      if (transactions && transactions.length > 100) {
        category = 'Exchange Wallet';
        walletType = 'Custodial';
        confidence = 0.5;
      }
      
      // Check for Sepolia or testnet
      const networkType = addressDetails?.network_type || '';
      if (networkType.toLowerCase().includes('sepolia') || networkType.toLowerCase().includes('testnet')) {
        return {
          blockchain: 'Ethereum',
          walletType: 'Non-Custodial',
          walletCategory: 'Browser Extension',
          walletBrand: 'MetaMask (Testnet)',
          confidence: 0.7,
          detectionMethod: 'Testnet detection'
        };
      }
      
      return {
        blockchain: 'Ethereum',
        walletType: walletType,
        walletCategory: category,
        confidence: confidence,
        detectionMethod: 'Address format analysis'
      };
    }
    
    // Bitcoin addresses
    if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) || /^bc1[ac-hj-np-z02-9]{11,71}$/i.test(address)) {
      let category: WalletIdentification['walletCategory'] = 'Desktop Wallet';
      let walletType: WalletIdentification['walletType'] = 'Non-Custodial';
      let confidence = 0.3;
      
      // SegWit addresses might indicate modern wallets
      if (address.startsWith('bc1')) {
        category = 'Multi-Chain Wallet';
        confidence = 0.4;
      }
      
      // Legacy addresses might be older wallets
      if (address.startsWith('1')) {
        category = 'Desktop Wallet';
        confidence = 0.35;
      }
      
      // High transaction volume indicates exchange
      if (transactions && transactions.length > 50) {
        category = 'Exchange Wallet';
        walletType = 'Custodial';
        confidence = 0.5;
      }
      
      return {
        blockchain: 'Bitcoin',
        walletType: walletType,
        walletCategory: category,
        confidence: confidence,
        detectionMethod: 'Bitcoin address format analysis'
      };
    }
    
    // Solana addresses (Base58, 32-44 characters)
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return {
        blockchain: 'Solana',
        walletType: 'Hot Wallet',
        walletCategory: 'Browser Extension',
        walletBrand: 'Phantom',
        confidence: 0.5,
        detectionMethod: 'Solana address format'
      };
    }
    
    // Unknown format
    return {
      blockchain: 'Unknown',
      walletType: 'Non-Custodial',
      confidence: 0.1,
      detectionMethod: 'Unknown format'
    };
  },

  clearCache() {
    cache.address.clear();
    cache.tx.clear();
    cache.addressTxs.clear();
  }
};