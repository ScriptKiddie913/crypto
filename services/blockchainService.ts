import { AddressInfo, Transaction, SearchType } from '../types';
import { GoogleGenAI } from "@google/genai";

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
    const hits: any[] = [];
    try {
      // 1. Search Code with Text Matches (extracts actual code snippets)
      const codeRes = await fetch(`https://api.github.com/search/code?q="${query}"`, {
        headers: { 'Accept': 'application/vnd.github.v3.text-match+json' }
      });
      if (codeRes.ok) {
        const data = await codeRes.json();
        (data.items || []).forEach((item: any) => {
          const fragment = item.text_matches?.[0]?.fragment || `Matched identifier in ${item.path}`;
          hits.push({
            name: item.repository.full_name,
            url: item.html_url,
            path: item.path,
            repo_url: item.repository.html_url,
            description: item.repository.description || "Source code match",
            context: fragment.trim(),
            type: 'github_code'
          });
        });
      }

      // 2. Search Commits (identifies matches in commit messages)
      const commitRes = await fetch(`https://api.github.com/search/commits?q="${query}"`, {
        headers: { 'Accept': 'application/vnd.github.cloak-preview' }
      });
      if (commitRes.ok) {
        const data = await commitRes.json();
        (data.items || []).forEach((item: any) => {
          hits.push({
            name: item.repository.full_name,
            url: item.html_url,
            path: 'Commit Message',
            repo_url: item.repository.html_url,
            description: "Found in commit logs",
            context: item.commit.message,
            type: 'github_commit'
          });
        });
      }
    } catch (e) { 
      console.warn("GitHub OSINT service limit reached or network error."); 
    }
    return hits;
  },

  async getAddress(address: string): Promise<AddressInfo> {
    if (cache.address.has(address)) return cache.address.get(address)!;
    const type = this.detectSearchType(address);
    if (type === SearchType.ETH_ADDRESS) {
      const res = await fetch(`https://eth.blockscout.com/api/v2/addresses/${address}`);
      if (res.ok) {
        const raw = await res.json();
        const result = { address: raw.hash, chain_stats: { funded_txo_sum: parseFloat(raw.coin_balance || "0"), spent_txo_sum: 0, tx_count: 0, funded_txo_count: 0, spent_txo_count: 0 } } as any;
        cache.address.set(address, result);
        return result;
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
      const res = await fetch(`https://eth.blockscout.com/api/v2/addresses/${address}/transactions?limit=100`);
      if (res.ok) {
        const raw = await res.json();
        const result = (raw.items || []).map((t: any) => ({
          txid: t.hash,
          fee: parseFloat(t.fee?.value || "0"),
          status: { confirmed: !!t.block, block_height: t.block, block_time: t.timestamp ? new Date(t.timestamp).getTime()/1000 : undefined },
          vin: [{ prevout: { scriptpubkey_address: t.from?.hash, value: parseFloat(t.value || "0") } }],
          vout: [{ scriptpubkey_address: t.to?.hash, value: parseFloat(t.value || "0") }]
        }));
        cache.addressTxs.set(address, result);
        return result;
      }
    }
    const result = await fetchWithFallback(`/address/${address}/txs`);
    cache.addressTxs.set(address, result);
    return result;
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
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Analyze the following crypto address for forensic clustering: ${address}. 
        Identify if it belongs to an exchange (Binance, Coinbase, etc.), a mixer (Tornado, CoinJoin), or a known entity.
        Return ONLY a JSON object with: 
        "clustering_label" (short label),
        "entity_type" (EXCHANGE, MIXER, PERSONAL, MERCHANT),
        "threat_risk" (0-100),
        "confidence" (0-1).`,
        config: { responseMimeType: "application/json" }
      });
      return JSON.parse(response.text || '{}');
    } catch (e) {
      return { clustering_label: isEth ? "EVM_ADDRESS" : "BTC_ADDRESS", entity_type: "UNKNOWN", threat_risk: 0, confidence: 0 };
    }
  },

  clearCache() {
    cache.address.clear();
    cache.tx.clear();
    cache.addressTxs.clear();
  }
};