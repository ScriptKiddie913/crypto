import { AddressInfo, Transaction, SearchType } from '../types';

const BTC_PROVIDERS = [
  'https://mempool.space/api',
  'https://blockstream.info/api'
];

const ETH_MAINNET_PROVIDER = 'https://eth.blockscout.com/api/v2';
const ETH_SEPOLIA_PROVIDER = 'https://eth-sepolia.blockscout.com/api/v2';

const fetchWithFallback = async (endpoint: string, options: RequestInit = {}, timeout = 10000) => {
  let lastError: any = null;

  for (const base of BTC_PROVIDERS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${base}${endpoint}`, {
        ...options,
        signal: controller.signal,
        mode: 'cors',
        headers: {
          'Accept': 'application/json',
          ...options.headers,
        }
      });
      clearTimeout(id);
      
      if (response.ok) return await response.json();
      if (response.status === 404) throw new Error("IDENTIFIER_NOT_FOUND");
      if (response.status === 429) continue;

      throw new Error(`PROVIDER_ERROR_${response.status}`);
    } catch (err: any) {
      clearTimeout(id);
      if (err.message === "IDENTIFIER_NOT_FOUND") throw err;
      lastError = err;
      continue;
    }
  }
  throw lastError || new Error("FORENSIC_TIMEOUT");
};

export const blockchainService = {
  detectSearchType(query: string): SearchType {
    const q = query.trim();
    if (!q) return SearchType.UNKNOWN;
    
    if (/^0x[a-fA-F0-9]{40}$/i.test(q)) return SearchType.ETH_ADDRESS;
    if (/^0x[0-9a-fA-F]{64}$/i.test(q)) return SearchType.TX;
    
    const isBtcAddress = /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(q) || 
                         /^(bc1)[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,59}$/i.test(q);
    if (isBtcAddress) return SearchType.ADDRESS;
    
    if (/^\d+$/.test(q) && q.length < 10) return SearchType.BLOCK;

    if (/^[0-9a-fA-F]{64}$/i.test(q)) {
        if (q.startsWith('00000000')) return SearchType.BLOCK;
        return SearchType.TX;
    }
    
    return SearchType.UNKNOWN;
  },

  async getAddress(address: string): Promise<AddressInfo> {
    const isEth = /^0x[a-fA-F0-9]{40}$/i.test(address);

    if (isEth) {
      for (const provider of [ETH_MAINNET_PROVIDER, ETH_SEPOLIA_PROVIDER]) {
        try {
          const res = await fetch(`${provider}/addresses/${address}`, { mode: 'cors' });
          if (res.ok) {
            const raw = await res.json();
            return {
              address: raw.hash,
              chain_stats: {
                funded_txo_sum: parseFloat(raw.coin_balance || "0"),
                spent_txo_sum: 0,
                tx_count: 0,
                funded_txo_count: 0,
                spent_txo_count: 0
              },
              mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 }
            } as any;
          }
        } catch (e) { continue; }
      }
      throw new Error("Ethereum target resolution failed.");
    }

    try {
      const data = await fetchWithFallback(`/address/${address}`);
      return {
        address: data.address,
        chain_stats: data.chain_stats,
        mempool_stats: data.mempool_stats
      };
    } catch (e: any) {
      if (e.message === "IDENTIFIER_NOT_FOUND") {
         return {
           address,
           chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0, funded_txo_count: 0, spent_txo_count: 0 },
           mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 }
         };
      }
      
      try {
        const res = await fetch(`https://blockchain.info/rawaddr/${address}?cors=true&limit=0`);
        if (res.ok) {
          const raw = await res.json();
          return {
            address: raw.address,
            chain_stats: {
              funded_txo_sum: raw.total_received,
              spent_txo_sum: raw.total_received - raw.final_balance,
              tx_count: raw.n_tx,
              funded_txo_count: raw.n_tx,
              spent_txo_count: 0
            }
          } as any;
        }
      } catch (inner) {}
      
      throw new Error(`BTC target unreachable.`);
    }
  },

  async getAddressTxs(address: string): Promise<Transaction[]> {
    const isEth = /^0x[a-fA-F0-9]{40}$/i.test(address);
    if (isEth) {
      for (const provider of [ETH_MAINNET_PROVIDER, ETH_SEPOLIA_PROVIDER]) {
        try {
          const res = await fetch(`${provider}/addresses/${address}/transactions?limit=15`, { mode: 'cors' });
          if (res.ok) {
            const raw = await res.json();
            return (raw.items || []).map((t: any) => ({
              txid: t.hash,
              fee: parseFloat(t.fee?.value || "0"),
              status: { 
                confirmed: !!t.block, 
                block_time: t.timestamp ? new Date(t.timestamp).getTime() / 1000 : undefined,
                block_height: t.block 
              },
              vin: [{ prevout: { scriptpubkey_address: t.from?.hash, value: parseFloat(t.value || "0") } }],
              vout: [{ scriptpubkey_address: t.to?.hash, value: parseFloat(t.value || "0") }]
            })) as any;
          }
        } catch (e) { continue; }
      }
      return [];
    }
    try {
      return await fetchWithFallback(`/address/${address}/txs`);
    } catch (e: any) {
      return [];
    }
  },

  async getTransaction(txid: string): Promise<Transaction> {
    const isEthTx = txid.toLowerCase().startsWith('0x');
    if (isEthTx) {
      for (const provider of [ETH_MAINNET_PROVIDER, ETH_SEPOLIA_PROVIDER]) {
        try {
          const res = await fetch(`${provider}/transactions/${txid}`, { mode: 'cors' });
          if (res.ok) {
            const t = await res.json();
            return {
              txid: t.hash,
              fee: parseFloat(t.fee?.value || "0"),
              status: { 
                confirmed: !!t.block, 
                block_time: t.timestamp ? new Date(t.timestamp).getTime() / 1000 : undefined,
                block_height: t.block 
              },
              vin: [{ prevout: { scriptpubkey_address: t.from?.hash, value: parseFloat(t.value || "0") } }],
              vout: [{ scriptpubkey_address: t.to?.hash, value: parseFloat(t.value || "0") }]
            } as any;
          }
        } catch (e) { continue; }
      }
      throw new Error(`ETH TX resolution failure.`);
    }
    try {
      return await fetchWithFallback(`/tx/${txid}`);
    } catch (e) {
      const res = await fetch(`https://blockchain.info/rawtx/${txid}?cors=true`);
      if (!res.ok) throw new Error("Transaction record missing.");
      const t = await res.json();
      return {
        txid: t.hash,
        fee: t.fee,
        status: { confirmed: !!t.block_height, block_time: t.time, block_height: t.block_height },
        vin: (t.inputs || []).map((i: any) => ({ prevout: { scriptpubkey_address: i.prev_out?.addr, value: i.prev_out?.value } })),
        vout: (t.out || []).map((o: any) => ({ scriptpubkey_address: o.addr, value: o.value }))
      } as any;
    }
  },

  async getBlock(blockId: string): Promise<any> {
    const isEthHash = blockId.startsWith('0x');
    if (isEthHash) {
      for (const provider of [ETH_MAINNET_PROVIDER, ETH_SEPOLIA_PROVIDER]) {
        try {
          const res = await fetch(`${provider}/blocks/${blockId}`, { mode: 'cors' });
          if (res.ok) return await res.json();
        } catch (e) { continue; }
      }
    }
    try {
        const hash = /^\d+$/.test(blockId) ? await fetchWithFallback(`/block-height/${blockId}`) : blockId;
        return await fetchWithFallback(`/block/${hash}`);
    } catch (e) {
        if (/^\d+$/.test(blockId)) {
            for (const provider of [ETH_MAINNET_PROVIDER, ETH_SEPOLIA_PROVIDER]) {
                try {
                    const res = await fetch(`${provider}/blocks/${blockId}`, { mode: 'cors' });
                    if (res.ok) return await res.json();
                } catch (e) { continue; }
            }
        }
        throw new Error("Block resolution failed.");
    }
  },

  async getBlockTransactions(blockHash: string): Promise<string[]> {
    if (blockHash.startsWith('0x')) {
        for (const provider of [ETH_MAINNET_PROVIDER, ETH_SEPOLIA_PROVIDER]) {
            try {
              const res = await fetch(`${provider}/blocks/${blockHash}/transactions?limit=10`, { mode: 'cors' });
              if (res.ok) {
                  const data = await res.json();
                  return data.items.map((i: any) => i.hash);
              }
            } catch (e) { continue; }
        }
        return [];
    }
    try {
        return await fetchWithFallback(`/block/${blockHash}/txids`);
    } catch (e) {
        return [];
    }
  },

  getExternalOsintLinks(identifier: string, type: string) {
    const links = [];
    const isEth = identifier.toLowerCase().startsWith('0x');
    if (type === 'eth_address' || (type === 'address' && isEth)) {
       links.push(
        { name: 'Etherscan', url: `https://etherscan.io/address/${identifier}` },
        { name: 'Sepolia Scan', url: `https://sepolia.etherscan.io/address/${identifier}` },
        { name: 'Blockscout', url: `https://eth.blockscout.com/address/${identifier}` }
      );
    } else if (type === 'address') {
      links.push(
        { name: 'Mempool', url: `https://mempool.space/address/${identifier}` },
        { name: 'Blockchain.com', url: `https://www.blockchain.com/explorer/addresses/btc/${identifier}` }
      );
    } else if (type === 'block') {
        if (isEth) {
            links.push(
                { name: 'Etherscan', url: `https://etherscan.io/block/${identifier}` },
                { name: 'Sepolia Scan', url: `https://sepolia.etherscan.io/block/${identifier}` }
            );
        } else {
            links.push(
                { name: 'Mempool', url: `https://mempool.space/block/${identifier}` },
                { name: 'Blockchain.com', url: `https://www.blockchain.com/explorer/blocks/btc/${identifier}` }
            );
        }
    } else {
      if (isEth) {
        links.push(
          { name: 'Etherscan', url: `https://etherscan.io/tx/${identifier}` },
          { name: 'Sepolia Scan', url: `https://sepolia.etherscan.io/tx/${identifier}` }
        );
      } else {
        links.push(
          { name: 'Mempool', url: `https://mempool.space/tx/${identifier}` },
          { name: 'Blockstream', url: `https://blockstream.info/tx/${identifier}` }
        );
      }
    }
    return links;
  }
};