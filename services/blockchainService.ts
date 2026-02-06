import { AddressInfo, Transaction, SearchType } from '../types';

const BTC_PROVIDERS = [
  'https://mempool.space/api',
  'https://blockstream.info/api',
  'https://api.blockcypher.com/v1/btc/main'
];

const fetchWithFallback = async (endpoint: string, options: RequestInit = {}, timeout = 12000) => {
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

      const response = await fetch(finalUrl, {
        ...options,
        signal: controller.signal,
        mode: 'cors',
      });
      clearTimeout(id);
      
      if (response.ok) {
        const data = await response.json();
        if (isBlockcypher && data.address) {
          if (endpoint.endsWith('/txs')) {
            return (data.txs || []).map((t: any) => ({
              txid: t.hash,
              fee: t.fees,
              status: { confirmed: !!t.block_height, block_height: t.block_height, block_time: t.confirmed ? new Date(t.confirmed).getTime()/1000 : undefined },
              vin: (t.inputs || []).map((i: any) => ({ prevout: { scriptpubkey_address: i.addresses?.[0], value: i.output_value } })),
              vout: (t.outputs || []).map((o: any) => ({ scriptpubkey_address: o.addresses?.[0], value: o.value }))
            }));
          }
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
        return data;
      }
      if (response.status === 404) continue;
      if (response.status === 429) continue;
    } catch (err: any) {
      clearTimeout(id);
      lastError = err;
      continue;
    }
  }
  throw lastError || new Error("All forensic nodes unresponsive.");
};

