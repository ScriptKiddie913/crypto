import React, { useState, useCallback, useRef } from 'react';
import { 
  Search, 
  X, 
  AlertTriangle, 
  RefreshCw,
  Cpu,
  Zap,
  FileText,
  Box,
  Trash2,
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
  const [deepLoading, setDeepLoading] = useState(false);
  
  const seenNodes = useRef<Set<string>>(new Set());
  const seenLinks = useRef<Set<string>>(new Set());
  const expandedNodes = useRef<Set<string>>(new Set());

  const addNode = useCallback((node: NodeData) => {
    if (seenNodes.current.has(node.id)) {
      setNodes(prev => prev.map(n => n.id === node.id ? { ...n, ...node, isRoot: n.isRoot || node.isRoot } : n));
      return false;
    }
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

  const deleteNode = useCallback((nodeId: string) => {
    // Remove from active state
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setLinks(prev => prev.filter(l => l.source !== nodeId && l.target !== nodeId));
    
    // Clear from tracking refs to allow re-addition/clean logic
    seenNodes.current.delete(nodeId);
    
    // Clear links from tracking refs
    const linksToRemove = Array.from(seenLinks.current).filter(id => id.includes(nodeId));
    linksToRemove.forEach(id => seenLinks.current.delete(id));
    
    // Clear expansion history for this node
    const expansionsToRemove = Array.from(expandedNodes.current).filter(key => key.startsWith(nodeId));
    expansionsToRemove.forEach(key => expandedNodes.current.delete(key));

    if (selectedNode?.id === nodeId) {
      setSelectedNode(null);
    }
  }, [selectedNode]);

  const resetGraph = () => {
    setNodes([]);
    setLinks([]);
    seenNodes.current.clear();
    seenLinks.current.clear();
    expandedNodes.current.clear();
    setSelectedNode(null);
    setError(null);
  };

  const handleNodeClick = useCallback((node: NodeData) => {
    setSelectedNode(node);
  }, []);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const calculateRisk = (node: NodeData): number => {
    const charSum = node.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    let score = 5 + (charSum % 15); 

    const details = node.details || {};
    
    if (details.clustering_label && details.clustering_label !== "Indeterminate") {
       const label = details.clustering_label.toLowerCase();
       if (label.includes('scam') || label.includes('hack') || label.includes('phish') || label.includes('fraud') || label.includes('ponzi')) score += 65;
       if (label.includes('mixer') || label.includes('tumbler') || label.includes('tornado') || label.includes('wasabi')) score += 55;
       if (label.includes('darknet') || label.includes('marketplace') || label.includes('ransomware') || label.includes('hydra')) score += 70;
       if (label.includes('gambling') || label.includes('casino')) score += 25;
       
       if (label.includes('exchange') || label.includes('binance') || label.includes('coinbase') || label.includes('kraken')) score -= 30;
       if (label.includes('pool') || label.includes('f2pool')) score -= 10;
    }

    if (details.privacy_score) {
      const pScore = parseInt(details.privacy_score);
      if (!isNaN(pScore)) {
        if (pScore > 80) score += 25;
        else if (pScore > 50) score += 10;
      }
    }

    if (details.tx_velocity) {
      const vel = parseFloat(details.tx_velocity);
      if (vel > 100) score += 20;
      else if (vel > 20) score += 5;
    }

    if (details.balance) {
      const b = parseFloat(details.balance);
      if (b > 100) score += 10;
      if (b > 1000) score += 20;
    }

    score += (charSum % 4);
    return Math.min(Math.max(Math.round(score), 1), 99);
  };

  const expandNode = async (nodeId: string, type: string, maxDepth = 1, currentDepth = 0, force = false) => {
    if (currentDepth >= maxDepth) return;
    
    const expansionKey = `${nodeId}-d${currentDepth}`;
    if (!force && expandedNodes.current.has(expansionKey)) return;
    expandedNodes.current.add(expansionKey);

    const isEth = nodeId.toLowerCase().startsWith('0x');
    const unit = isEth ? 'ETH' : 'BTC';

    try {
      if (type === 'address' || type === 'eth_address') {
        const txs = await blockchainService.getAddressTxs(nodeId);
        if (!txs || txs.length === 0) return;

        const branchLimit = force ? 40 : (currentDepth === 0 ? 30 : 10);
        
        for (const tx of txs.slice(0, branchLimit)) {
          // Double check if the parent node still exists before expanding
          if (!seenNodes.current.has(nodeId)) break;

          const totalOut = (tx.vout || []).reduce((sum, v) => sum + (v.value || 0), 0);
          const amt = isEth ? (totalOut / 1e18).toFixed(4) : (totalOut / 1e8).toFixed(4);
          
          const txNode: NodeData = {
            id: tx.txid,
            type: 'transaction',
            label: `TX: ${tx.txid.substring(0, 4)}`,
            details: {
              identifier: tx.txid,
              status: tx.status?.confirmed ? "Confirmed" : "Mempool",
              amount: `${amt} ${unit}`,
              sender: tx.vin?.[0]?.prevout?.scriptpubkey_address || "Mined/Unknown",
              receiver: tx.vout?.[0]?.scriptpubkey_address || "Unknown",
              output_count: tx.vout?.length || 0,
              block: tx.status?.block_height || "N/A",
              currency: unit,
              timestamp: tx.status?.block_time ? new Date(tx.status.block_time * 1000).toLocaleString() : "N/A"
            }
          };
          txNode.riskScore = calculateRisk(txNode);
          
          addNode(txNode);
          addLink({ source: nodeId, target: txNode.id, value: 2 });
          
          if (currentDepth + 1 < maxDepth) {
            await expandNode(txNode.id, 'transaction', maxDepth, currentDepth + 1, force);
          }
          await sleep(10);
        }
      } else if (type === 'transaction') {
        const txData = await blockchainService.getTransaction(nodeId);
        if (!txData || !txData.vout) return;

        const outputs = txData.vout.slice(0, force ? 30 : 15);
        for (const output of outputs) {
          if (!seenNodes.current.has(nodeId)) break;

          const addr = output.scriptpubkey_address;
          if (addr && addr !== nodeId) {
            const outAmt = isEth ? (output.value / 1e18).toFixed(6) : (output.value / 1e8).toFixed(6);
            const clustering = await blockchainService.getClusteringHints(addr, isEth);

            const outNode: NodeData = {
              id: addr,
              type: addr.toLowerCase().startsWith('0x') ? 'eth_address' : 'address',
              label: (clustering?.clustering_label && clustering.clustering_label !== 'Indeterminate') ? clustering.clustering_label : `${addr.substring(0, 8)}...`,
              details: { 
                identifier: addr, 
                inflow_amount: `${outAmt} ${unit}`,
                balance: `${outAmt} ${unit}`,
                currency: unit,
                network: isEth ? "Ethereum" : "Bitcoin",
                ...clustering
              }
            };
            outNode.riskScore = calculateRisk(outNode);

            addNode(outNode);
            addLink({ source: nodeId, target: outNode.id, value: 1 });
            
            if (currentDepth + 1 < maxDepth) {
              await expandNode(addr, outNode.type, maxDepth, currentDepth + 1, force);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn("Forensic branch error:", err.message);
    }
  };

  const startInvestigation = async (overrideQuery?: string) => {
    const searchVal = (overrideQuery || query).trim();
    if (!searchVal || loading) return;

    setLoading(true);
    resetGraph();

    try {
      const type = blockchainService.detectSearchType(searchVal);
      if (type === SearchType.UNKNOWN) {
        throw new Error("Invalid cryptographic identifier format.");
      }

      const initialNode: NodeData = {
        id: searchVal,
        type: type === SearchType.ETH_ADDRESS ? 'eth_address' : type === SearchType.TX ? 'transaction' : 'address',
        label: `${searchVal.substring(0, 8)}...`,
        details: { identifier: searchVal, status: "Investigating..." },
        isRoot: true 
      };
      addNode(initialNode);
      setSelectedNode(initialNode);

      if (type === SearchType.ADDRESS || type === SearchType.ETH_ADDRESS) {
        const isEth = type === SearchType.ETH_ADDRESS;
        const [addrData, clustering] = await Promise.all([
            blockchainService.getAddress(searchVal).catch(() => ({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } })),
            blockchainService.getClusteringHints(searchVal, isEth).catch(() => null)
        ]);
        
        const unit = isEth ? 'ETH' : 'BTC';
        const balance = isEth 
            ? (addrData.chain_stats.funded_txo_sum / 1e18) 
            : ((addrData.chain_stats.funded_txo_sum - addrData.chain_stats.spent_txo_sum) / 1e8);
            
        const root: NodeData = { 
          id: searchVal, 
          type: isEth ? 'eth_address' : 'address', 
          label: (clustering?.clustering_label && clustering.clustering_label !== 'Indeterminate') ? clustering.clustering_label : `${searchVal.substring(0, 8)}...`, 
          details: { 
            identifier: searchVal, 
            balance: `${balance.toFixed(8)} ${unit}`,
            currency: unit,
            ops_count: addrData.chain_stats.tx_count,
            network: isEth ? "Ethereum Mainnet" : "Bitcoin Mainnet",
            ...clustering
          },
          isRoot: true
        };
        root.riskScore = calculateRisk(root);

        addNode(root);
        setSelectedNode(root);
        await expandNode(searchVal, root.type, 1, 0);
      } else if (type === SearchType.TX) {
        const txData = await blockchainService.getTransaction(searchVal);
        const isEth = searchVal.startsWith('0x');
        const unit = isEth ? "ETH" : "BTC";
        const amt = isEth ? ((txData.vout?.[0]?.value || 0) / 1e18).toFixed(4) : ((txData.vout?.reduce((s,v) => s+v.value, 0) || 0) / 1e8).toFixed(4);

        const root: NodeData = { 
          id: searchVal, 
          type: 'transaction', 
          label: `TX: ${searchVal.substring(0, 8)}`, 
          details: { 
            identifier: searchVal, 
            status: txData.status.confirmed ? "Confirmed" : "Mempool",
            amount: `${amt} ${unit}`,
            sender: txData.vin?.[0]?.prevout?.scriptpubkey_address || "Mined/Unknown",
            receiver: txData.vout?.[0]?.scriptpubkey_address || "Unknown",
            output_count: txData.vout?.length || 0,
            currency: unit,
            network: isEth ? "Ethereum" : "Bitcoin"
          },
          isRoot: true
        };
        root.riskScore = calculateRisk(root);

        addNode(root);
        setSelectedNode(root); 
        await expandNode(searchVal, 'transaction', 1, 0);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeepResolution = async () => {
    if (!selectedNode || loading || deepLoading) return;
    setDeepLoading(true);
    await expandNode(selectedNode.id, selectedNode.type, 2, 0, true);
    setDeepLoading(false);
  };

  const generateReport = () => {
    // Only includes currently visible nodes
    if (nodes.length === 0) return;
    const doc = new jsPDF();
    const caseId = `SOT-${Math.floor(Date.now() / 1000)}`;
    const timestamp = new Date().toLocaleString();
    
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 50, 'F');
    doc.setTextColor(16, 185, 129);
    doc.setFontSize(28);
    doc.setFont("helvetica", "bold");
    doc.text("SOTANIK FORENSIC CASE", 105, 25, { align: "center" });
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`REFERENCE ID: ${caseId}`, 15, 38);
    doc.text(`GENERATION DATE/TIME: ${timestamp}`, 15, 43);
    doc.text(`NETWORK TOPOLOGY: ${nodes.length} NODES`, 15, 48);
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("1. AUDIT SUMMARY", 15, 65);
    
    let y = 80;
    const items = [...nodes].sort((a,b) => (a.isRoot ? -1 : 1));
    items.forEach((node, index) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(`${index + 1}. [${node.type.toUpperCase()}] ${node.id}`, 15, y);
      y += 6;
      doc.setFontSize(9);
      doc.text(`RISK: ${node.riskScore || calculateRisk(node)}%`, 20, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      Object.entries(node.details || {}).forEach(([k, v]) => {
        if (typeof v !== 'object') {
          if (y > 280) { doc.addPage(); y = 20; }
          doc.text(`${k}: ${v}`, 25, y);
          y += 4;
        }
      });
      y += 10;
    });
    doc.save(`SoTaNik_AI_Forensic_Case_${caseId}.pdf`);
  };

  return (
    <div className="flex h-screen bg-[#020408] text-slate-200 overflow-hidden font-sans">
      <main className="flex-1 flex flex-col min-w-0 bg-[#020408] relative">
        <header className="h-28 border-b border-white/5 flex items-center justify-between px-12 bg-[#05070c]/90 backdrop-blur-3xl z-20">
          <div className="flex items-center gap-10">
            <div className="flex items-center gap-5">
              <div className="bg-sky-500/5 p-2 rounded-2xl flex items-center justify-center border border-sky-400/20 shadow-lg shadow-sky-500/10">
                <svg viewBox="0 0 400 400" className="w-10 h-10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M50 80 L130 50 L160 150 L50 80 Z" stroke="#38BDF8" strokeWidth="16" strokeLinejoin="round"/>
                  <path d="M350 80 L270 50 L240 150 L350 80 Z" stroke="#38BDF8" strokeWidth="16" strokeLinejoin="round"/>
                  <path d="M80 160 C80 160 100 320 200 320 C300 320 320 160 320 160" stroke="#38BDF8" strokeWidth="16" strokeLinecap="round"/>
                  <path d="M140 210 L180 210 L160 245 Z" fill="#38BDF8"/>
                  <path d="M260 210 L220 210 L240 245 Z" fill="#38BDF8"/>
                </svg>
              </div>
              <div className="flex flex-col">
                <h1 className="font-black text-2xl tracking-tight text-white leading-none uppercase">Sotanik_AI</h1>
                <span className="text-[10px] text-emerald-500 uppercase tracking-[0.4em] font-black mt-1.5 leading-none">Workspace</span>
              </div>
            </div>
          </div>

          <div className="flex-1 max-w-2xl mx-12 flex items-center gap-6">
            <div className="relative flex-1 group">
              <Search size={20} className="absolute inset-y-0 left-6 flex items-center text-slate-600 my-auto" />
              <input 
                type="text" 
                placeholder="Submit Bitcoin Hash, Wallet ID, or ETH Address..." 
                className="w-full bg-[#0a0d14]/70 border-2 border-white/5 rounded-3xl py-4 pl-16 pr-8 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 focus:border-emerald-500/30 text-sm mono transition-all"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startInvestigation()}
              />
            </div>
            <button onClick={() => startInvestigation()} disabled={loading} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-black px-10 h-14 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-3 shadow-emerald-500/20 shadow-lg">
              {loading ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} />}
              {loading ? "SEARCHING" : "INITIALIZE"}
            </button>
          </div>

          <div className="flex items-center gap-4">
            {selectedNode && (
               <button 
                  onClick={handleDeepResolution}
                  disabled={loading || deepLoading}
                  className="bg-sky-600/10 border border-sky-500/30 text-sky-400 px-6 h-14 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-sky-500/20 transition-all flex items-center gap-3"
                >
                  <RefreshCw size={16} className={deepLoading ? 'animate-spin' : ''} />
                  DEEP TRACE
                </button>
            )}
            {nodes.length > 0 && (
              <button onClick={generateReport} className="bg-white/5 border border-white/10 text-white px-6 h-14 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-3">
                <FileText size={16} />
                EXPORT CASE
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-0 z-0">
             {nodes.length > 0 ? (
                <TransactionGraph nodes={nodes} links={links} onNodeClick={handleNodeClick} selectedNodeId={selectedNode?.id} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-700">
                  <Box size={80} className="text-emerald-500/20 mb-12 animate-pulse-slow" />
                  <h3 className="text-5xl font-black text-slate-300 tracking-tighter uppercase italic opacity-80 mb-6">SoTaNik_AI</h3>
                  <p className="max-w-xl text-center text-slate-500 text-sm font-medium italic px-6 leading-relaxed">
                    Input a blockchain identifier to commence forensic trace resolution in the workspace.
                  </p>
                </div>
              )}
          </div>

          {error && (
            <div className="absolute top-8 left-8 right-8 bg-rose-500/10 border border-rose-500/20 text-rose-400 p-6 rounded-3xl flex items-center gap-6 z-30 shadow-2xl backdrop-blur-xl animate-in zoom-in duration-300">
              <AlertTriangle size={28} className="text-rose-500 shrink-0" />
              <div className="flex flex-col flex-1">
                <span className="text-[9px] uppercase font-black tracking-widest text-rose-500">Forensic Fault</span>
                <span className="text-sm font-bold mt-0.5">{error}</span>
              </div>
              <button onClick={() => setError(null)} className="p-3 hover:bg-white/5 rounded-xl"><X size={18} /></button>
            </div>
          )}

          {selectedNode && (
            <div className="absolute top-8 right-8 w-96 bg-[#05070c]/95 backdrop-blur-3xl border border-white/5 rounded-[2.5rem] p-8 shadow-2xl animate-in fade-in slide-in-from-right-4 z-10 max-h-[80vh] overflow-y-auto scrollbar-hide">
              <div className="flex items-center justify-between mb-8 pb-6 border-b border-white/5">
                <div className="flex items-center gap-4">
                  <div className="bg-sky-500/10 p-3 rounded-xl border border-sky-400/20 text-sky-400"><Cpu size={20} /></div>
                  <h2 className="font-black text-xs tracking-widest uppercase text-white">METADATA</h2>
                </div>
                <button onClick={() => setSelectedNode(null)} className="text-slate-500 hover:text-white"><X size={18} /></button>
              </div>

              <div className="space-y-8">
                <div className="p-6 bg-[#0a0d14] border border-white/5 rounded-2xl break-all mono text-[12px] text-sky-400 font-bold">
                  {selectedNode.id}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className={`rounded-2xl p-5 flex flex-col gap-1 border ${selectedNode.riskScore && selectedNode.riskScore > 50 ? 'bg-rose-500/10 border-rose-500/20' : 'bg-emerald-500/5 border-emerald-500/10'}`}>
                    <span className="text-[9px] uppercase font-black text-slate-500 tracking-widest">Risk Index</span>
                    <span className={`text-2xl font-black ${selectedNode.riskScore && selectedNode.riskScore > 50 ? 'text-rose-500' : 'text-emerald-500'}`}>{selectedNode.riskScore || calculateRisk(selectedNode)}%</span>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-1">
                    <span className="text-[9px] uppercase font-black text-slate-500 tracking-widest">Type</span>
                    <span className="text-xs font-black text-slate-100 uppercase truncate">{selectedNode.type}</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[9px] uppercase tracking-widest text-slate-600 font-black">Forensic Signals</label>
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(selectedNode.details || {}).map(([key, val]) => {
                      if (['identifier', 'status'].includes(key)) return null;
                      return (
                        <div key={key} className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-xl group hover:bg-white/10 transition-all">
                          <div className="text-[9px] uppercase font-black text-slate-500 tracking-widest truncate max-w-[120px]">
                             {key.replace(/_/g, ' ')}
                          </div>
                          <span className="text-[11px] font-bold text-slate-300 truncate ml-4">
                            {String(val)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Workspace Operations: Delete Button */}
                <div className="pt-8 border-t border-white/5">
                   <button 
                    onClick={() => deleteNode(selectedNode.id)}
                    className="w-full h-14 bg-rose-500/10 border border-rose-500/30 text-rose-500 rounded-2xl flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-rose-500/20 transition-all"
                   >
                     <Trash2 size={16} />
                     Delete from Workspace
                   </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;