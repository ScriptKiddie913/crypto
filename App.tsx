import React, { useState, useCallback, useRef } from 'react';
import { 
  Search, 
  Activity, 
  X, 
  AlertTriangle, 
  RefreshCw,
  Cpu,
  Zap,
  Globe,
  Crosshair,
  FileText,
  ArrowUpRight,
  Database,
  Menu,
  Lock,
  Box,
  ChevronRight,
  Layers,
  CircleDollarSign,
  History,
  Layout,
  Fingerprint,
  TrendingUp,
  ArrowRightCircle,
  ArrowLeftCircle,
  Hash,
  Cat
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
  const [dossierOpen, setDossierOpen] = useState(true);
  
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

  const handleNodeClick = useCallback((node: NodeData) => {
    setSelectedNode(node);
  }, []);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const calculateRisk = (node: NodeData): number => {
    let score = 10;
    
    if (node.details?.clustering_label && node.details.clustering_label !== "Indeterminate") {
       const label = node.details.clustering_label.toLowerCase();
       if (label.includes('scam') || label.includes('hack') || label.includes('fraud') || label.includes('darknet')) score += 75;
       if (label.includes('mixer') || label.includes('tumbler')) score += 60;
       if (label.includes('exchange') || label.includes('binance') || label.includes('coinbase')) score -= 15;
    }

    if (node.details?.entity_tags && node.details.entity_tags !== "None detected") {
       const tags = node.details.entity_tags.toLowerCase();
       if (tags.includes('high risk') || tags.includes('sanctioned')) score += 80;
       if (tags.includes('mixer')) score += 50;
    }

    if (node.details?.balance) {
      const balanceVal = parseFloat(node.details.balance);
      if (balanceVal > 1000) score += 40;
      else if (balanceVal > 100) score += 25;
      else if (balanceVal > 10) score += 10;
    }
    
    if (node.details?.ops_count) {
      if (node.details.ops_count > 5000) score += 20;
      else if (node.details.ops_count > 1000) score += 10;
    }

    if (node.details?.privacy_score) {
      const pScore = parseInt(node.details.privacy_score);
      if (pScore < 30) score += 30;
    }

    const highValueRegistry = ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'];
    if (highValueRegistry.includes(node.id)) score = Math.max(score, 90);

    return Math.min(score, 100);
  };

  const expandNode = async (nodeId: string, type: string, maxDepth = 1, currentDepth = 0) => {
    if (currentDepth >= maxDepth) return;
    
    const isEth = nodeId.toLowerCase().startsWith('0x');
    const unit = isEth ? 'ETH' : 'BTC';

    try {
      if (type === 'address' || type === 'eth_address') {
        const txs = await blockchainService.getAddressTxs(nodeId);
        for (const tx of txs.slice(0, 8)) {
          const totalOut = (tx.vout || []).reduce((sum, v) => sum + (v.value || 0), 0);
          const amt = isEth ? (totalOut / 1e18).toFixed(4) : (totalOut / 1e8).toFixed(4);
          
          const primarySender = tx.vin?.[0]?.prevout?.scriptpubkey_address || "Mined/Unknown";
          const primaryReceiver = tx.vout?.[0]?.scriptpubkey_address || "Unknown";

          const txNode: NodeData = {
            id: tx.txid,
            type: 'transaction',
            label: `TX: ${tx.txid.substring(0, 4)} [${amt} ${unit}]`,
            details: {
              identifier: tx.txid,
              status: tx.status?.confirmed ? "Confirmed" : "Mempool",
              amount: `${amt} ${unit}`,
              sender: primarySender,
              receiver: primaryReceiver,
              output_count: tx.vout?.length || 0,
              block: tx.status?.block_height || "N/A",
              currency: unit,
              timestamp: tx.status?.block_time ? new Date(tx.status.block_time * 1000).toLocaleString() : "N/A"
            }
          };
          txNode.riskScore = calculateRisk(txNode);
          txNode.details.risk_score = `${txNode.riskScore}%`;

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
                currency: unit,
                network: isEth ? "Ethereum" : "Bitcoin",
                ...clustering
              }
            };
            outNode.riskScore = calculateRisk(outNode);
            outNode.details.risk_score = `${outNode.riskScore}%`;

            if (addNode(outNode)) {
               addLink({ source: nodeId, target: outNode.id, value: 1 });
               await expandNode(addr, outNode.type, maxDepth, currentDepth + 1);
            }
            await sleep(50);
          }
        }
      }
    } catch (err: any) {
      console.warn("Deeper resolution aborted:", err.message);
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
        const isEth = type === SearchType.ETH_ADDRESS;
        const [addrData, clustering] = await Promise.all([
            blockchainService.getAddress(searchVal),
            blockchainService.getClusteringHints(searchVal, isEth)
        ]);
        const unit = isEth ? 'ETH' : 'BTC';
        const balance = isEth 
            ? (addrData.chain_stats.funded_txo_sum / 1e18) 
            : ((addrData.chain_stats.funded_txo_sum - addrData.chain_stats.spent_txo_sum) / 1e8);
            
        const root: NodeData = { 
          id: searchVal, type, 
          label: (clustering?.clustering_label && clustering.clustering_label !== 'Indeterminate') ? clustering.clustering_label : `${searchVal.substring(0, 8)}...`, 
          details: { 
            identifier: searchVal, 
            balance: `${balance.toFixed(8)} ${unit}`,
            currency: unit,
            ops_count: addrData.chain_stats.tx_count,
            network: isEth ? "Ethereum Mainnet" : "Bitcoin Mainnet",
            ...clustering
          }
        };
        root.riskScore = calculateRisk(root);
        root.details.risk_score = `${root.riskScore}%`;

        addNode(root); 
        setSelectedNode(root); 
        await expandNode(searchVal, type, 1, 0);
      } else if (type === SearchType.TX) {
        const txData = await blockchainService.getTransaction(searchVal);
        const isEth = searchVal.startsWith('0x');
        const unit = isEth ? "ETH" : "BTC";
        const amt = isEth ? ((txData.vout?.[0]?.value || 0) / 1e18).toFixed(4) : ((txData.vout?.reduce((s,v) => s+v.value, 0) || 0) / 1e8).toFixed(4);

        const root: NodeData = { 
          id: searchVal, type: 'transaction', 
          label: `TX: ${searchVal.substring(0, 8)}`, 
          details: { 
            identifier: searchVal, 
            status: txData.status.confirmed ? "Confirmed" : "Mempool",
            transaction_amount: `${amt} ${unit}`,
            sender: txData.vin?.[0]?.prevout?.scriptpubkey_address || "Mined/Unknown",
            receiver: txData.vout?.[0]?.scriptpubkey_address || "Unknown",
            output_count: txData.vout?.length || 0,
            currency: unit,
            network: isEth ? "Ethereum" : "Bitcoin"
          }
        };
        root.riskScore = calculateRisk(root);
        root.details.risk_score = `${root.riskScore}%`;

        addNode(root); 
        setSelectedNode(root); 
        await expandNode(searchVal, 'transaction', 1, 0);
      } else {
        throw new Error("Forensic engine cannot resolve identifier format.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeepResolution = async () => {
    if (!selectedNode || loading) return;
    setLoading(true);
    await expandNode(selectedNode.id, selectedNode.type, 2, 0);
    setLoading(false);
  };

  const generateReport = () => {
    if (nodes.length === 0) return;
    const doc = new jsPDF();
    const timestamp = new Date().toLocaleString();
    const caseId = `SOT-${Math.floor(Date.now() / 1000)}`;

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 80, 'F');
    doc.setTextColor(16, 185, 129);
    doc.setFontSize(30);
    doc.setFont("helvetica", "bold");
    doc.text("SOTANIK FORENSIC CASE", 105, 30, { align: "center" });
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`REFERENCE ID: ${caseId}`, 20, 50);
    doc.text(`GENERATION DATETIME: ${timestamp}`, 20, 58);
    doc.text(`NETWORK TOPOOLOGY: ${nodes.length} NODES / ${links.length} EDGES`, 20, 66);

    let y = 95;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("1. FORENSIC ENTITY AUDIT", 20, y);
    y += 15;

    nodes.forEach((node, i) => {
      if (y > 230) { doc.addPage(); y = 25; }
      
      doc.setFillColor(248, 250, 252);
      doc.rect(15, y - 5, 180, 105, 'F');
      
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`ENTITY #${i + 1}: ${node.type.toUpperCase()}`, 20, y);
      y += 6;
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`IDENTIFIER: ${node.id}`, 20, y);
      y += 10;

      const risk = calculateRisk(node);
      const riskLevel = risk > 75 ? 'CRITICAL' : risk > 45 ? 'ELEVATED' : 'NOMINAL';
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(risk > 75 ? 180 : risk > 45 ? 200 : 16, risk > 45 ? 40 : 185, risk > 75 ? 40 : 129);
      doc.text(`RISK SCORE ASSESSMENT: ${risk}% [${riskLevel}]`, 20, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      const details = Object.entries(node.details || {}).slice(0, 12);
      details.forEach(([k, v]) => {
        if (k === 'risk_score') return;
        doc.text(`${k.toUpperCase().replace(/_/g, ' ')}: ${v}`, 25, y);
        y += 4.5;
      });
      y += 6;

      const osintLinks = blockchainService.getExternalOsintLinks(node.id, node.type);
      if (osintLinks.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text("VERIFIED OSINT REPOSITORIES:", 25, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(2, 132, 199);
        osintLinks.forEach(link => {
          doc.text(`>> ${link.name}: ${link.url}`, 30, y);
          y += 4;
        });
      }
      y += 15;
    });

    if (links.length > 0) {
        doc.addPage();
        y = 25;
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 0, 0);
        doc.text("2. NETWORK FLOW LOGS & AMOUNTS", 20, y);
        y += 15;
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        
        links.forEach((link, i) => {
           if (y > 270) { doc.addPage(); y = 20; }
           const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
           const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
           
           const targetNode = nodes.find(n => n.id === targetId);
           const amount = targetNode?.details?.amount || targetNode?.details?.inflow_amount || targetNode?.details?.transaction_amount || "N/A";

           doc.setTextColor(30, 41, 59);
           doc.text(`FLOW #${i+1}: SOURCE [${String(sourceId).substring(0,18)}...]`, 20, y);
           y += 5;
           doc.setTextColor(100, 116, 139);
           doc.text(`        == TRANSFER TO ==> [${String(targetId).substring(0,18)}...]`, 20, y);
           doc.setFont("helvetica", "bold");
           doc.setTextColor(16, 185, 129);
           doc.text(` [TX VALUE: ${amount}]`, 140, y);
           doc.setFont("helvetica", "normal");
           y += 10;
        });
    }

    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text("SOTANIK CRYPTO HUB - PROPRIETARY FORENSIC ANALYSIS - DO NOT DISCLOSE", 105, 285, { align: "center" });
        doc.text(`PAGE ${i} OF ${pageCount}`, 200, 285, { align: "right" });
    }

    doc.save(`SOTANIK_FORENSIC_CASE_${caseId}.pdf`);
  };

  return (
    <div className="flex h-screen bg-[#020408] text-slate-200 overflow-hidden font-sans selection:bg-emerald-500/40">
      <aside className={`bg-[#05070c] border-r border-white/5 flex flex-col transition-all duration-500 z-30 shadow-2xl ${sidebarOpen ? 'w-80' : 'w-24'}`}>
        <div className="p-10 flex items-center gap-5">
          <div className="bg-sky-500/5 p-3 rounded-2xl flex items-center justify-center shrink-0 border border-sky-400/20 shadow-lg shadow-sky-500/10 active:scale-95 transition-transform">
            <Cat size={28} className="text-sky-400" />
          </div>
          {sidebarOpen && (
            <div className="flex flex-col">
              <h1 className="font-black text-2xl tracking-tight text-white leading-none">SOTANIK</h1>
              <span className="text-[10px] text-emerald-500 uppercase tracking-[0.4em] font-black mt-1.5 leading-none">CRYPTO HUB</span>
            </div>
          )}
        </div>
        <nav className="flex-1 px-6 mt-10 space-y-4">
          <button className="w-full flex items-center gap-5 p-4 rounded-2xl bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 group">
            <Layout size={22} className="group-hover:scale-110 transition-transform" />
            {sidebarOpen && <span className="text-xs font-black uppercase tracking-widest">Workspace</span>}
          </button>
        </nav>
        <div className="p-8 border-t border-white/5">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-4 hover:bg-white/5 rounded-2xl text-slate-600 transition-all mx-auto w-full flex items-center justify-center">
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-[#020408] relative">
        <header className="h-28 border-b border-white/5 flex items-center justify-between px-12 bg-[#05070c]/90 backdrop-blur-3xl z-20">
          <div className="flex-1 max-w-4xl flex items-center gap-6">
            <div className="relative flex-1 group">
              <Search size={22} className="absolute inset-y-0 left-6 flex items-center text-slate-600 my-auto" />
              <input 
                type="text" 
                placeholder="Trace BTC/ETH Address, Tx Hash..." 
                className="w-full bg-[#0a0d14]/70 border-2 border-white/5 rounded-3xl py-5 pl-16 pr-8 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 focus:border-emerald-500/30 text-sm mono transition-all"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startInvestigation()}
              />
            </div>
            <button onClick={() => startInvestigation()} disabled={loading} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-black px-12 h-[64px] rounded-3xl text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center gap-3 shadow-emerald-500/20 shadow-lg">
              {loading ? <RefreshCw className="animate-spin" size={20} /> : <Zap size={20} />}
              {loading ? "SEARCHING" : "INITIALIZE"}
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 p-10 flex flex-col gap-10 overflow-hidden relative">
            {error && (
              <div className="absolute top-12 left-12 right-12 bg-rose-500/10 border border-rose-500/20 text-rose-400 p-8 rounded-[2.5rem] flex items-center gap-8 z-30 shadow-2xl backdrop-blur-xl animate-in zoom-in duration-300">
                <AlertTriangle size={36} className="text-rose-500 shrink-0" />
                <div className="flex flex-col flex-1">
                  <span className="text-[10px] uppercase font-black tracking-widest text-rose-500">Forensic Engine Fault</span>
                  <span className="text-sm font-bold mt-1">{error}</span>
                </div>
                <button onClick={() => setError(null)} className="p-4 hover:bg-white/5 rounded-xl"><X size={20} /></button>
              </div>
            )}
            <div className="flex-1 relative rounded-[3.5rem] overflow-hidden border border-white/5 bg-black/20 backdrop-blur-sm shadow-inner group">
              {nodes.length > 0 ? (
                <TransactionGraph nodes={nodes} links={links} onNodeClick={handleNodeClick} selectedNodeId={selectedNode?.id} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-700">
                  <Box size={80} className="text-emerald-500/20 mb-12 animate-pulse-slow" />
                  <h3 className="text-5xl font-black text-slate-300 tracking-tighter uppercase italic opacity-80 mb-6">SoTaNik_AI</h3>
                  <p className="max-w-xl text-center text-slate-500 text-sm font-medium italic px-6 leading-relaxed">
                    Map cross-chain ledger flows with forensic accuracy. Reconstruct network topologies from decentralized traces.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className={`bg-[#05070c]/98 backdrop-blur-3xl border-l border-white/5 flex flex-col transition-all duration-500 relative ${dossierOpen ? 'w-[580px]' : 'w-0'}`}>
            <button 
              onClick={() => setDossierOpen(!dossierOpen)} 
              className={`absolute top-1/2 -left-12 -translate-y-1/2 bg-[#05070c] border border-white/5 p-4 rounded-full shadow-2xl text-slate-500 hover:text-emerald-500 transition-colors z-40 ${!dossierOpen ? 'rotate-180' : ''}`}
            >
              <ChevronRight size={20} />
            </button>
            
            {dossierOpen && (
              <div className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-right-10 duration-500 scrollbar-hide">
                <div className="p-12 border-b border-white/5 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-6">
                    <div className="bg-sky-500/10 p-5 rounded-[1.75rem] border border-sky-400/20 text-sky-400 shadow-lg"><Cpu size={32} /></div>
                    <h2 className="font-black text-lg tracking-[0.25em] uppercase leading-none">Evidence Dossier</h2>
                  </div>
                  {nodes.length > 0 && (
                    <button onClick={generateReport} title="Export Detailed Analysis" className="bg-emerald-600 hover:bg-emerald-400 text-black p-5 rounded-2xl transition-all shadow-xl active:scale-95">
                      <FileText size={24} />
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-12 space-y-14 scrollbar-hide pb-24">
                  {selectedNode ? (
                    <>
                      <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] uppercase tracking-[0.5em] text-slate-600 font-black flex items-center gap-2 leading-none">
                            <Lock size={14} className="text-amber-500" /> Resolved Identifier
                          </label>
                          <button 
                            onClick={handleDeepResolution}
                            disabled={loading}
                            className="text-[10px] font-black uppercase text-emerald-400 flex items-center gap-3 disabled:opacity-50 px-4 py-2 bg-emerald-500/5 rounded-xl border border-emerald-500/20 hover:bg-emerald-500/10 transition-colors"
                          >
                            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                            Recursive Trace
                          </button>
                        </div>
                        <div className="p-10 bg-[#0a0d14]/80 border border-white/10 rounded-[3rem] break-all mono text-[14px] text-sky-400 font-bold shadow-2xl">
                          {selectedNode.id}
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                          <div className="bg-[#0f1420] border border-white/5 rounded-[2rem] p-8 flex flex-col gap-2 hover:bg-[#111827] transition-colors shadow-lg group">
                            <div className="flex items-center gap-3 text-[11px] uppercase font-black text-slate-500 tracking-widest leading-none">
                              <AlertTriangle size={14} className="text-rose-500" /> Security Risk
                            </div>
                            <span className="text-4xl font-black text-emerald-500 mt-3 tracking-tighter">{selectedNode.riskScore || calculateRisk(selectedNode)}%</span>
                          </div>
                          <div className="bg-[#0f1420] border border-white/5 rounded-[2rem] p-8 flex flex-col gap-2 shadow-lg hover:bg-[#111827] transition-colors">
                            <div className="flex items-center gap-3 text-[11px] uppercase font-black text-slate-500 tracking-widest leading-none">
                              <Layers size={14} className="text-sky-500" /> Node Profile
                            </div>
                            <span className="text-2xl font-black text-slate-100 mt-3 leading-tight">{selectedNode.type.toUpperCase()}</span>
                          </div>
                        </div>
                      </section>

                      {selectedNode.type === 'transaction' && (
                        <section className="space-y-8 animate-in slide-in-from-bottom-5 duration-600">
                           <label className="text-[11px] uppercase tracking-[0.5em] text-emerald-500 font-black leading-none flex items-center gap-3">
                            <Activity size={16} /> Transaction Flow Analysis
                          </label>
                          <div className="bg-black/40 border border-white/5 rounded-[2.5rem] p-10 space-y-10 shadow-2xl">
                             <div className="flex items-center justify-between group">
                                <div className="flex flex-col gap-3">
                                   <span className="text-[10px] uppercase font-black text-slate-600 tracking-widest flex items-center gap-2">
                                      <ArrowRightCircle size={14} className="text-sky-500" /> Originating Sender
                                   </span>
                                   <span className="text-sm font-black text-slate-200 break-all mono group-hover:text-emerald-400 transition-colors cursor-pointer" onClick={() => startInvestigation(selectedNode.details.sender)}>
                                      {selectedNode.details.sender}
                                   </span>
                                </div>
                             </div>

                             <div className="flex items-center justify-center relative py-4">
                                <div className="absolute h-px w-full bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent"></div>
                                <div className="bg-[#0a0d14] border border-emerald-500/30 px-6 py-3 rounded-full z-10 flex flex-col items-center">
                                   <span className="text-[10px] font-black text-emerald-500 uppercase tracking-tighter">Value Transferred</span>
                                   <span className="text-lg font-black text-emerald-400">{selectedNode.details.amount || selectedNode.details.transaction_amount}</span>
                                </div>
                             </div>

                             <div className="flex items-center justify-between group">
                                <div className="flex flex-col gap-3">
                                   <span className="text-[10px] uppercase font-black text-slate-600 tracking-widest flex items-center gap-2">
                                      <ArrowLeftCircle size={14} className="text-amber-500" /> Primary Recipient
                                   </span>
                                   <span className="text-sm font-black text-slate-200 break-all mono group-hover:text-emerald-400 transition-colors cursor-pointer" onClick={() => startInvestigation(selectedNode.details.receiver)}>
                                      {selectedNode.details.receiver}
                                   </span>
                                </div>
                             </div>

                             <div className="flex items-center justify-between border-t border-white/5 pt-8">
                                <div className="flex flex-col gap-1">
                                   <span className="text-[10px] font-black text-slate-600 uppercase">Confirmations</span>
                                   <span className="text-xs font-bold text-slate-400">{selectedNode.details.status}</span>
                                </div>
                                <div className="flex flex-col gap-1 text-right">
                                   <span className="text-[10px] font-black text-slate-600 uppercase">Outputs</span>
                                   <span className="text-xs font-bold text-slate-400">{selectedNode.details.output_count} Addresses</span>
                                </div>
                             </div>
                          </div>
                        </section>
                      )}

                      {selectedNode.details?.clustering_label && selectedNode.details.clustering_label !== 'Indeterminate' && (
                        <section className="space-y-8 animate-in slide-in-from-bottom-5 duration-600">
                           <label className="text-[11px] uppercase tracking-[0.5em] text-amber-500 font-black leading-none flex items-center gap-3">
                            <Fingerprint size={16} /> Entity Intelligence
                          </label>
                          <div className="bg-amber-500/5 border border-amber-500/20 rounded-[2.5rem] p-10 space-y-4 shadow-inner">
                             <div className="flex items-center justify-between">
                                <span className="text-[10px] uppercase font-black text-amber-600/80 tracking-widest">Attributed Label</span>
                                <span className="text-sm font-black text-amber-500 uppercase">{selectedNode.details.clustering_label}</span>
                             </div>
                             {selectedNode.details.entity_tags && selectedNode.details.entity_tags !== 'None detected' && (
                                <div className="flex flex-col gap-3 border-t border-amber-500/10 pt-4 mt-2">
                                  <span className="text-[10px] uppercase font-black text-amber-600/80 tracking-widest">Forensic Tags</span>
                                  <div className="flex flex-wrap gap-2">
                                     {selectedNode.details.entity_tags.split(',').map((tag: string) => (
                                       <span key={tag} className="text-[10px] px-3 py-1 bg-amber-500/10 text-amber-400 rounded-lg border border-amber-500/20 font-black uppercase tracking-tighter">{tag.trim()}</span>
                                     ))}
                                  </div>
                                </div>
                             )}
                          </div>
                        </section>
                      )}

                      <section className="space-y-8 animate-in slide-in-from-bottom-6 duration-700">
                        <label className="text-[11px] uppercase tracking-[0.5em] text-slate-600 font-black leading-none flex items-center gap-3">
                          <Database size={16} className="text-emerald-500" /> Forensic Attributes
                        </label>
                        <div className="grid grid-cols-1 gap-4">
                          {Object.entries(selectedNode.details || {}).map(([key, val]) => {
                            if (['clustering_label', 'entity_tags', 'risk_score', 'sender', 'receiver', 'amount', 'transaction_amount'].includes(key)) return null;
                            return (
                              <div key={key} className="flex items-center justify-between p-8 bg-[#0f1420]/60 border border-white/5 rounded-[2.25rem] group hover:bg-[#111827] transition-all shadow-md">
                                <div className="flex items-center gap-3 text-[10px] uppercase font-black text-slate-600 tracking-[0.2em]">
                                   {key.includes('amount') || key.includes('balance') || key.includes('volume') ? <TrendingUp size={12} className="text-emerald-500" /> : null}
                                   {key.replace(/_/g, ' ')}
                                </div>
                                <span className={`text-[13px] font-black transition-colors ${key.includes('amount') || key.includes('balance') ? 'text-emerald-400' : 'text-slate-200'} group-hover:text-emerald-400`}>
                                  {String(val)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                      <section className="space-y-8 animate-in slide-in-from-bottom-8 duration-900">
                        <label className="text-[11px] uppercase tracking-[0.5em] text-slate-600 font-black leading-none flex items-center gap-3">
                          <Globe size={16} className="text-sky-500" /> Network OSINT
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                          {blockchainService.getExternalOsintLinks(selectedNode.id, selectedNode.type).map((link) => (
                            <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-6 bg-[#0f1420]/80 border border-white/5 rounded-2xl hover:border-sky-500 hover:text-sky-400 transition-all text-[11px] font-black uppercase tracking-widest text-slate-400 shadow-lg">
                              {link.name} <ArrowUpRight size={14} />
                            </a>
                          ))}
                        </div>
                      </section>
                    </>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-12">
                      <Box size={84} className="text-slate-600" />
                      <p className="text-[11px] font-black uppercase tracking-[0.6em] text-slate-500">SELECT NODE TO POPULATE DOSSIER</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;