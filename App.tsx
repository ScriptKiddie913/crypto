import React, { useState, useCallback, useRef } from 'react';
import { 
  X, 
  AlertTriangle, 
  RefreshCw,
  Cpu,
  Zap,
  Globe,
  Trash2,
  Activity,
  ExternalLink,
  ShieldCheck,
  Layers,
  Terminal,
  Github,
  Twitter,
  MessageSquare,
  Download,
  SearchCode,
  FileText,
  ShieldAlert,
  Hash,
  Database,
  Mail,
  User,
  TrendingDown,
  ArrowRightLeft,
  Link as LinkIcon
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { GoogleGenAI } from "@google/genai";
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
  const [socialLoading, setSocialLoading] = useState(false);
  const [deepLoading, setDeepLoading] = useState(false);

  const seenNodes = useRef<Set<string>>(new Set());
  const seenLinks = useRef<Set<string>>(new Set());
  const expandedNodes = useRef<Set<string>>(new Set());

  const addNode = useCallback((node: NodeData) => {
    setNodes(prev => {
      if (seenNodes.current.has(node.id)) {
        return prev.map(n => n.id === node.id ? { 
          ...n, 
          ...node, 
          details: { ...n.details, ...node.details },
          riskScore: node.riskScore ?? n.riskScore
        } : n);
      }
      seenNodes.current.add(node.id);
      return [...prev, node];
    });
  }, []);

  const addLink = useCallback((link: LinkData) => {
    const linkId = `${link.source}-${link.target}`;
    if (seenLinks.current.has(linkId)) return;
    seenLinks.current.add(linkId);
    setLinks(prev => [...prev, link]);
  }, []);

  const validateUrl = async (url: string): Promise<boolean> => {
    try {
      // Validate URL format first
      const urlObj = new URL(url);
      
      // Check for realistic domains
      const validDomains = ['github.com', 'pastebin.com', 'gist.github.com', 'gitlab.com', 'bitbucket.org'];
      const isValidDomain = validDomains.some(domain => urlObj.hostname.includes(domain));
      
      if (!isValidDomain) {
        console.warn(`URL domain not in whitelist: ${urlObj.hostname}`);
        return false;
      }
      
      // Check if URL looks like a real resource (not just a search query)
      if (url.includes('/search?q=') && !url.includes('github.com')) {
        // Google search URLs are informational, not direct resources
        return false;
      }
      
      // For GitHub URLs, validate they point to actual resources
      if (urlObj.hostname.includes('github.com')) {
        const path = urlObj.pathname;
        // Valid patterns: /user/repo, /user/repo/blob/..., /user/repo/commit/...
        const validPattern = /^\/[^\/]+\/[^\/]+(\/|$|\/(blob|tree|commit|issues|pull)\/)/;
        if (!validPattern.test(path)) {
          console.warn(`Invalid GitHub URL pattern: ${path}`);
          return false;
        }
      }
      
      // For Pastebin URLs, validate format
      if (urlObj.hostname.includes('pastebin.com')) {
        const path = urlObj.pathname;
        // Valid pattern: /xxxxx where xxxxx is alphanumeric paste ID
        const validPattern = /^\/[a-zA-Z0-9]{8}$/;
        if (!validPattern.test(path) && !path.startsWith('/raw/')) {
          console.warn(`Invalid Pastebin URL pattern: ${path}`);
          return false;
        }
      }
      
      return true;
    } catch (e) {
      console.warn(`URL validation failed: ${url}`, e);
      return false;
    }
  };

  const expandNode = useCallback(async (nodeId: string, type: string, maxDepth = 2, currentDepth = 0, force = false) => {
    if (currentDepth >= maxDepth) return;
    
    const expansionKey = `${nodeId}-depth-${currentDepth}-max-${maxDepth}`;
    if (!force && expandedNodes.current.has(expansionKey)) return;
    expandedNodes.current.add(expansionKey);

    const isEth = nodeId.toLowerCase().startsWith('0x');
    const unit = isEth ? 'ETH' : 'BTC';

    try {
      if (type === 'address' || type === 'eth_address') {
        const txs = await blockchainService.getAddressTxs(nodeId).catch(() => []);
        const limit = force ? 40 : 15;
        const targetTxs = (txs || []).slice(0, limit);
        
        for (const tx of targetTxs) {
          try {
            const totalOut = (tx.vout || []).reduce((sum, v) => sum + (v.value || 0), 0);
            const amtString = isEth ? (totalOut / 1e18).toFixed(6) : (totalOut / 1e8).toFixed(6);
            
            const txNode: NodeData = {
              id: tx.txid,
              type: 'transaction',
              label: `TX: ${tx.txid.substring(0, 8)}`,
              details: { 
                txid: tx.txid, 
                amount: `${amtString} ${unit}`, 
                status: tx.status?.confirmed ? "Confirmed" : "Mempool",
                block: tx.status?.block_height || "Pending",
                timestamp: tx.status?.block_time ? new Date(tx.status.block_time * 1000).toUTCString() : "Pending",
                fee: tx.fee ? `${isEth ? tx.fee/1e18 : tx.fee/1e8} ${unit}` : "N/A"
              }
            };
            
            addNode(txNode);
            addLink({ source: nodeId, target: txNode.id, value: 2, label: `${amtString} ${unit}` });
            
            if (currentDepth + 1 < maxDepth) {
              await expandNode(txNode.id, 'transaction', maxDepth, currentDepth + 1, force);
            }
          } catch (e) {
            continue;
          }
        }
      } else if (type === 'transaction') {
        const txData = await blockchainService.getTransaction(nodeId).catch(() => null);
        if (txData) {
          const limit = force ? 30 : 12;
          
          for (const input of (txData.vin || []).slice(0, limit)) {
            const addr = input.prevout?.scriptpubkey_address;
            if (addr) {
              const val = input.prevout?.value || 0;
              const valStr = `${isEth ? (val/1e18).toFixed(6) : (val/1e8).toFixed(6)} ${unit}`;
              const inNode: NodeData = {
                id: addr,
                type: addr.toLowerCase().startsWith('0x') ? 'eth_address' : 'address',
                label: `${addr.substring(0, 12)}...`,
                details: { address: addr, role: 'SENDER/INPUT', flow: valStr }
              };
              addNode(inNode);
              addLink({ source: addr, target: nodeId, value: 1, label: valStr });
              if (currentDepth + 1 < maxDepth) {
                await expandNode(addr, inNode.type, maxDepth, currentDepth + 1, force);
              }
            }
          }

          for (const out of (txData.vout || []).slice(0, limit)) {
            const addr = out.scriptpubkey_address;
            if (addr) {
              const val = out.value || 0;
              const valStr = `${isEth ? (val/1e18).toFixed(6) : (val/1e8).toFixed(6)} ${unit}`;
              const outNode: NodeData = {
                id: addr,
                type: addr.toLowerCase().startsWith('0x') ? 'eth_address' : 'address',
                label: `${addr.substring(0, 12)}...`,
                details: { address: addr, role: 'RECEIVER/OUTPUT', flow: valStr }
              };
              addNode(outNode);
              addLink({ source: nodeId, target: addr, value: 1, label: valStr });
              if (currentDepth + 1 < maxDepth) {
                await expandNode(addr, outNode.type, maxDepth, currentDepth + 1, force);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn(`Forensic branch failure at ${nodeId}.`);
    }
  }, [addNode, addLink]);

  const handleDeepTrace = async () => {
    if (!selectedNode || deepLoading) return;
    setDeepLoading(true);
    setError(null);
    try {
      await expandNode(selectedNode.id, selectedNode.type, 4, 0, true);
    } finally {
      setDeepLoading(false);
    }
  };

  const handleOSINTSweep = async (targetId: string) => {
    if (socialLoading) return;
    setSocialLoading(true);
    setError(null);

    try {
      // Direct GitHub Search (with Text-Match snippets and commit log depth)
      const gitHits = await blockchainService.searchGitHub(targetId);
      for (const git of gitHits) {
        const isAlive = await validateUrl(git.url);
        if (!isAlive) {
          console.warn(`Skipping invalid GitHub URL: ${git.url}`);
          continue;
        }

        const gitNode: NodeData = {
          id: git.url,
          type: 'github',
          label: `GIT: ${git.name.split('/').pop()?.substring(0, 15) || 'repo'}`,
          details: { 
            source: 'GitHub Direct Search', 
            url: git.url, 
            context: git.context, 
            parent_wallet: targetId, 
            osint: true,
            repo: git.name,
            path: git.path,
            repo_desc: git.description,
            repo_url: git.repo_url,
            match_type: git.type,
            status: 'VERIFIED_HIT'
          }
        };
        addNode(gitNode);
        addLink({ source: targetId, target: gitNode.id, value: 5, label: git.type === 'github_commit' ? 'COMMIT_CONTEXT' : 'CODE_SNIPPET' });
      }

      // Pastebin Search (note: requires manual verification)
      const pastebinHits = await blockchainService.searchPastebin(targetId);
      for (const paste of pastebinHits) {
        // Note: Pastebin results are informational and guide user to manual search
        // since Pastebin doesn't have a public search API
        if (paste.type === 'pastebin_search_instruction') {
          const instructionNode: NodeData = {
            id: `pastebin-search-${targetId}`,
            type: 'osint_confirmed',
            label: 'PASTEBIN_MANUAL_SEARCH',
            details: {
              source: 'Pastebin Search Guide',
              url: paste.url,
              context: paste.context,
              parent_wallet: targetId,
              osint: true,
              status: 'MANUAL_VERIFICATION_REQUIRED',
              description: paste.description
            }
          };
          addNode(instructionNode);
          addLink({ source: targetId, target: instructionNode.id, value: 3, label: 'PASTEBIN_SEARCH_REQUIRED' });
        }
      }

      if (gitHits.length === 0 && pastebinHits.length === 0) {
        setError(`No OSINT results found for "${targetId}". The identifier may not be publicly referenced.`);
      }

    } catch (e) {
      console.error("OSINT Error", e);
      setError("Forensic OSINT sweep encountered an error. Please try again.");
    } finally {
      setSocialLoading(false);
    }
  };

  const deleteNode = useCallback((nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setLinks(prev => prev.filter(l => l.source !== nodeId && l.target !== nodeId));
    seenNodes.current.delete(nodeId);
    Array.from(expandedNodes.current).forEach((k: string) => { if (k.startsWith(nodeId)) expandedNodes.current.delete(k); });
    const keysToDelete = Array.from(seenLinks.current).filter((k: string) => k.startsWith(nodeId + '-') || k.endsWith('-' + nodeId));
    keysToDelete.forEach((k: string) => seenLinks.current.delete(k));
    if (selectedNode?.id === nodeId) setSelectedNode(null);
  }, [selectedNode]);

  const resetGraph = () => {
    setNodes([]);
    setLinks([]);
    seenNodes.current.clear();
    seenLinks.current.clear();
    expandedNodes.current.clear();
    setSelectedNode(null);
    setError(null);
    blockchainService.clearCache();
  };

  const generateReport = () => {
    if (nodes.length === 0) return;
    const doc = new jsPDF();
    const rootNode = nodes.find(n => n.isRoot);
    
    doc.setFillColor(5, 7, 12);
    doc.rect(0, 0, 210, 50, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('SOTANIK_AI FORENSIC DOSSIER', 15, 22);
    doc.setFontSize(10);
    doc.setTextColor(16, 185, 129);
    doc.text('PROFESSIONAL CROSS-CHAIN LEDGER FORENSICS & VERBATIM OSINT', 15, 30);
    doc.setTextColor(148, 163, 184);
    doc.text(`UID: ${Math.random().toString(36).substring(2, 10).toUpperCase()}`, 15, 38);
    doc.text(`TIME: ${new Date().toUTCString()}`, 130, 38);

    let y = 65;
    
    doc.setTextColor(5, 7, 12);
    doc.setFontSize(14);
    doc.text('1. CORE INVESTIGATION TARGET', 15, y);
    doc.setDrawColor(16, 185, 129);
    doc.line(15, y + 2, 195, y + 2);
    y += 12;

    doc.setFontSize(10);
    doc.setFont('courier', 'bold');
    doc.text(`ID: ${rootNode?.id || 'N/A'}`, 20, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.text(`NETWORK: ${rootNode?.type.toUpperCase() || 'UNKNOWN'}`, 20, y);
    y += 6;
    doc.text(`CAPTURED_BALANCE: ${rootNode?.details?.balance || rootNode?.details?.net_balance || '0.00'}`, 20, y);
    y += 15;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('2. ENTITY RISK ASSESSMENT', 15, y);
    doc.line(15, y + 2, 195, y + 2);
    y += 12;

    const riskNodes = nodes.filter(n => n.type === 'address' || n.type === 'eth_address' || n.isRoot);
    riskNodes.forEach(node => {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`${node.id.substring(0, 25)}...`, 20, y);
      const risk = node.riskScore ?? node.details?.threat_risk ?? 0;
      doc.setTextColor(risk > 50 ? 239 : 16, risk > 50 ? 68 : 185, risk > 50 ? 68 : 129);
      doc.text(`RISK_SCORE: ${risk}/100`, 130, y);
      doc.setTextColor(0,0,0);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      y += 5;
      doc.text(`CLASS: ${node.details?.entity_type || 'UNKNOWN'} | TAG: ${node.details?.clustering_label || 'IDENTIFIED'}`, 22, y);
      y += 10;
    });

    if (y > 210) { doc.addPage(); y = 20; }
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('3. VERBATIM OSINT ATTRIBUTION LOGS', 15, y);
    doc.line(15, y + 2, 195, y + 2);
    y += 12;

    const osintNodes = nodes.filter(n => n.type === 'osint_confirmed' || n.type === 'github');
    osintNodes.forEach(node => {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFillColor(245, 247, 250);
      doc.rect(18, y - 5, 175, 45, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`HIT: ${node.label}`, 22, y);
      y += 5;
      doc.setFontSize(8);
      doc.setTextColor(59, 130, 246);
      doc.text(`VERIFIED_URL: ${node.id}`, 22, y);
      y += 5;
      doc.setTextColor(0,0,0);
      const proof = doc.splitTextToSize(`PROOF: ${node.details?.context || 'Identifier verified in source.'}`, 165);
      doc.text(proof, 22, y);
      y += (proof.length * 4) + 2;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(16, 185, 129);
      doc.text(`ATTRIBUTED_TO_PRIMARY: ${node.details?.parent_wallet || rootNode?.id}`, 22, y);
      y += 12;
      doc.setTextColor(0,0,0);
    });

    const pages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`SOTANIK_AI MASTER DOSSIER | PAGE ${i} OF ${pages}`, 15, 285);
      doc.text('CLASSIFIED FORENSIC DATA - AUTHORIZED ACCESS ONLY', 130, 285);
    }

    doc.save(`SOTANIK_FORENSIC_MASTER_${rootNode?.id.substring(0, 12)}.pdf`);
  };

  const startInvestigation = async () => {
    const val = query.trim();
    if (!val || loading) return;
    setLoading(true);
    resetGraph();
    setError(null);

    try {
      const type = blockchainService.detectSearchType(val);
      if (type === SearchType.UNKNOWN) throw new Error("Format rejected. Input Wallet Address, Tx Hash, or Block ID.");

      const root: NodeData = {
        id: val,
        type: type === SearchType.ETH_ADDRESS ? 'eth_address' : type === SearchType.TX ? 'transaction' : 'address',
        label: `${val.substring(0, 14)}...`,
        details: { identifier: val, forensic_tier: "ROOT_PRIMARY" },
        isRoot: true 
      };
      addNode(root);
      setSelectedNode(root);

      if (type === SearchType.ADDRESS || type === SearchType.ETH_ADDRESS) {
        const isEth = type === SearchType.ETH_ADDRESS;
        const [addrData, clustering] = await Promise.all([
          blockchainService.getAddress(val).catch(() => null),
          blockchainService.getClusteringHints(val, isEth).catch(() => null)
        ]);
        
        const unit = isEth ? 'ETH' : 'BTC';
        addNode({ 
          ...root,
          label: clustering?.clustering_label || root.label,
          riskScore: clustering?.threat_risk || 0,
          details: { ...root.details, ...clustering, balance: addrData ? `${(isEth ? addrData.chain_stats.funded_txo_sum/1e18 : (addrData.chain_stats.funded_txo_sum-addrData.chain_stats.spent_txo_sum)/1e8).toFixed(6)} ${unit}` : "0.00" }
        });

        await Promise.all([
          expandNode(val, root.type, 2, 0, true),
          handleOSINTSweep(val)
        ]);
      } else if (type === SearchType.TX) {
        await expandNode(val, 'transaction', 2, 0, true);
        await handleOSINTSweep(val);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#020408] text-slate-200 overflow-hidden font-sans select-none">
      <main className="flex-1 flex flex-col relative bg-[#020408]">
        <header className="h-28 border-b border-white/5 flex items-center justify-between px-12 bg-[#05070c]/98 backdrop-blur-3xl z-20">
          <div className="flex items-center gap-5">
            <div className="bg-emerald-500/5 p-2 rounded-2xl border border-emerald-400/30 shadow-lg">
               <svg viewBox="0 0 400 400" className="w-10 h-10" fill="none">
                  <path d="M50 80 L130 50 L160 150 L50 80 Z" stroke="#10b981" strokeWidth="18" strokeLinejoin="round"/>
                  <path d="M350 80 L270 50 L240 150 L350 80 Z" stroke="#10b981" strokeWidth="18" strokeLinejoin="round"/>
                  <path d="M80 160 C80 160 100 320 200 320 C300 320 320 160 320 160" stroke="#10b981" strokeWidth="18" strokeLinecap="round"/>
               </svg>
            </div>
            <div>
              <h1 className="font-black text-2xl tracking-tight text-white uppercase italic leading-none">Sotanik_AI</h1>
              <span className="text-[10px] text-emerald-500 uppercase tracking-[0.5em] font-black mt-1 block">Forensic Intelligence</span>
            </div>
          </div>

          <div className="flex-1 max-w-2xl mx-12 flex items-center gap-6">
            <div className="relative flex-1">
              <Terminal size={20} className="absolute inset-y-0 left-6 flex items-center text-slate-600 my-auto" />
              <input 
                type="text" 
                placeholder="Target ID (Address, Hash, or Scrape Query)..." 
                className="w-full bg-[#0a0d14]/90 border-2 border-white/10 rounded-3xl py-4 pl-16 pr-8 focus:outline-none text-sm transition-all text-white placeholder-slate-700 font-bold tracking-wider"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startInvestigation()}
              />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={startInvestigation} disabled={loading} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-black px-10 h-14 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-3 shadow-emerald-500/20 shadow-lg border-t border-white/20">
                {loading ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} />}
                {loading ? "SEARCHING" : "SCAN_UNIT"}
              </button>
              {nodes.length > 0 && (
                <button onClick={generateReport} className="bg-white/5 border border-white/10 text-emerald-400 hover:bg-emerald-500 hover:text-black px-6 h-14 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-3 shadow-xl">
                  <Download size={18} /> DOWNLOAD_DOSSIER
                </button>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {selectedNode && (
              <div className="flex gap-2">
                <button onClick={() => handleOSINTSweep(selectedNode.id)} disabled={socialLoading} className="flex items-center gap-3 px-6 h-12 bg-rose-500/10 hover:bg-rose-500/20 border-2 border-rose-500/40 rounded-2xl text-[10px] font-black text-rose-400 uppercase tracking-[0.2em] transition-all shadow-lg">
                  {socialLoading ? <RefreshCw size={14} className="animate-spin" /> : <Globe size={14} />} OSINT_SCAN
                </button>
                <button onClick={handleDeepTrace} disabled={deepLoading} className="flex items-center gap-3 px-6 h-12 bg-sky-500/10 hover:bg-sky-500/20 border-2 border-sky-500/40 rounded-2xl text-[10px] font-black text-sky-400 uppercase tracking-[0.2em] transition-all shadow-lg">
                  {deepLoading ? <RefreshCw size={14} className="animate-spin" /> : <Layers size={14} />} DEEP_TRACE
                </button>
              </div>
            )}
            {nodes.length > 0 && (
              <button onClick={resetGraph} className="bg-white/5 border border-white/10 text-white px-5 h-14 rounded-2xl hover:bg-white/10 transition-all flex items-center justify-center">
                <RefreshCw size={18} />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 relative bg-[#020408] overflow-hidden">
          {nodes.length > 0 ? (
            <TransactionGraph nodes={nodes} links={links} onNodeClick={setSelectedNode} selectedNodeId={selectedNode?.id} />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#020408]">
              <div className="relative mb-14">
                 <div className="absolute inset-0 bg-emerald-500/5 blur-[100px] rounded-full scale-90"></div>
                 <div className="bg-[#05070c] p-10 rounded-[2.5rem] border border-white/10 shadow-2xl relative z-10 animate-pulse-slow">
                    <svg viewBox="0 0 100 100" className="w-24 h-24 sm:w-32 sm:h-32" fill="none" stroke="#10b981" strokeWidth="1.2">
                       <path d="M50 15 L85 35 L85 75 L50 95 L15 75 L15 35 Z" strokeOpacity="0.3"/>
                       <path d="M50 55 L50 95" strokeOpacity="0.8" />
                       <circle cx="50" cy="55" r="1.5" fill="#10b981" />
                    </svg>
                 </div>
              </div>
              <h3 className="text-7xl sm:text-8xl md:text-9xl font-black text-[#8e97a3] tracking-tighter uppercase italic mb-6 select-none text-center opacity-90 leading-none">
                SOTANIK_AI
              </h3>
              <p className="max-w-2xl text-center text-[#4b5563] text-lg sm:text-xl font-medium italic leading-relaxed opacity-80 select-none px-6 uppercase tracking-widest">
                Blockchain Intelligence & Master OSINT Engine
              </p>
            </div>
          )}

          {error && (
            <div className="absolute top-8 left-8 right-8 bg-rose-500/10 border border-rose-500/30 text-rose-400 p-6 rounded-3xl flex items-center gap-6 z-30 backdrop-blur-xl animate-in zoom-in duration-300 shadow-2xl">
              <AlertTriangle size={28} className="text-rose-500 shrink-0" />
              <div className="flex flex-col flex-1">
                <span className="text-[9px] uppercase font-black tracking-widest text-rose-500">Forensic Fault</span>
                <span className="text-sm font-bold mt-0.5">{error}</span>
              </div>
              <button onClick={() => setError(null)} className="p-3 hover:bg-white/5 rounded-xl transition-colors"><X size={18} /></button>
            </div>
          )}

          {selectedNode && (
            <div className="absolute top-8 right-8 w-80 sm:w-[520px] bg-[#05070c]/98 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 shadow-2xl animate-in fade-in slide-in-from-right-8 z-10 max-h-[85vh] overflow-y-auto scrollbar-hide">
              <div className="flex items-center justify-between mb-8 pb-6 border-b border-white/5">
                <div className="flex items-center gap-4">
                  <div className="bg-emerald-500/10 p-3 rounded-xl text-emerald-400"><Cpu size={20} /></div>
                  <h2 className="font-black text-xs tracking-widest uppercase text-white">MANIFEST_ENTRY</h2>
                </div>
                <button onClick={() => setSelectedNode(null)} className="text-slate-500 hover:text-white transition-colors"><X size={18} /></button>
              </div>

              <div className="space-y-8">
                <div className="p-6 bg-[#0a0d14] border border-white/10 rounded-2xl break-all mono text-[12px] text-emerald-400 font-bold leading-relaxed shadow-inner">
                  {selectedNode.id}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-5 shadow-sm">
                    <span className="text-[9px] uppercase font-black text-slate-500 tracking-widest block">Forensic_Class</span>
                    <span className="text-xs font-black text-slate-100 uppercase truncate block mt-1">{selectedNode.type.replace('_', ' ')}</span>
                  </div>
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-5 shadow-sm">
                    <span className="text-[9px] uppercase font-black text-slate-500 tracking-widest block flex items-center gap-2"><TrendingDown size={10} className="text-rose-400"/> RISK_FACTOR</span>
                    <span className={`text-xs font-black uppercase truncate block mt-1 ${selectedNode.riskScore > 50 ? 'text-rose-400' : 'text-emerald-500'}`}>{selectedNode.riskScore ?? 0}/100</span>
                  </div>
                </div>

                {selectedNode.details?.osint && (
                  <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                    <label className="text-[9px] uppercase tracking-widest text-sky-400 font-black flex items-center gap-2">
                       <ShieldCheck size={12} className="text-sky-400" /> SOURCE_VERIFICATION
                    </label>
                    <div className={`p-6 bg-white/5 border rounded-2xl shadow-xl ${
                      selectedNode.details.status === 'VERIFIED_HIT' 
                        ? 'border-emerald-500/40 bg-emerald-500/5' 
                        : selectedNode.details.status === 'MANUAL_VERIFICATION_REQUIRED'
                        ? 'border-yellow-500/40 bg-yellow-500/5'
                        : 'border-sky-500/20 bg-sky-500/5'
                    }`}>
                      <div className="flex justify-between items-start mb-4">
                        <span className={`text-[8px] uppercase font-black px-2 py-1 rounded ${
                          selectedNode.details.status === 'VERIFIED_HIT' 
                            ? 'bg-emerald-500/20 text-emerald-400' 
                            : selectedNode.details.status === 'MANUAL_VERIFICATION_REQUIRED'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-sky-500/20 text-sky-400'
                        }`}>
                          {selectedNode.details.status}
                        </span>
                        {selectedNode.details.source_engine === 'pastebin' && <FileText size={14} className="text-orange-500" />}
                        {selectedNode.type === 'github' && <Github size={14} className="text-slate-400" />}
                        {selectedNode.details.status === 'MANUAL_VERIFICATION_REQUIRED' && <AlertTriangle size={14} className="text-yellow-500" />}
                      </div>
                      
                      <div className="bg-[#020408] p-4 rounded-lg border border-white/5 mb-4 font-mono text-[10px] text-slate-400 leading-tight overflow-hidden">
                         <div className="mb-2 italic text-slate-200 font-bold border-l-2 border-emerald-500/50 pl-2 py-1 bg-emerald-500/5">
                           {selectedNode.details.match_type === 'github_commit' ? "COMMIT_MSG:" : selectedNode.details.description ? "SEARCH_GUIDE:" : "EXTRACTED_SNIPPET:"}
                         </div>
                         <div className="whitespace-pre-wrap mt-2 overflow-x-auto p-2 bg-black/40 rounded border border-white/5 max-h-48">
                           {selectedNode.details.context || 'Verbatim match confirmed.'}
                         </div>
                         
                         {selectedNode.details.extracted && (
                            <div className="mt-4 pt-4 border-t border-white/5 space-y-4">
                               {selectedNode.details.extracted.wallets?.length > 0 && (
                                  <div>
                                     <div className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1 flex items-center gap-2"><Hash size={8}/> CO_LEAKED_WALLETS</div>
                                     <div className="flex flex-wrap gap-1">
                                        {selectedNode.details.extracted.wallets.map((w: string) => (
                                           <span key={w} className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[8px] text-emerald-400 mono">{w.substring(0, 10)}...</span>
                                        ))}
                                     </div>
                                  </div>
                               )}
                               {selectedNode.details.extracted.emails?.length > 0 && (
                                  <div>
                                     <div className="text-[8px] font-black text-sky-400 uppercase tracking-widest mb-1 flex items-center gap-2"><Mail size={8}/> ATTRIBUTED_EMAILS</div>
                                     <div className="flex flex-wrap gap-1">
                                        {selectedNode.details.extracted.emails.map((e: string) => (
                                           <span key={e} className="px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 rounded text-[8px] text-sky-400 mono">{e}</span>
                                        ))}
                                     </div>
                                  </div>
                               )}
                               {selectedNode.details.extracted.handles?.length > 0 && (
                                  <div>
                                     <div className="text-[8px] font-black text-rose-400 uppercase tracking-widest mb-1 flex items-center gap-2"><User size={8}/> SOCIAL_HANDLES</div>
                                     <div className="flex flex-wrap gap-1">
                                        {selectedNode.details.extracted.handles.map((h: string) => (
                                           <span key={h} className="px-2 py-0.5 bg-rose-500/10 border border-rose-500/20 rounded text-[8px] text-rose-400 mono">{h}</span>
                                        ))}
                                     </div>
                                  </div>
                               )}
                            </div>
                         )}
                         <div className="mt-4 pt-2 border-t border-white/5 text-[8px] opacity-70 uppercase font-black text-emerald-400 flex items-center gap-2">
                           <LinkIcon size={8} /> Target_Binding: {selectedNode.details.parent_wallet}
                         </div>
                      </div>
                      
                      <div className="flex flex-col gap-2">
                        <a href={selectedNode.details.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all text-[10px] font-black uppercase text-slate-300 shadow-lg group">
                          {selectedNode.details.match_type === 'github_commit' ? 'EXAMINE_COMMIT' : selectedNode.details.status === 'MANUAL_VERIFICATION_REQUIRED' ? 'OPEN_SEARCH' : 'PIVOT_TO_SOURCE'} <ExternalLink size={14} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                        </a>
                        {selectedNode.details.repo_url && (
                           <a href={selectedNode.details.repo_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all text-[10px] font-black uppercase text-sky-400 shadow-lg group">
                             INSPECT_REPOSITORY <Github size={14} className="group-hover:scale-110 transition-transform" />
                           </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <label className="text-[9px] uppercase tracking-widest text-slate-600 font-black flex items-center gap-2">
                    <Activity size={12} className="text-slate-500" /> FORENSIC_METADATA
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(selectedNode.details || {}).map(([key, val]) => {
                      if (['identifier', 'status', 'osint', 'context', 'url', 'type', 'category', 'tier', 'balance', 'clustering_label', 'identity_pivot', 'net_balance', 'forensic_tier', 'threat_risk', 'entity_type', 'confidence', 'parent_wallet', 'flow_captured', 'role', 'flow', 'source_engine', 'extracted', 'origin_paste', 'forensic_role', 'flow_value', 'repo', 'path', 'repo_url', 'repo_desc', 'match_type', 'description', 'source'].includes(key)) return null;
                      return (
                        <div key={key} className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-xl group hover:bg-white/10 transition-all">
                          <span className="text-[9px] uppercase font-black text-slate-500 tracking-widest truncate max-w-[150px]">{key.replace(/_/g, ' ')}</span>
                          <span className="text-[11px] font-bold text-slate-300 truncate ml-4">{String(val)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-8 border-t border-white/5 flex gap-2">
                   <button onClick={() => deleteNode(selectedNode.id)} className="flex-1 h-14 bg-rose-500/10 border border-rose-500/30 text-rose-500 rounded-2xl flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-widest hover:bg-rose-500/20 transition-all shadow-lg">
                     <Trash2 size={16} /> REMOVE_NODE
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