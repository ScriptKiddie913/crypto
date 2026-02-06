import React, { useState, useCallback, useRef } from 'react';
import { 
  Search, 
  Shield, 
  Activity, 
  X, 
  AlertTriangle, 
  Download,
  RefreshCw,
  Cpu,
  Zap,
  Globe,
  Crosshair,
  Eye,
  Map,
  FileText,
  ArrowUpRight,
  Database,
  Menu,
  ChevronRight,
  Fingerprint,
  Calendar,
  Lock,
  Terminal,
  BarChart3,
  Network,
  Box
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { blockchainService } from './services/blockchainService';
import { NodeData, LinkData, SearchType } from './types';
import TransactionGraph from './components/TransactionGraph';

const App: React.FC = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [links, setLinks] = useState<LinkData[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  const seenNodes = useRef<Set<string>>(new Set());
  const seenLinks = useRef<Set<string>>(new Set());

  const addNode = useCallback((node: NodeData) => {
    if (seenNodes.current.has(node.id)) return false;
    seenNodes.current.add(node.id);
    setNodes(prev => [...prev, node]);
    return true;
  }, []);

  const addLink = useCallback((link: LinkData) => {
    const linkId = `${link.source}-${link.target}`;
    if (seenLinks.current.has(linkId)) return false;
    seenLinks.current.add(linkId);
    setLinks(prev => [...prev, link]);
    return true;
  }, []);

  const resetGraph = () => {
    setNodes([]);
    setLinks([]);
    seenNodes.current.clear();
    seenLinks.current.clear();
    setSelectedNode(null);
    setError(null);
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const identifyEntity = (id: string): string => {
    const registry: Record<string, string> = {
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa': 'Satoshi Nakamoto (Genesis)',
      '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo': 'Binance-Cold-Wallet-01',
      'bc1qgd7dqz97wjcrp26qv6630vcluz86v69re64p0p': 'Binance-Hot-Wallet-02',
      'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh': 'Binance-Hot-Wallet-01',
      '0x9e687D28C77Be60EeEc36B3beAc84155bD18f329': 'Target-Investigation-EVM',
      '0x93be4f3b5673e35e3fb4444da25d4b6b9cdbe338dee33fa8cf4f8803afabc26a': 'Target-EVM-Transaction-Hash'
    };
    return registry[id] || "";
  };

  const calculateRisk = (node: NodeData): number => {
    let score = 12;
    if (node.type === 'entity') score = 70;
    if (node.type === 'block') score = 5;
    if (node.details?.total_received || node.details?.current_balance || node.details?.balance) {
      const valStr = (node.details.total_received || node.details.current_balance || node.details.balance || "0").split(' ')[0];
      const val = parseFloat(valStr);
      if (val > 50) score += 20;
      if (val > 500) score += 30;
    }
    return Math.min(score, 100);
  };

  const expandNode = async (nodeId: string, type: string, maxDepth = 1, currentDepth = 0) => {
    if (currentDepth >= maxDepth) return;
    
    const isEthHash = nodeId.toLowerCase().startsWith('0x');
    const unit = type === 'eth_address' || isEthHash ? 'ETH' : 'BTC';

    try {
      if (type === 'address' || type === 'eth_address') {
        const txs = await blockchainService.getAddressTxs(nodeId);
        for (const tx of txs.slice(0, 10)) {
          const txNode: NodeData = {
            id: tx.txid,
            type: 'transaction',
            label: `TX: ${tx.txid.substring(0, 6)}`,
            details: {
              identifier: tx.txid,
              status: tx.status?.confirmed ? "Confirmed" : "Mempool",
              execution_date: tx.status?.block_time ? new Date(tx.status.block_time * 1000).toLocaleString() : "N/A"
            }
          };
          if (addNode(txNode)) {
             addLink({ source: nodeId, target: txNode.id, value: 2 });
             await expandNode(txNode.id, 'transaction', maxDepth, currentDepth + 1);
          }
          await sleep(50);
        }
      } else if (type === 'transaction') {
        const txData = await blockchainService.getTransaction(nodeId);
        const outputs = (txData.vout || []).slice(0, 5);
        for (const output of outputs) {
          const addr = output.scriptpubkey_address;
          if (addr) {
            const outNode: NodeData = {
              id: addr,
              type: addr.toLowerCase().startsWith('0x') ? 'eth_address' : 'address',
              label: identifyEntity(addr) || `${addr.substring(0, 8)}...`,
              details: { 
                identifier: addr, 
                value: (unit === 'BTC' ? (output.value / 1e8).toFixed(8) : (output.value / 1e18).toFixed(12)) + ` ${unit}` 
              }
            };
            if (addNode(outNode)) {
               addLink({ source: nodeId, target: outNode.id, value: 1 });
               await expandNode(addr, outNode.type, maxDepth, currentDepth + 1);
            }
            await sleep(40);
          }
        }
      } else if (type === 'block') {
        const txids = await blockchainService.getBlockTransactions(nodeId);
        for (const txid of txids.slice(0, 10)) {
            const txNode: NodeData = {
                id: txid,
                type: 'transaction',
                label: `TX: ${txid.substring(0, 6)}`,
                details: { identifier: txid, category: "Block Member" }
            };
            if (addNode(txNode)) {
              addLink({ source: nodeId, target: txNode.id, value: 1 });
              await expandNode(txid, 'transaction', maxDepth, currentDepth + 1);
            }
            await sleep(40);
        }
      }
    } catch (err: any) {
      console.warn("Forensic branch resolution failed:", err.message);
    }
  };

  const startInvestigation = async (overrideQuery?: string) => {
    const searchVal = (overrideQuery || query).trim();
    if (!searchVal || loading) return;

    setLoading(true);
    resetGraph();

    try {
      const type = blockchainService.detectSearchType(searchVal);
      if (type === SearchType.ADDRESS || type === SearchType.ETH_ADDRESS) {
        const addrData = await blockchainService.getAddress(searchVal);
        const unit = type === SearchType.ETH_ADDRESS ? 'ETH' : 'BTC';
        const root: NodeData = { 
          id: searchVal, type, 
          label: identifyEntity(searchVal) || `${searchVal.substring(0, 8)}...`, 
          details: { 
            identifier: searchVal, 
            balance: unit === 'ETH' 
              ? (addrData.chain_stats.funded_txo_sum / 1e18).toFixed(8) + " ETH" 
              : ((addrData.chain_stats.funded_txo_sum - addrData.chain_stats.spent_txo_sum) / 1e8).toFixed(8) + " BTC",
            tx_count: addrData.chain_stats.tx_count
          }
        };
        addNode(root); 
        setSelectedNode(root); 
        await expandNode(searchVal, type, 1, 0);
      } else if (type === SearchType.TX) {
        const txData = await blockchainService.getTransaction(searchVal);
        const root: NodeData = { 
          id: searchVal, type: 'transaction', 
          label: `TX: ${searchVal.substring(0, 8)}`, 
          details: { 
            identifier: searchVal, 
            status: txData.status.confirmed ? "Confirmed & Sealed" : "Pending Verification",
            confirmations: txData.status.block_height ? "Stored in Block " + txData.status.block_height : "Mempool Cache"
          }
        };
        addNode(root); 
        setSelectedNode(root); 
        await expandNode(searchVal, 'transaction', 1, 0);
      } else if (type === SearchType.BLOCK) {
        const blockData = await blockchainService.getBlock(searchVal);
        const bHash = blockData.id || blockData.hash || searchVal;
        const root: NodeData = {
            id: bHash, type: 'block',
            label: `BLOCK: ${String(blockData.height || searchVal).substring(0, 8)}`,
            details: {
                identifier: bHash,
                height: blockData.height || "N/A",
                timestamp: blockData.timestamp ? new Date(blockData.timestamp * 1000).toLocaleString() : "N/A",
                tx_count: blockData.tx_count || "N/A",
                difficulty: blockData.difficulty || "N/A"
            }
        };
        addNode(root); 
        setSelectedNode(root); 
        await expandNode(bHash, 'block', 1, 0);
      } else {
        throw new Error("Target signature format not recognized.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeepRecursiveScan = async () => {
    if (!selectedNode || loading) return;
    setLoading(true);
    await expandNode(selectedNode.id, selectedNode.type, 2, 0);
    setLoading(false);
  };

  const generateFullPDFReport = () => {
    if (!selectedNode) return;
    const doc = new jsPDF();
    doc.setFillColor(5, 7, 12);
    doc.rect(0, 0, 210, 55, 'F');
    doc.setTextColor(16, 185, 129);
    doc.setFontSize(24);
    doc.text("SOTANIK FORENSIC DOSSIER", 105, 25, { align: "center" });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text(`TARGET IDENTIFIER: ${selectedNode.id}`, 105, 40, { align: "center" });
    doc.text(`INVESTIGATION DATE: ${new Date().toLocaleString()}`, 105, 47, { align: "center" });
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("EXECUTIVE ATTRIBUTES", 15, 75);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    let y = 85;
    Object.entries(selectedNode.details || {}).forEach(([key, val]) => {
      doc.text(`${key.replace(/_/g, ' ').toUpperCase()}:`, 15, y);
      doc.text(`${String(val)}`, 80, y);
      y += 7;
    });
    doc.save(`SOTANIK_REPORT_${selectedNode.id.substring(0, 10)}.pdf`);
  };

  const handleNodeClick = useCallback((node: NodeData) => {
    setSelectedNode(node);
  }, []);

  return (
    <div className="flex h-screen bg-[#020408] text-slate-200 overflow-hidden font-sans selection:bg-emerald-500/40">
      <aside className={`bg-[#05070c] border-r border-white/5 flex flex-col transition-all duration-500 ease-in-out z-30 shadow-[10px_0_30px_rgba(0,0,0,0.5)] ${sidebarOpen ? 'w-80' : 'w-24'}`}>
        <div className="p-10 flex items-center gap-5">
          <div className="bg-emerald-600 p-3 rounded-2xl flex items-center justify-center shrink-0 border border-emerald-400/20">
            <Shield size={28} className="text-black" />
          </div>
          {sidebarOpen && (
            <div className="flex flex-col">
              <h1 className="font-black text-2xl tracking-tight bg-gradient-to-r from-white via-slate-400 to-slate-600 bg-clip-text text-transparent italic leading-none">SOTANIK</h1>
              <span className="text-[10px] text-emerald-500 uppercase tracking-[0.5em] font-black mt-1.5 leading-none">FORENSIC HUB</span>
            </div>
          )}
        </div>
        <nav className="flex-1 px-6 mt-10 space-y-4">
          <button className="w-full flex items-center gap-5 p-4 rounded-2xl bg-emerald-600/15 text-emerald-400 border border-emerald-500/20 shadow-xl group">
            <Activity size={22} />
            {sidebarOpen && <span className="text-xs font-black uppercase tracking-widest">Active Cases</span>}
          </button>
          <button className="w-full flex items-center gap-5 p-4 rounded-2xl hover:bg-white/5 text-slate-500 transition-all group">
            <Network size={22} />
            {sidebarOpen && <span className="text-xs font-black uppercase tracking-widest">Mesh Logic</span>}
          </button>
        </nav>
        <div className="p-8 border-t border-white/5">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-4 hover:bg-white/5 rounded-2xl text-slate-600 transition-all mx-auto w-full flex items-center justify-center">
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-[#020408] relative">
        <header className="h-28 border-b border-white/5 flex items-center justify-between px-12 bg-[#05070c]/80 backdrop-blur-3xl z-20">
          <div className="flex-1 max-w-5xl flex items-center gap-6">
            <div className="relative flex-1 group">
              <Search size={22} className="absolute inset-y-0 left-6 flex items-center text-slate-600 my-auto" />
              <input 
                type="text" 
                placeholder="Submit Forensic Identifier (BTC/ETH Address, TxID, Hash)..." 
                className="w-full bg-[#0a0d14]/70 border-2 border-white/5 rounded-3xl py-5 pl-16 pr-8 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 focus:border-emerald-500/30 text-sm mono transition-all"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startInvestigation()}
              />
            </div>
            <button onClick={() => startInvestigation()} disabled={loading} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-black px-12 h-[64px] rounded-3xl text-xs font-black uppercase tracking-[0.25em] transition-all flex items-center gap-3">
              {loading ? <RefreshCw className="animate-spin" size={20} /> : <Zap size={20} />}
              {loading ? "SCANNING" : "INITIALIZE"}
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 p-10 flex flex-col gap-10 overflow-hidden relative">
            {error && (
              <div className="absolute top-12 left-12 right-12 bg-rose-500/10 border border-rose-500/20 text-rose-400 p-8 rounded-[2.5rem] flex items-center gap-8 z-30 shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-4 duration-500">
                <AlertTriangle size={36} className="text-rose-500 shrink-0" />
                <div className="flex flex-col flex-1">
                  <span className="text-[10px] uppercase font-black tracking-widest text-rose-500">Forensic Engine Warning</span>
                  <span className="text-sm font-bold mt-1">{error}</span>
                </div>
                <button onClick={() => setError(null)} className="p-4 hover:bg-white/5 rounded-xl"><X size={20} /></button>
              </div>
            )}
            <div className="flex-1 relative rounded-[3.5rem] overflow-hidden border border-white/5 bg-black/30 backdrop-blur-sm shadow-inner">
              {nodes.length > 0 ? (
                <TransactionGraph nodes={nodes} links={links} onNodeClick={handleNodeClick} selectedNodeId={selectedNode?.id} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-700">
                  <Crosshair size={80} className="text-emerald-500/20 mb-12 animate-pulse-slow" />
                  <h3 className="text-5xl font-black text-slate-300 tracking-tighter uppercase italic opacity-80 mb-6">SOTANIK CORE</h3>
                  <p className="max-w-xl text-center text-slate-500 text-sm font-medium italic">
                    Identify and resolve high-authority ledger signatures. Resolve cross-chain flows for BTC and EVM targets.
                  </p>
                  <div className="mt-12 flex gap-4">
                    <button onClick={() => startInvestigation('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')} className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-black transition-all">
                      Test BTC Address
                    </button>
                    <button onClick={() => startInvestigation('0x93be4f3b5673e35e3fb4444da25d4b6b9cdbe338dee33fa8cf4f8803afabc26a')} className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-black transition-all">
                      Test ETH Tx
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="w-[580px] bg-[#05070c]/98 backdrop-blur-3xl border-l border-white/5 flex flex-col overflow-hidden">
            <div className="p-12 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-6">
                <div className="bg-sky-500/10 p-5 rounded-[1.75rem] border border-sky-400/20 text-sky-400"><Cpu size={32} /></div>
                <h2 className="font-black text-lg tracking-[0.25em] uppercase leading-none">Evidence Dossier</h2>
              </div>
              {selectedNode && (
                <button onClick={generateFullPDFReport} className="bg-emerald-600 hover:bg-emerald-400 text-black p-5 rounded-2xl transition-all shadow-2xl active:scale-95">
                  <FileText size={24} />
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-12 space-y-14 scrollbar-hide">
              {selectedNode ? (
                <>
                  <section className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-700">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] uppercase tracking-[0.5em] text-slate-600 font-black flex items-center gap-2 leading-none">
                        <Lock size={14} className="text-amber-500" /> Resolved Identifier
                      </label>
                      <button 
                        onClick={handleDeepRecursiveScan}
                        disabled={loading}
                        className="text-[10px] font-black uppercase text-emerald-400 hover:text-white flex items-center gap-3 transition-colors disabled:opacity-50 px-4 py-2 bg-emerald-500/5 rounded-xl border border-emerald-500/20 shadow-lg"
                      >
                        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                        Deep Resolution
                      </button>
                    </div>
                    <div className="p-10 bg-[#0a0d14]/80 border border-white/10 rounded-[3rem] break-all mono text-[14px] text-sky-400 font-bold shadow-xl">
                      {selectedNode.id}
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="bg-[#0f1420] border border-white/5 rounded-[2rem] p-8 flex flex-col gap-2 shadow-xl hover:border-emerald-500/30 transition-colors">
                        <span className="text-[11px] uppercase font-black text-slate-500 tracking-widest leading-none">Security Risk</span>
                        <span className={`text-4xl font-black mt-3 ${calculateRisk(selectedNode) > 50 ? 'text-rose-500' : 'text-emerald-500'}`}>
                          {calculateRisk(selectedNode)}%
                        </span>
                      </div>
                      <div className="bg-[#0f1420] border border-white/5 rounded-[2rem] p-8 flex flex-col gap-2 shadow-xl">
                        <span className="text-[11px] uppercase font-black text-slate-500 tracking-widest leading-none">Category Profile</span>
                        <span className="text-2xl font-black text-slate-100 mt-3">{selectedNode.type.toUpperCase()}</span>
                      </div>
                    </div>
                  </section>
                  <section className="space-y-8">
                    <label className="text-[11px] uppercase tracking-[0.5em] text-slate-600 font-black leading-none flex items-center gap-3">
                      <Database size={16} className="text-emerald-500" /> Ledger Attributes
                    </label>
                    <div className="grid grid-cols-1 gap-4">
                      {Object.entries(selectedNode.details || {}).map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between p-8 bg-[#0f1420]/60 border border-white/5 rounded-[2.25rem] group hover:bg-[#111827] transition-all">
                          <span className="text-[10px] uppercase font-black text-slate-600 tracking-[0.2em]">{key.replace(/_/g, ' ')}</span>
                          <span className="text-[14px] font-black text-slate-200 group-hover:text-emerald-400 transition-colors">{String(val)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="space-y-8">
                    <label className="text-[11px] uppercase tracking-[0.5em] text-slate-600 font-black leading-none flex items-center gap-3">
                      <Globe size={16} className="text-sky-500" /> Network OSINT
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      {blockchainService.getExternalOsintLinks(selectedNode.id, selectedNode.type).map((link) => (
                        <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-6 bg-[#0f1420]/80 border border-white/5 rounded-2xl hover:border-sky-500 hover:text-sky-400 transition-all text-[11px] font-black uppercase tracking-widest text-slate-400">
                          {link.name} <ArrowUpRight size={14} />
                        </a>
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-12">
                  <Box size={84} className="text-slate-600" />
                  <p className="text-[11px] font-black uppercase tracking-[0.6em]">SELECT NODE FOR DOSSIER</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;