export const blockchainService = {
  detectSearchType(query: string): SearchType {
    const q = query.trim();
    if (!q) return SearchType.UNKNOWN;
    
    if (/^0x[a-fA-F0-9]{40}$/i.test(q)) return SearchType.ETH_ADDRESS;
    if (/^0x[0-9a-fA-F]{64}$/i.test(q)) return SearchType.TX;
    
    const isBtcAddress = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(q) || 
                         /^bc1[ac-hj-np-z02-9]{11,71}$/i.test(q);
    if (isBtcAddress) return SearchType.ADDRESS;
    
    if (/^\d+$/.test(q) && q.length < 10) return SearchType.BLOCK;
    if (/^[0-9a-fA-F]{64}$/i.test(q)) {
        if (q.startsWith('00000000')) return SearchType.BLOCK;
        return SearchType.TX;
    }
    
    return SearchType.UNKNOWN;
  },

  async getClusteringHints(address: string, isEth: boolean): Promise<any> {
    if (isEth) return null;
    try {
      const response = await fetch(`https://api.blockchair.com/bitcoin/dashboards/address/${address}?limit=0`);
      if (response.ok) {
        const result = await response.json();
        const addrData = result.data?.[address]?.address;
        if (addrData) {
          return {
            clustering_label: addrData.label || "Indeterminate",
            entity_tags: addrData.tags || "None detected",
            privacy_score: addrData.privacy_score !== undefined ? `${addrData.privacy_score}/100` : "N/A",
            tx_velocity: addrData.transaction_count > 0 ? (addrData.transaction_count / (Math.max(1, (Date.now() - new Date(addrData.first_seen_receiving).getTime()) / (1000 * 60 * 60 * 24)))).toFixed(2) + " tx/day" : "0",
            first_active: addrData.first_seen_receiving ? new Date(addrData.first_seen_receiving).toLocaleDateString() : "N/A",
            last_active: addrData.last_seen_spending ? new Date(addrData.last_seen_spending).toLocaleDateString() : "N/A"
          };
        }
      }
    } catch (e) {
      console.warn("Clustering engine skipped:", e);
    }
    return null;
  },

  async getAddress(address: string): Promise<AddressInfo> {
    const isEth = /^0x[a-fA-F0-9]{40}$/i.test(address);
    if (isEth) {
      try {
        const res = await fetch(`https://eth.blockscout.com/api/v2/addresses/${address}`);
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
            }
          } as any;
        }
      } catch(e) {}
    }

    try {
      return await fetchWithFallback(`/address/${address}`);
    } catch (e) {
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
      throw new Error("Target address could not be resolved.");
    }
  },

  async getAddressTxs(address: string): Promise<Transaction[]> {
    const isEth = /^0x[a-fA-F0-9]{40}$/i.test(address);
    if (isEth) {
      try {
        const res = await fetch(`https://eth.blockscout.com/api/v2/addresses/${address}/transactions?limit=50`);
        if (res.ok) {
          const raw = await res.json();
          return (raw.items || []).map((t: any) => ({
            txid: t.hash,
            fee: parseFloat(t.fee?.value || "0"),
            status: { confirmed: !!t.block, block_height: t.block, block_time: t.timestamp ? new Date(t.timestamp).getTime()/1000 : undefined },
            vin: [{ prevout: { scriptpubkey_address: t.from?.hash, value: parseFloat(t.value || "0") } }],
            vout: [{ scriptpubkey_address: t.to?.hash, value: parseFloat(t.value || "0") }]
          }));
        }
      } catch(e) {}
    }
    try {
      return await fetchWithFallback(`/address/${address}/txs`);
    } catch (e) {
      const res = await fetch(`https://blockchain.info/rawaddr/${address}?cors=true&limit=50`);
      if (res.ok) {
        const raw = await res.json();
        return (raw.txs || []).map((t: any) => ({
          txid: t.hash,
          fee: t.fee,
          status: { confirmed: !!t.block_height, block_height: t.block_height, block_time: t.time },
          vin: (t.inputs || []).map((i: any) => ({ prevout: { scriptpubkey_address: i.prev_out?.addr, value: i.prev_out?.value } })),
          vout: (t.out || []).map((o: any) => ({ scriptpubkey_address: o.addr, value: o.value }))
        }));
      }
      return [];
    }
  },

  async getTransaction(txid: string): Promise<Transaction> {
    const isEth = /^0x[0-9a-fA-F]{64}$/i.test(txid);
    if (isEth) {
      try {
        const res = await fetch(`https://eth.blockscout.com/api/v2/transactions/${txid}`);
        if (res.ok) {
          const t = await res.json();
          return {
            txid: t.hash,
            fee: parseFloat(t.fee?.value || "0"),
            status: { confirmed: !!t.block, block_height: t.block, block_time: t.timestamp ? new Date(t.timestamp).getTime()/1000 : undefined },
            vin: [{ prevout: { scriptpubkey_address: t.from?.hash, value: parseFloat(t.value || "0") } }],
            vout: [{ scriptpubkey_address: t.to?.hash, value: parseFloat(t.value || "0") }]
          } as any;
        }
      } catch(e) {}
    }

    try {
      return await fetchWithFallback(`/tx/${txid}`);
    } catch (e) {
      const res = await fetch(`https://blockchain.info/rawtx/${txid}?cors=true`);
      if (res.ok) {
        const t = await res.json();
        return {
          txid: t.hash,
          fee: t.fee,
          status: { confirmed: !!t.block_height, block_height: t.block_height, block_time: t.time },
          vin: (t.inputs || []).map((i: any) => ({ prevout: { scriptpubkey_address: i.prev_out?.addr, value: i.prev_out?.value } })),
          vout: (t.out || []).map((o: any) => ({ scriptpubkey_address: o.addr, value: o.value }))
        } as any;
      }
      throw new Error("Transaction trace lost. Network might be unstable.");
    }
  },

  async getBlock(blockId: string): Promise<any> {
    try {
      const hash = /^\d+$/.test(blockId) ? await fetchWithFallback(`/block-height/${blockId}`) : blockId;
      return await fetchWithFallback(`/block/${hash}`);
    } catch (e) {
      throw new Error("Block unreachable.");
    }
  },

  async getBlockTransactions(blockHash: string): Promise<string[]> {
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
        { name: 'Blockscout', url: `https://eth.blockscout.com/address/${identifier}` }
      );
    } else if (type === 'address') {
      links.push(
        { name: 'Mempool', url: `https://mempool.space/address/${identifier}` },
        { name: 'Blockchain.com', url: `https://www.blockchain.com/explorer/addresses/btc/${identifier}` },
        { name: 'Blockchair', url: `https://blockchair.com/bitcoin/address/${identifier}` }
      );
    } else if (type === 'block') {
      links.push({ name: 'Mempool', url: `https://mempool.space/block/${identifier}` });
    } else {
      links.push({ name: 'Mempool', url: `https://mempool.space/tx/${identifier}` });
    }
    return links;
  }
};