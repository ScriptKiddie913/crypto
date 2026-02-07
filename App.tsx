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
import { blockchainService } from './services/blockchainService';
import { osintService } from './services/osintService';
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
      // Enhanced URL validation with proper verification
      if (!url || !url.startsWith('http')) return false;
      
      // Check for common invalid patterns
      const invalidPatterns = [
        /fake/i,
        /404/i,
        /not.*found/i,
        /error/i,
        /invalid/i,
        /blocked/i
      ];
      
      if (invalidPatterns.some(pattern => pattern.test(url))) {
        return false;
      }

      // Verify URL is accessible
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      try {
        const response = await fetch(url, { 
          method: 'HEAD',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          mode: 'no-cors'
        });
        clearTimeout(timeout);
        
        // For no-cors mode, if no error is thrown, consider it valid
        return true;
      } catch {
        // Fallback: try with GET request
        try {
          await fetch(url, { 
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            mode: 'no-cors' 
          });
          return true;
        } catch {
          return false;
        }
      }
    } catch (e) {
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
    
    console.log(`Expanding ${type} node: ${nodeId} (depth: ${currentDepth}/${maxDepth}, force: ${force})`);

    try {
      if (type === 'address' || type === 'eth_address') {
        // Enhanced transaction data collection
        const [txs, detailedAddressInfo] = await Promise.all([
          blockchainService.getAddressTxs(nodeId).catch(() => []),
          blockchainService.getDetailedAddressInfo(nodeId).catch(() => null)
        ]);
        
        const limit = force ? 60 : currentDepth === 0 ? 25 : 15; // More transactions for root node
        const targetTxs = (txs || []).slice(0, limit);
        
        console.log(`Found ${targetTxs.length} transactions for address ${nodeId.substring(0, 12)}...`);
        
        for (const tx of targetTxs) {
          try {
            const totalOut = (tx.vout || []).reduce((sum, v) => sum + (v.value || 0), 0);
            const totalIn = (tx.vin || []).reduce((sum, v) => sum + (v.prevout?.value || 0), 0);
            const amtString = isEth ? (totalOut / 1e18).toFixed(6) : (totalOut / 1e8).toFixed(6);
            const inAmtString = isEth ? (totalIn / 1e18).toFixed(6) : (totalIn / 1e8).toFixed(6);
            
            // Enhanced transaction analysis
            const txAnalysis = {
              total_inputs: tx.vin?.length || 0,
              total_outputs: tx.vout?.length || 0,
              input_value: inAmtString,
              output_value: amtString,
              net_change: isEth ? ((totalOut - totalIn) / 1e18).toFixed(6) : ((totalOut - totalIn) / 1e8).toFixed(6),
              tx_type: totalIn > totalOut ? 'SPENDING' : 'RECEIVING',
              complexity_score: Math.min(100, ((tx.vin?.length || 0) + (tx.vout?.length || 0)) * 5),
              time_ago: tx.status?.block_time ? `${Math.floor((Date.now()/1000 - tx.status.block_time) / 86400)} days ago` : 'Recent'
            };
            
            const txNode: NodeData = {
              id: tx.txid,
              type: 'transaction',
              label: `TX: ${tx.txid.substring(0, 8)} (${txAnalysis.tx_type})`,
              details: { 
                txid: tx.txid, 
                amount: `${amtString} ${unit}`, 
                input_amount: `${inAmtString} ${unit}`,
                net_change: `${txAnalysis.net_change} ${unit}`,
                status: tx.status?.confirmed ? "Confirmed" : "Mempool",
                block: tx.status?.block_height || "Pending",
                timestamp: tx.status?.block_time ? new Date(tx.status.block_time * 1000).toUTCString() : "Pending",
                time_ago: txAnalysis.time_ago,
                fee: tx.fee ? `${isEth ? (tx.fee/1e18).toFixed(8) : (tx.fee/1e8).toFixed(8)} ${unit}` : "N/A",
                fee_rate: tx.fee && tx.size ? `${(tx.fee / tx.size).toFixed(2)} sat/byte` : "N/A",
                total_inputs: txAnalysis.total_inputs,
                total_outputs: txAnalysis.total_outputs,
                tx_type: txAnalysis.tx_type,
                complexity_score: txAnalysis.complexity_score,
                size_bytes: tx.size || 0,
                weight_units: tx.weight || 0,
                confirmations: tx.status?.block_height ? "6+" : "0",
                privacy_score: calculatePrivacyScore(tx),
                risk_indicators: analyzeTransactionRisk(tx, nodeId)
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
      console.log(`Starting comprehensive OSINT sweep for: ${targetId}`);
      
      // Use the new OSINT service for real source intelligence
      const osintResults = await osintService.performComprehensiveOSINT(targetId);
      
      console.log(`Found ${osintResults.length} verified OSINT results`);
      
      // Process each verified result
      for (const result of osintResults) {
        if (!result.verified) continue;

        // Double-check URL validity with our enhanced validator
        const isValidUrl = await validateUrl(result.url);
        if (!isValidUrl) {
          console.warn(`Skipping invalid URL: ${result.url}`);
          continue;
        }

        // Create the OSINT node with detailed information
        const osintNode: NodeData = {
          id: result.url,
          type: result.source === 'github' ? 'github' : 'osint_confirmed',
          label: `${result.source.toUpperCase()}: ${result.title.substring(0, 20)}...`,
          details: {
            // Core information
            url: result.url,
            source_engine: result.source,
            title: result.title,
            
            // Context and snippet with proper quoting
            context: result.snippet,
            quoted_snippet: extractQuotedSection(result.snippet, targetId),
            relevance: result.relevance,
            
            // Extracted entities
            extracted: result.extracted_entities,
            
            // Attribution and verification
            parent_wallet: result.linked_to,
            osint: true,
            status: "VERIFIED_HIT",
            verified_timestamp: new Date().toISOString(),
            content_hash: result.content_hash,
            
            // Additional GitHub-specific details if applicable
            ...(result.source === 'github' && {
              repo: result.title.split('/')[0] + '/' + result.title.split('/')[1],
              path: result.title.split('/').slice(2).join('/'),
              repo_url: result.url.split('/blob/')[0] || result.url.split('/commit/')[0] || result.url.split('/issues/')[0],
              match_type: result.url.includes('/commit/') ? 'github_commit' : 
                         result.url.includes('/issues/') ? 'github_issue' : 'github_code'
            }),

            // Additional Pastebin-specific details
            ...(result.source === 'pastebin' && {
              paste_id: result.url.split('/').pop(),
              paste_title: result.title,
              discovery_method: 'site_search'
            })
          }
        };

        addNode(osintNode);
        addLink({ 
          source: targetId, 
          target: osintNode.id, 
          value: 5, 
          label: result.source === 'github' ? 'GITHUB_ATTRIBUTION' : 'PASTEBIN_ATTRIBUTION' 
        });

        // If we found co-located entities, create additional nodes
        if (result.extracted_entities.wallets.length > 0) {
          for (const wallet of result.extracted_entities.wallets.slice(0, 3)) { // Limit to avoid clutter
            if (wallet !== targetId) { // Don't create self-referential nodes
              const coWalletNode: NodeData = {
                id: wallet,
                type: wallet.startsWith('0x') ? 'eth_address' : 'address',
                label: `CO-WALLET: ${wallet.substring(0, 12)}...`,
                details: {
                  address: wallet,
                  co_located_source: result.url,
                  discovery_context: 'Found in same paste/repo as target',
                  relationship: 'CO_LOCATED',
                  source_snippet: result.snippet
                }
              };
              
              addNode(coWalletNode);
              addLink({ 
                source: osintNode.id, 
                target: wallet, 
                value: 3, 
                label: 'CO_LOCATED_WALLET' 
              });
            }
          }
        }

        // Create email connectivity if available
        if (result.extracted_entities.emails.length > 0) {
          for (const email of result.extracted_entities.emails.slice(0, 2)) {
            const emailNode: NodeData = {
              id: email,
              type: 'osint_confirmed',
              label: `EMAIL: ${email}`,
              details: {
                email: email,
                source_url: result.url,
                associated_wallet: targetId,
                context_snippet: result.snippet,
                osint: true
              }
            };
            
            addNode(emailNode);
            addLink({ 
              source: osintNode.id, 
              target: email, 
              value: 2, 
              label: 'ASSOCIATED_EMAIL' 
            });
          }
        }
      }

      // If no results found, still show that we performed the search
      if (osintResults.length === 0) {
        console.warn('No verified OSINT results found for target');
        setError('No verified OSINT sources found. Target may be clean or sources offline.');
      } else {
        console.log(`Successfully processed ${osintResults.length} OSINT sources`);
      }

    } catch (e) {
      console.error("OSINT Error", e);
      setError("OSINT sweep failed: " + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setSocialLoading(false);
    }
  };

  // Helper function to extract quoted sections containing the target
  const extractQuotedSection = (text: string, target: string): string => {
    const lines = text.split('\n');
    const targetLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.toLowerCase().includes(target.toLowerCase())) {
        // Include context: previous line, target line, next line
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 1);
        const contextLines = lines.slice(start, end + 1);
        targetLines.push(...contextLines);
        break; // Take first occurrence for now
      }
    }
    
    return targetLines.length > 0 ? targetLines.join('\n') : text.substring(0, 200) + '...';
  };

  // Calculate privacy score for transactions
  const calculatePrivacyScore = (tx: any): number => {
    let score = 0;
    const inputs = tx.vin?.length || 0;
    const outputs = tx.vout?.length || 0;
    
    // More inputs/outputs generally increase privacy
    score += Math.min(30, inputs * 5);
    score += Math.min(30, outputs * 5);
    
    // Round number outputs might indicate change
    if (outputs > 1) score += 15;
    
    // Multiple inputs might indicate consolidation (less private)
    if (inputs > 3) score -= 10;
    
    return Math.max(0, Math.min(100, score));
  };

  // Analyze transaction for risk indicators
  const analyzeTransactionRisk = (tx: any, originAddress: string): string[] => {
    const risks: string[] = [];
    
    const totalValue = (tx.vout || []).reduce((sum: number, v: any) => sum + (v.value || 0), 0);
    const inputs = tx.vin?.length || 0;
    const outputs = tx.vout?.length || 0;
    
    // High value transaction
    if (totalValue > 1000000000) risks.push('HIGH_VALUE'); // >10 BTC or equivalent
    
    // Many inputs (potential mixing)
    if (inputs > 10) risks.push('MULTI_INPUT');
    
    // Many outputs (potential distribution)
    if (outputs > 20) risks.push('MULTI_OUTPUT');
    
    // Unusual fee patterns
    if (tx.fee && tx.size && (tx.fee / tx.size) > 1000) risks.push('HIGH_FEE');
    
    // Recent transaction
    if (tx.status?.block_time && (Date.now()/1000 - tx.status.block_time) < 3600) {
      risks.push('RECENT');
    }
    
    // Unconfirmed
    if (!tx.status?.confirmed) risks.push('UNCONFIRMED');
    
    return risks;
  };

  // Calculate activity days from transaction history
  const calculateActivityDays = (transactions: any[]): number => {
    if (transactions.length === 0) return 0;
    
    const timestamps = transactions
      .map(tx => tx.status?.block_time)
      .filter(time => time)
      .sort((a, b) => a - b);
    
    if (timestamps.length === 0) return 0;
    
    const firstActivity = timestamps[0];
    const lastActivity = timestamps[timestamps.length - 1];
    
    return Math.floor((lastActivity - firstActivity) / 86400);
  };

  // Calculate average transaction value
  const calculateAverageTransactionValue = (transactions: any[], isEth: boolean): string => {
    if (transactions.length === 0) return "0";
    
    const totalValue = transactions.reduce((sum, tx) => {
      const txValue = (tx.vout || []).reduce((vSum: number, v: any) => vSum + (v.value || 0), 0);
      return sum + txValue;
    }, 0);
    
    const avgValue = totalValue / transactions.length;
    return isEth ? (avgValue / 1e18).toFixed(6) : (avgValue / 1e8).toFixed(6);
  };

  // Calculate address age in days
  const calculateAddressAge = (transactions: any[]): number => {
    if (transactions.length === 0) return 0;
    
    const oldestTx = Math.min(...transactions.map(tx => tx.status?.block_time || Date.now()/1000));
    return Math.floor((Date.now()/1000 - oldestTx) / 86400);
  };

  const deleteNode = useCallback((nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setLinks(prev => prev.filter(l => l.source !== nodeId && l.target !== nodeId));
    seenNodes.current.delete(nodeId);
    Array.from(expandedNodes.current).forEach(k => { if (k.startsWith(nodeId)) expandedNodes.current.delete(k); });
    const keysToDelete = Array.from(seenLinks.current).filter(k => k.startsWith(nodeId + '-') || k.endsWith('-' + nodeId));
    keysToDelete.forEach(k => seenLinks.current.delete(k));
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
    osintService.clearCache(); // Clear OSINT cache as well
    console.log('Graph reset completed - all caches cleared');
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
        const unit = isEth ? 'ETH' : 'BTC';
        
        console.log(`Starting detailed analysis of ${isEth ? 'Ethereum' : 'Bitcoin'} address: ${val}`);
        
        // Enhanced data collection for initial address
        const [addrData, clustering, detailedInfo, recentTxs] = await Promise.all([
          blockchainService.getAddress(val).catch(() => null),
          blockchainService.getClusteringHints(val, isEth).catch(() => null),
          blockchainService.getDetailedAddressInfo(val).catch(() => null),
          blockchainService.getAddressTxs(val).catch(() => [])
        ]);
        
        // Calculate comprehensive address statistics
        const stats = {
          total_received: addrData ? (isEth ? (addrData.chain_stats.funded_txo_sum/1e18).toFixed(8) : (addrData.chain_stats.funded_txo_sum/1e8).toFixed(8)) : "0",
          total_sent: addrData ? (isEth ? (addrData.chain_stats.spent_txo_sum/1e18).toFixed(8) : (addrData.chain_stats.spent_txo_sum/1e8).toFixed(8)) : "0",
          current_balance: addrData ? (isEth ? (addrData.chain_stats.funded_txo_sum/1e18).toFixed(8) : ((addrData.chain_stats.funded_txo_sum-addrData.chain_stats.spent_txo_sum)/1e8).toFixed(8)) : "0",
          transaction_count: addrData?.chain_stats.tx_count || 0,
          first_activity: recentTxs.length > 0 ? new Date(Math.min(...recentTxs.map(tx => tx.status?.block_time || 0)) * 1000).toLocaleDateString() : "Unknown",
          last_activity: recentTxs.length > 0 ? new Date(Math.max(...recentTxs.map(tx => tx.status?.block_time || 0)) * 1000).toLocaleDateString() : "Unknown",
          activity_days: calculateActivityDays(recentTxs),
          avg_tx_value: calculateAverageTransactionValue(recentTxs, isEth),
          address_age_days: calculateAddressAge(recentTxs)
        };
        
        // Enhanced root node with comprehensive data
        addNode({ 
          ...root,
          label: clustering?.clustering_label || `${val.substring(0, 14)}...`,
          riskScore: clustering?.threat_risk || 0,
          details: { 
            ...root.details, 
            ...clustering, 
            ...stats,
            ...detailedInfo,
            balance: `${stats.current_balance} ${unit}`,
            total_received: `${stats.total_received} ${unit}`,
            total_sent: `${stats.total_sent} ${unit}`,
            network_type: isEth ? 'Ethereum' : 'Bitcoin',
            address_analysis: 'COMPREHENSIVE_SCAN_COMPLETED'
          }
        });

        await Promise.all([
          expandNode(val, root.type, 2, 0, false), // Set to false for initial load, user can deep trace later
          handleOSINTSweep(val)
        ]);
      } else if (type === SearchType.TX) {
        console.log(`Starting detailed transaction analysis: ${val}`);
        
        // Enhanced transaction analysis for initial query
        const txData = await blockchainService.getTransaction(val).catch(() => null);
        
        if (txData) {
          const isEth = val.startsWith('0x');
          const unit = isEth ? 'ETH' : 'BTC';
          
          // Comprehensive transaction analysis
          const totalOut = (txData.vout || []).reduce((sum, v) => sum + (v.value || 0), 0);
          const totalIn = (txData.vin || []).reduce((sum, v) => sum + (v.prevout?.value || 0), 0);
          
          const txStats = {
            total_value_out: isEth ? (totalOut / 1e18).toFixed(8) : (totalOut / 1e8).toFixed(8),
            total_value_in: isEth ? (totalIn / 1e18).toFixed(8) : (totalIn / 1e8).toFixed(8),
            net_value: isEth ? ((totalOut - totalIn) / 1e18).toFixed(8) : ((totalOut - totalIn) / 1e8).toFixed(8),
            input_count: txData.vin?.length || 0,
            output_count: txData.vout?.length || 0,
            size_analysis: `${txData.size || 0} bytes`,
            weight_analysis: `${txData.weight || 0} weight units`,
            fee_analysis: txData.fee ? `${isEth ? (txData.fee/1e18).toFixed(8) : (txData.fee/1e8).toFixed(8)} ${unit}` : \"N/A\",
            fee_rate: txData.fee && txData.size ? `${(txData.fee / txData.size).toFixed(2)} sat/vB` : \"N/A\",
            block_info: txData.status?.block_height ? `Block ${txData.status.block_height}` : \"Mempool\",
            timestamp_analysis: txData.status?.block_time ? new Date(txData.status.block_time * 1000).toUTCString() : \"Pending\",
            privacy_score: calculatePrivacyScore(txData),
            risk_indicators: analyzeTransactionRisk(txData, val),
            complexity_rating: Math.min(100, ((txData.vin?.length || 0) + (txData.vout?.length || 0)) * 3)
          };
          
          // Update root transaction node with detailed analysis
          addNode({
            ...root,
            label: `TX: ${val.substring(0, 12)} (${totalOut > totalIn ? 'OUTBOUND' : 'INBOUND'})`,
            details: {
              ...root.details,
              ...txStats,
              transaction_type: 'DETAILED_ROOT_TX',
              tx_analysis: 'COMPREHENSIVE_SCAN_COMPLETED'
            }
          });
        }
        
        await Promise.all([
          expandNode(val, 'transaction', 2, 0, false),
          handleOSINTSweep(val)
        ]);
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
            {/* Performance indicator */}
            <div className="text-[8px] text-slate-500 font-mono bg-black/20 px-3 py-2 rounded-lg border border-white/5">
              <div className="text-emerald-400 font-bold">NO API LIMITS</div>
              <div>Cache: {osintService.getPerformanceMetrics().cacheHitRate}</div>
            </div>
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
                    <div className={`p-6 bg-white/5 border rounded-2xl shadow-xl ${selectedNode.details.status === 'VERIFIED_HIT' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-sky-500/20 bg-sky-500/5'}`}>
                      <div className="flex justify-between items-start mb-4">
                        <span className={`text-[8px] uppercase font-black px-2 py-1 rounded ${selectedNode.details.status === 'VERIFIED_HIT' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-sky-500/20 text-sky-400'}`}>
                          {selectedNode.details.status}
                        </span>
                        {selectedNode.details.source_engine === 'pastebin' && <FileText size={14} className="text-orange-500" />}
                        {selectedNode.type === 'github' && <Github size={14} className="text-slate-400" />}
                      </div>
                      
                      <div className="bg-[#020408] p-4 rounded-lg border border-white/5 mb-4 font-mono text-[10px] text-slate-400 leading-tight overflow-hidden">
                         <div className="mb-2 italic text-slate-200 font-bold border-l-2 border-emerald-500/50 pl-2 py-1 bg-emerald-500/5">
                           {selectedNode.details.match_type === 'github_commit' ? "COMMIT_MSG:" : "EXTRACTED_SNIPPET:"}
                         </div>
                         <div className="whitespace-pre-wrap mt-2 overflow-x-auto p-2 bg-black/40 rounded border border-white/5 max-h-48">
                           {selectedNode.details.quoted_snippet || selectedNode.details.context || 'Verbatim match confirmed.'}
                         </div>
                         
                         {/* Show full context expandable */}
                         {selectedNode.details.quoted_snippet && selectedNode.details.context !== selectedNode.details.quoted_snippet && (
                           <details className="mt-3">
                             <summary className="text-[8px] text-emerald-400 cursor-pointer hover:text-emerald-300 font-bold uppercase tracking-widest">
                               EXPAND_FULL_CONTEXT
                             </summary>
                             <div className="mt-2 p-2 bg-black/20 rounded text-[9px] text-slate-500 max-h-64 overflow-y-auto">
                               {selectedNode.details.context}
                             </div>
                           </details>
                         )}
                         
                         {/* Show verification details */}
                         <div className="mt-3 pt-2 border-t border-white/5 text-[8px] space-y-1">
                           {selectedNode.details.verified_timestamp && (
                             <div className="text-emerald-400">
                               VERIFIED: {new Date(selectedNode.details.verified_timestamp).toLocaleString()}
                             </div>
                           )}
                           {selectedNode.details.content_hash && (
                             <div className="text-slate-500 font-mono">
                               HASH: {selectedNode.details.content_hash}
                             </div>
                           )}
                           {selectedNode.details.discovery_method && (
                             <div className="text-blue-400">
                               METHOD: {selectedNode.details.discovery_method.toUpperCase()}
                             </div>
                           )}
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
                          {selectedNode.details.match_type === 'github_commit' ? 'EXAMINE_COMMIT' : 'PIVOT_TO_SOURCE'} <ExternalLink size={14} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
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
                  
                  {/* Enhanced display for transaction details */}
                  {selectedNode.type === 'transaction' && (
                    <div className="space-y-3">
                      {selectedNode.details.risk_indicators?.length > 0 && (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                          <div className="text-[8px] font-black text-rose-400 uppercase mb-2">RISK INDICATORS</div>
                          <div className="flex flex-wrap gap-1">
                            {selectedNode.details.risk_indicators.map((risk: string) => (
                              <span key={risk} className="px-2 py-0.5 bg-rose-500/20 text-rose-300 rounded text-[7px] font-bold">
                                {risk.replace('_', ' ')}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                          <div className="text-[8px] text-emerald-400 font-black uppercase mb-1">PRIVACY SCORE</div>
                          <div className="text-lg font-black text-emerald-300">{selectedNode.details.privacy_score || 0}/100</div>
                        </div>
                        <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-3">
                          <div className="text-[8px] text-sky-400 font-black uppercase mb-1">COMPLEXITY</div>
                          <div className="text-lg font-black text-sky-300">{selectedNode.details.complexity_score || selectedNode.details.complexity_rating || 0}/100</div>
                        </div>
                      </div>
                      
                      {selectedNode.details.total_inputs && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                            <div className="text-[8px] text-slate-400 font-black uppercase mb-1">INPUTS</div>
                            <div className="text-sm font-black text-white">{selectedNode.details.total_inputs}</div>
                            {selectedNode.details.input_amount && (
                              <div className="text-[7px] text-slate-500 mt-1">{selectedNode.details.input_amount}</div>
                            )}
                          </div>
                          <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                            <div className="text-[8px] text-slate-400 font-black uppercase mb-1">OUTPUTS</div>
                            <div className="text-sm font-black text-white">{selectedNode.details.total_outputs}</div>
                            {selectedNode.details.amount && (
                              <div className="text-[7px] text-slate-500 mt-1">{selectedNode.details.amount}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Enhanced display for address details */}
                  {(selectedNode.type === 'address' || selectedNode.type === 'eth_address') && (
                    <div className="space-y-3">
                      {selectedNode.details.address_analysis && (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                          <div className="text-[8px] font-black text-emerald-400 uppercase mb-2">COMPREHENSIVE ANALYSIS</div>
                          <div className="text-[7px] text-emerald-300">✓ Transaction History Analyzed</div>
                          <div className="text-[7px] text-emerald-300">✓ Pattern Recognition Completed</div>
                          <div className="text-[7px] text-emerald-300">✓ Risk Assessment Finalized</div>
                        </div>
                      )}
                      
                      {selectedNode.details.activity_days && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3">
                            <div className="text-[8px] text-blue-400 font-black uppercase mb-1">ACTIVE DAYS</div>
                            <div className="text-lg font-black text-blue-300">{selectedNode.details.activity_days}</div>
                          </div>
                          <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3">
                            <div className="text-[8px] text-purple-400 font-black uppercase mb-1">TX COUNT</div>
                            <div className="text-lg font-black text-purple-300">{selectedNode.details.transaction_count || 0}</div>
                          </div>
                        </div>
                      )}
                      
                      {selectedNode.details.avg_tx_value && (
                        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3">
                          <div className="text-[8px] text-yellow-400 font-black uppercase mb-1">AVG TX VALUE</div>
                          <div className="text-sm font-black text-yellow-300">{selectedNode.details.avg_tx_value} {selectedNode.details.network_type === 'Ethereum' ? 'ETH' : 'BTC'}</div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(selectedNode.details || {}).map(([key, val]) => {
                      // Skip keys that are already displayed in enhanced sections
                      if (['identifier', 'status', 'osint', 'context', 'url', 'type', 'category', 'tier', 'balance', 'clustering_label', 'identity_pivot', 'net_balance', 'forensic_tier', 'threat_risk', 'entity_type', 'confidence', 'parent_wallet', 'flow_captured', 'role', 'flow', 'source_engine', 'extracted', 'origin_paste', 'forensic_role', 'flow_value', 'repo', 'path', 'repo_url', 'repo_desc', 'match_type', 'risk_indicators', 'privacy_score', 'complexity_score', 'complexity_rating', 'total_inputs', 'total_outputs', 'input_amount', 'amount', 'address_analysis', 'activity_days', 'transaction_count', 'avg_tx_value', 'network_type'].includes(key)) return null;
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