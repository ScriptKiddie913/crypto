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
  const [scanningNodeId, setScanningNodeId] = useState<string | null>(null);
  const [scanDepth, setScanDepth] = useState(2);
  const [hyperMode, setHyperMode] = useState(false);
  const [scanAborted, setScanAborted] = useState(false);
  const [dateFilter, setDateFilter] = useState({ startDate: '', endDate: '' });
  const [showDateFilter, setShowDateFilter] = useState(false);

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
    const reverseLinkId = `${link.target}-${link.source}`;
    
    // Check for existing link in either direction
    const existingLinkIndex = links.findIndex(l => 
      (`${l.source}-${l.target}` === linkId) || (`${l.source}-${l.target}` === reverseLinkId)
    );
    
    if (existingLinkIndex !== -1) {
      // Strengthen existing connection
      setLinks(prev => prev.map((l, index) => {
        if (index === existingLinkIndex) {
          const newValue = (l.value || 1) + (link.value || 1);
          return {
            ...l,
            value: newValue,
            label: `${newValue > 3 ? 'STRONG_LINK' : 'MULTI_TX'}: ${link.label || ''}`.trim()
          };
        }
        return l;
      }));
      return;
    }
    
    // Add new link if not already tracked
    if (seenLinks.current.has(linkId)) return;
    seenLinks.current.add(linkId);
    setLinks(prev => [...prev, link]);
  }, [links]);

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

  const expandNode = useCallback(async (nodeId: string, type: string, maxDepth = 2, currentDepth = 0, force = false, rootScanId?: string) => {
    if (currentDepth >= maxDepth || scanAborted) return;
    
    const expansionKey = `${nodeId}-depth-${currentDepth}-max-${maxDepth}`;
    if (!force && expandedNodes.current.has(expansionKey)) return;
    expandedNodes.current.add(expansionKey);
    
    // Set scanning indicator for root node
    if (currentDepth === 0 && rootScanId) {
      setScanningNodeId(rootScanId);
    }

    const isEth = nodeId.toLowerCase().startsWith('0x');
    const unit = isEth ? 'ETH' : 'BTC';
    
    console.log(`Expanding ${type} node: ${nodeId} (depth: ${currentDepth}/${maxDepth}, force: ${force}, scanning: ${!!rootScanId})`);

    try {
      if (type === 'address' || type === 'eth_address') {
        // Enhanced transaction data collection with retries
        let txs, detailedAddressInfo;
        try {
          [txs, detailedAddressInfo] = await Promise.all([
            blockchainService.getAddressTxs(nodeId).catch(async e => {
              console.warn(`First attempt failed for ${nodeId}:`, e);
              // Retry once after a short delay
              await new Promise(resolve => setTimeout(resolve, 1000));
              return blockchainService.getAddressTxs(nodeId).catch(() => []);
            }),
            blockchainService.getDetailedAddressInfo(nodeId).catch(() => null)
          ]);
        } catch (e) {
          console.error(`Failed to fetch data for ${nodeId}:`, e);
          txs = [];
          detailedAddressInfo = null;
        }
        
        const limit = force ? 150 : currentDepth === 0 ? 100 : 50;
        let targetTxs = (txs || []).slice(0, limit);
        
        console.log(`Processing ${targetTxs.length} transactions for address ${nodeId.substring(0, 12)}...`);
        
        // Apply date filtering if enabled
        if (dateFilter.startDate && dateFilter.endDate) {
          const startTime = new Date(dateFilter.startDate).getTime() / 1000;
          const endTime = new Date(dateFilter.endDate).getTime() / 1000;
          targetTxs = targetTxs.filter(tx => {
            const txTime = tx.status?.block_time;
            return txTime && txTime >= startTime && txTime <= endTime;
          });
          console.log(`After date filtering: ${targetTxs.length} transactions`);
        }
        
        for (const tx of targetTxs) {
          if (scanAborted) break;
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
            
            if (currentDepth + 1 < maxDepth && !scanAborted) {
              await expandNode(txNode.id, 'transaction', maxDepth, currentDepth + 1, force, rootScanId);
            }
          } catch (e) {
            console.warn(`Error processing transaction ${tx.txid}:`, e);
            continue;
          }
        }
      } else if (type === 'transaction') {
        try {
          const txData = await blockchainService.getTransaction(nodeId).catch(e => {
            console.warn(`Transaction fetch failed for ${nodeId}:`, e);
            return null;
          });
          
          if (txData) {
            const limit = force ? 100 : 50;
            console.log(`Processing transaction ${nodeId} with ${(txData.vin?.length || 0)} inputs and ${(txData.vout?.length || 0)} outputs`);
            
            for (const input of (txData.vin || []).slice(0, limit)) {
              if (scanAborted) break;
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
                if (currentDepth + 1 < maxDepth && !scanAborted) {
                  await expandNode(addr, inNode.type, maxDepth, currentDepth + 1, force, rootScanId);
                }
              }
            }

            for (const out of (txData.vout || []).slice(0, limit)) {
              if (scanAborted) break;
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
                if (currentDepth + 1 < maxDepth && !scanAborted) {
                  await expandNode(addr, outNode.type, maxDepth, currentDepth + 1, force, rootScanId);
                }
              }
            }
          } else {
            console.warn(`No transaction data available for ${nodeId}`);
          }
        } catch (err) {
          console.error(`Error processing transaction ${nodeId}:`, err);
        }
      }
    } catch (err) {
      console.warn(`Forensic branch failure at ${nodeId}.`);
    }
  }, [addNode, addLink]);

  const handleDeepTrace = async () => {
    if (!selectedNode) return;
    
    if (deepLoading) {
      // Stop the scan
      setScanAborted(true);
      setDeepLoading(false);
      setScanningNodeId(null);
      return;
    }
    
    setDeepLoading(true);
    setScanAborted(false);
    setError(null);
    
    try {
      const depth = hyperMode ? 8 : scanDepth;
      await expandNode(selectedNode.id, selectedNode.type, depth, 0, true, selectedNode.id);
    } finally {
      setDeepLoading(false);
      setScanningNodeId(null);
      setScanAborted(false);
    }
  };
  
  const toggleHyperMode = () => {
    setHyperMode(!hyperMode);
    if (!hyperMode) {
      setScanDepth(8);
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
          type: result.source === 'github' ? 'github' : 
                result.source === 'reddit' || result.source === 'twitter' ? 'social' : 'osint_confirmed',
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
            
            // Social intelligence specific details
            ...(result.social_intel && result.social_intel.length > 0 && {
              social_intelligence: {
                threat_level: result.social_intel[0].threat_level,
                post_type: result.social_intel[0].post_type,
                timestamp: result.social_intel[0].timestamp,
                source_platform: result.social_intel[0].source
              }
            }),
            
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
            }),

            // Additional Reddit-specific details  
            ...(result.source === 'reddit' && {
              reddit_post: true,
              post_timestamp: result.social_intel?.[0]?.timestamp,
              subreddit: result.url.includes('/r/') ? result.url.split('/r/')[1].split('/')[0] : 'unknown'
            }),

            // Additional Twitter-specific details
            ...(result.source === 'twitter' && {
              twitter_post: true,
              tweet_analysis: true,
              nitter_source: result.url.includes('nitter') ? result.url.split('//')[1].split('/')[0] : 'twitter.com'
            })
          }
        };

        addNode(osintNode);
        
        // Choose appropriate link label based on source
        const linkLabel = result.source === 'github' ? 'GITHUB_ATTRIBUTION' : 
                         result.source === 'reddit' ? 'REDDIT_INTELLIGENCE' :
                         result.source === 'twitter' ? 'TWITTER_INTELLIGENCE' :
                         result.source === 'pastebin' ? 'PASTEBIN_ATTRIBUTION' : 'OSINT_HIT';
        
        addLink({ 
          source: targetId, 
          target: osintNode.id, 
          value: 5, 
          label: linkLabel
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
    // Stop any running scans first
    setScanAborted(true);
    setDeepLoading(false);
    setScanningNodeId(null);
    
    setNodes([]);
    setLinks([]);
    seenNodes.current.clear();
    seenLinks.current.clear();
    expandedNodes.current.clear();
    setSelectedNode(null);
    setError(null);
    setSocialLoading(false);
    setHyperMode(false);
    setScanDepth(2);
    setDateFilter({ startDate: '', endDate: '' });
    setShowDateFilter(false);
    blockchainService.clearCache();
    osintService.clearCache();
    console.log('Graph reset completed - all caches and states cleared');
  };

  const generateReport = () => {
    if (nodes.length === 0) return;
    const doc = new jsPDF();
    const rootNode = nodes.find(n => n.isRoot);
    
    // Professional Header with Gradient Background Effect
    doc.setFillColor(5, 7, 12);
    doc.rect(0, 0, 210, 60, 'F');
    doc.setFillColor(16, 185, 129, 0.1); // Emerald overlay
    doc.rect(0, 0, 210, 60, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.text('SOTANIK_AI FORENSIC INTELLIGENCE DOSSIER', 15, 25);
    
    doc.setFontSize(12);
    doc.setTextColor(16, 185, 129);
    doc.text('ADVANCED CROSS-CHAIN BLOCKCHAIN FORENSICS & COMPREHENSIVE OSINT ANALYSIS', 15, 35);
    
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(10);
    doc.text(`CLASSIFICATION: RESTRICTED | UID: ${Math.random().toString(36).substring(2, 10).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`, 15, 45);
    doc.text(`GENERATED: ${new Date().toUTCString()}`, 15, 52);
    doc.text(`ANALYST: SOTANIK_AI_SYSTEM | STATUS: VERIFIED`, 120, 45);
    doc.text(`TARGET_COUNT: ${nodes.length} | LINKS: ${links.length}`, 120, 52);

    let y = 75;
    
    // Executive Summary Section
    doc.setTextColor(5, 7, 12);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('EXECUTIVE SUMMARY', 15, y);
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(0.8);
    doc.line(15, y + 2, 195, y + 2);
    y += 15;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const summary = `This comprehensive forensic analysis encompasses ${nodes.length} identified entities across multiple blockchain networks, with ${links.length} established connections. The investigation reveals detailed transaction patterns, OSINT attributions, and risk assessments for target identifier: ${rootNode?.id || 'UNKNOWN'}.`;
    const summaryLines = doc.splitTextToSize(summary, 170);
    doc.text(summaryLines, 15, y);
    y += (summaryLines.length * 6) + 10;

    // Core Investigation Target Section
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('1. PRIMARY TARGET ANALYSIS', 15, y);
    doc.line(15, y + 2, 195, y + 2);
    y += 15;

    if (rootNode) {
      doc.setFillColor(245, 247, 250);
      doc.rect(15, y - 5, 180, 35, 'F');
      
      doc.setFontSize(12);
      doc.setFont('courier', 'bold');
      doc.setTextColor(16, 185, 129);
      doc.text(`TARGET_ID: ${rootNode.id}`, 20, y + 5);
      
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(5, 7, 12);
      doc.text(`NETWORK: ${rootNode.type.toUpperCase().replace('_', ' ')}`, 20, y + 12);
      doc.text(`BALANCE: ${rootNode.details?.balance || rootNode.details?.current_balance || '0.00'}`, 20, y + 19);
      doc.text(`TX_COUNT: ${rootNode.details?.transaction_count || 0}`, 105, y + 12);
      doc.text(`RISK_SCORE: ${rootNode.riskScore || rootNode.details?.threat_risk || 0}/100`, 105, y + 19);
      doc.text(`CLASSIFICATION: ${rootNode.details?.clustering_label || 'IDENTIFIED'}`, 20, y + 26);
      y += 45;
    }

    // Enhanced Risk Assessment Section
    if (y > 220) { doc.addPage(); y = 20; }
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 7, 12);
    doc.text('2. COMPREHENSIVE RISK ASSESSMENT', 15, y);
    doc.line(15, y + 2, 195, y + 2);
    y += 15;

    const riskNodes = nodes.filter(n => n.type === 'address' || n.type === 'eth_address' || n.isRoot);
    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let lowRiskCount = 0;
    
    riskNodes.forEach(node => {
      const risk = node.riskScore ?? node.details?.threat_risk ?? 0;
      if (risk >= 70) highRiskCount++;
      else if (risk >= 30) mediumRiskCount++;
      else lowRiskCount++;
    });

    // Risk Summary Stats
    doc.setFillColor(239, 68, 68, 0.1);
    doc.rect(15, y, 55, 25, 'F');
    doc.setTextColor(239, 68, 68);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`${highRiskCount}`, 35, y + 10);
    doc.setFontSize(10);
    doc.text('HIGH RISK', 25, y + 18);

    doc.setFillColor(255, 193, 7, 0.1);
    doc.rect(75, y, 55, 25, 'F');
    doc.setTextColor(255, 193, 7);
    doc.setFontSize(14);
    doc.text(`${mediumRiskCount}`, 95, y + 10);
    doc.setFontSize(10);
    doc.text('MEDIUM RISK', 85, y + 18);

    doc.setFillColor(16, 185, 129, 0.1);
    doc.rect(135, y, 55, 25, 'F');
    doc.setTextColor(16, 185, 129);
    doc.setFontSize(14);
    doc.text(`${lowRiskCount}`, 155, y + 10);
    doc.setFontSize(10);
    doc.text('LOW RISK', 148, y + 18);
    y += 35;

    // Detailed Risk Analysis
    riskNodes.forEach((node, index) => {
      if (y > 250) { doc.addPage(); y = 20; }
      const risk = node.riskScore ?? node.details?.threat_risk ?? 0;
      
      doc.setFillColor(250, 250, 250);
      doc.rect(15, y - 5, 180, 30, 'F');
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(5, 7, 12);
      doc.text(`${index + 1}. ${node.id.substring(0, 35)}...`, 20, y + 5);
      
      doc.setTextColor(risk > 70 ? 239 : risk > 30 ? 255 : 16, risk > 70 ? 68 : risk > 30 ? 193 : 185, risk > 70 ? 68 : risk > 30 ? 7 : 129);
      doc.text(`RISK: ${risk}/100`, 150, y + 5);
      
      doc.setFontSize(9);
      doc.setTextColor(75, 85, 99);
      doc.text(`TYPE: ${node.details?.entity_type || 'UNKNOWN'} | LABEL: ${node.details?.clustering_label || 'IDENTIFIED'}`, 20, y + 12);
      if (node.details?.total_received) {
        doc.text(`RECEIVED: ${node.details.total_received} | SENT: ${node.details.total_sent || '0'}`, 20, y + 19);
      }
      y += 35;
    });

    // Enhanced OSINT Intelligence Section
    if (y > 200) { doc.addPage(); y = 20; }
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 7, 12);
    doc.text('3. COMPREHENSIVE OSINT & SOCIAL INTELLIGENCE', 15, y);
    doc.line(15, y + 2, 195, y + 2);
    y += 15;

    const osintNodes = nodes.filter(n => n.type === 'osint_confirmed' || n.type === 'github' || n.type === 'social');
    const githubHits = osintNodes.filter(n => n.type === 'github');
    const socialHits = osintNodes.filter(n => n.type === 'social');
    const otherHits = osintNodes.filter(n => n.type === 'osint_confirmed');

    // OSINT Summary
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL OSINT HITS: ${osintNodes.length} | GITHUB: ${githubHits.length} | SOCIAL: ${socialHits.length} | OTHER: ${otherHits.length}`, 15, y);
    y += 15;

    osintNodes.forEach((node, index) => {
      if (y > 240) { doc.addPage(); y = 20; }
      
      // Color-coded background based on source
      if (node.type === 'github') {
        doc.setFillColor(240, 240, 245);
      } else if (node.type === 'social') {
        doc.setFillColor(245, 250, 255);
      } else {
        doc.setFillColor(250, 245, 245);
      }
      doc.rect(15, y - 5, 180, 55, 'F');
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(5, 7, 12);
      doc.text(`${index + 1}. ${node.label}`, 20, y + 5);
      
      doc.setFontSize(9);
      doc.setTextColor(59, 130, 246);
      const urlText = doc.splitTextToSize(`URL: ${node.id}`, 165);
      doc.text(urlText, 20, y + 12);
      y += (urlText.length * 4);
      
      doc.setTextColor(5, 7, 12);
      const proofText = doc.splitTextToSize(`INTELLIGENCE: ${node.details?.context || 'Identifier verified in source.'}`, 165);
      doc.text(proofText, 20, y + 5);
      y += (proofText.length * 4);
      
      if (node.details?.social_intelligence) {
        doc.setFontSize(8);
        doc.setTextColor(16, 185, 129);
        doc.text(`THREAT_LEVEL: ${node.details.social_intelligence.threat_level} | PLATFORM: ${node.details.social_intelligence.source_platform.toUpperCase()}`, 20, y + 5);
        y += 6;
      }
      
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(16, 185, 129);
      doc.text(`ATTRIBUTION: ${node.details?.parent_wallet || rootNode?.id}`, 20, y + 5);
      y += 20;
    });

    // Transaction Flow Analysis (new section)
    if (y > 200) { doc.addPage(); y = 20; }
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 7, 12);
    doc.text('4. TRANSACTION FLOW & PATTERN ANALYSIS', 15, y);
    doc.line(15, y + 2, 195, y + 2);
    y += 15;

    const transactionNodes = nodes.filter(n => n.type === 'transaction');
    doc.setFontSize(12);
    doc.text(`TOTAL TRANSACTIONS ANALYZED: ${transactionNodes.length}`, 15, y);
    y += 10;

    // Calculate transaction statistics
    let totalValue = 0;
    let highValueTxs = 0;
    let suspiciousTxs = 0;

    transactionNodes.forEach(tx => {
      const amount = parseFloat(tx.details?.amount?.split(' ')[0] || '0');
      totalValue += amount;
      if (amount > 1) highValueTxs++;
      if (tx.details?.risk_indicators?.length > 0) suspiciousTxs++;
    });

    doc.setFontSize(10);
    doc.text(`HIGH VALUE TXS (>1 BTC/ETH): ${highValueTxs}`, 15, y);
    doc.text(`FLAGGED SUSPICIOUS: ${suspiciousTxs}`, 110, y);
    y += 15;

    // Appendix: Technical Details
    if (y > 200) { doc.addPage(); y = 20; }
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 7, 12);
    doc.text('5. TECHNICAL APPENDIX', 15, y);
    doc.line(15, y + 2, 195, y + 2);
    y += 15;

    const performanceMetrics = osintService.getPerformanceMetrics();
    doc.setFontSize(10);
    doc.text(`OSINT Cache Hit Rate: ${performanceMetrics.cacheHitRate}`, 15, y);
    doc.text(`Total OSINT Queries: ${performanceMetrics.totalQueries}`, 15, y + 8);
    doc.text(`Analysis Timestamp: ${new Date().toISOString()}`, 15, y + 16);
    doc.text(`Blockchain Networks: Bitcoin, Ethereum`, 15, y + 24);
    doc.text(`OSINT Sources: GitHub, Pastebin, Reddit, Twitter, Threat DBs`, 15, y + 32);

    // Professional Footer for all pages
    const pages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`SOTANIK_AI PROFESSIONAL FORENSIC ANALYSIS | PAGE ${i} OF ${pages}`, 15, 290);
      doc.text('CONFIDENTIAL - AUTHORIZED PERSONNEL ONLY', 130, 290);
      
      // Add subtle footer line
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.3);
      doc.line(15, 287, 195, 287);
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    doc.save(`SOTANIK_FORENSIC_PROFESSIONAL_${rootNode?.id.substring(0, 12)}_${timestamp}.pdf`);
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
          blockchainService.getAddress(val).catch(e => { console.error('Address fetch error:', e); return null; }),
          blockchainService.getClusteringHints(val, isEth).catch(() => null),
          blockchainService.getDetailedAddressInfo(val).catch(() => null),
          blockchainService.getAddressTxs(val).catch(e => { console.error('Transactions fetch error:', e); return []; })
        ]);
        
        // Calculate comprehensive address statistics with proper error handling
        const stats = {
          total_received: addrData ? (isEth ? (addrData.chain_stats.funded_txo_sum/1e18).toFixed(8) : (addrData.chain_stats.funded_txo_sum/1e8).toFixed(8)) : "0",
          total_sent: addrData ? (isEth ? (addrData.chain_stats.spent_txo_sum/1e18).toFixed(8) : (addrData.chain_stats.spent_txo_sum/1e8).toFixed(8)) : "0",
          current_balance: addrData ? (isEth ? (addrData.chain_stats.funded_txo_sum/1e18).toFixed(8) : ((addrData.chain_stats.funded_txo_sum-addrData.chain_stats.spent_txo_sum)/1e8).toFixed(8)) : "0",
          transaction_count: addrData?.chain_stats.tx_count || recentTxs.length || 0,
          first_activity: recentTxs.length > 0 ? new Date(Math.min(...recentTxs.map(tx => tx.status?.block_time || Date.now()/1000)) * 1000).toLocaleDateString() : "Unknown",
          last_activity: recentTxs.length > 0 ? new Date(Math.max(...recentTxs.map(tx => tx.status?.block_time || Date.now()/1000)) * 1000).toLocaleDateString() : "Unknown",
          activity_days: calculateActivityDays(recentTxs),
          avg_tx_value: calculateAverageTransactionValue(recentTxs, isEth),
          address_age_days: calculateAddressAge(recentTxs)
        };
        
        console.log('Address statistics:', stats);
        
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
          expandNode(val, root.type, 3, 0, false), // Increased initial depth for more comprehensive scanning
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
            fee_analysis: txData.fee ? `${isEth ? (txData.fee/1e18).toFixed(8) : (txData.fee/1e8).toFixed(8)} ${unit}` : "N/A",
            fee_rate: txData.fee && txData.size ? `${(txData.fee / txData.size).toFixed(2)} sat/vB` : "N/A",
            block_info: txData.status?.block_height ? `Block ${txData.status.block_height}` : "Mempool",
            timestamp_analysis: txData.status?.block_time ? new Date(txData.status.block_time * 1000).toUTCString() : "Pending",
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
          expandNode(val, 'transaction', 3, 0, false), // Increased depth for transaction analysis
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
              <button onClick={startInvestigation} disabled={loading} className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-40 text-black px-8 h-12 rounded-2xl text-[10px] font-bold uppercase tracking-wide transition-all flex items-center gap-2">
                {loading ? <RefreshCw className="animate-spin" size={16} /> : <Zap size={16} />}
                {loading ? "SCANNING..." : "SCAN"}
              </button>
              {nodes.length > 0 && (
                <button onClick={generateReport} className="bg-slate-700/60 border border-slate-500/40 text-slate-200 hover:text-white hover:border-emerald-400/50 px-6 h-12 rounded-2xl text-[9px] font-bold uppercase tracking-wide transition-all flex items-center gap-2">
                  <Download size={14} /> REPORT
                </button>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {selectedNode && (
              <div className="flex items-center gap-2">
                <button onClick={() => handleOSINTSweep(selectedNode.id)} disabled={socialLoading} className="flex items-center gap-2 px-4 h-10 bg-rose-600/15 hover:bg-rose-500/25 border border-rose-400/40 rounded-xl text-[9px] font-bold text-rose-300 hover:text-rose-200 uppercase tracking-wide transition-all duration-200">
                  {socialLoading ? <RefreshCw size={12} className="animate-spin" /> : <Globe size={12} />} OSINT
                </button>
                
                <button onClick={handleDeepTrace} className={`flex items-center gap-2 px-4 h-10 rounded-xl text-[9px] font-bold uppercase tracking-wide transition-all duration-200 border ${deepLoading ? 'bg-red-600/25 border-red-400/50 text-red-200' : 'bg-sky-600/15 hover:bg-sky-500/25 border-sky-400/40 text-sky-300 hover:text-sky-200'}`}>
                  {deepLoading ? <RefreshCw size={12} className="animate-spin" /> : <Layers size={12} />} 
                  {deepLoading ? 'STOP' : 'DEEP'}
                </button>
                
                <button onClick={toggleHyperMode} className={`flex items-center gap-1 px-3 h-10 rounded-xl text-[8px] font-bold uppercase tracking-wide transition-all duration-200 border ${hyperMode ? 'bg-purple-600/25 border-purple-400/50 text-purple-200' : 'bg-purple-600/15 border-purple-400/40 text-purple-300'}`}>
                  <Zap size={10} /> HYPER
                </button>
                
                <div className="flex items-center gap-2 bg-slate-900/30 px-3 py-2 rounded-xl border border-slate-700/30">
                  <span className="text-[8px] font-bold text-slate-400">D:</span>
                  <input 
                    type="range" 
                    min="1" 
                    max="8" 
                    value={hyperMode ? 8 : scanDepth}
                    onChange={(e) => !hyperMode && setScanDepth(Number(e.target.value))}
                    disabled={hyperMode || deepLoading}
                    className="w-12 h-1 bg-slate-700 rounded slider"
                  />
                  <span className="text-[9px] font-bold text-emerald-400 w-2">{hyperMode ? 8 : scanDepth}</span>
                </div>
                
                <button 
                  onClick={() => setShowDateFilter(!showDateFilter)}
                  className={`text-[8px] font-bold px-2 py-2 rounded-lg transition-all ${showDateFilter ? 'bg-emerald-600/20 text-emerald-400' : 'text-slate-400 hover:text-slate-300'}`}
                >
                  📅
                </button>
                
                {showDateFilter && (
                  <div className="flex items-center gap-1">
                    <input 
                      type="date" 
                      value={dateFilter.startDate}
                      onChange={(e) => setDateFilter(prev => ({ ...prev, startDate: e.target.value }))}
                      className="text-[8px] bg-slate-800 border border-slate-600 rounded px-1 py-1 text-slate-300 w-24"
                    />
                    <input 
                      type="date" 
                      value={dateFilter.endDate}
                      onChange={(e) => setDateFilter(prev => ({ ...prev, endDate: e.target.value }))}
                      className="text-[8px] bg-slate-800 border border-slate-600 rounded px-1 py-1 text-slate-300 w-24"
                    />
                  </div>
                )}
              </div>
            )}
            {/* Performance indicator */}
            <div className="text-[8px] text-slate-500 font-mono bg-black/20 px-3 py-2 rounded-lg border border-white/5">
              <div className="text-emerald-400 font-bold">NO API LIMITS</div>
              <div>Cache: {osintService.getPerformanceMetrics().cacheHitRate}</div>
            </div>
            {nodes.length > 0 && (
              <button onClick={resetGraph} className="bg-gradient-to-r from-slate-800/80 to-slate-700/80 border-2 border-slate-600/50 text-slate-300 hover:text-white hover:border-slate-400/70 px-6 h-16 rounded-3xl transition-all duration-300 flex items-center justify-center shadow-xl backdrop-blur-sm">
                <RefreshCw size={20} />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 relative bg-[#020408] overflow-hidden">
          {nodes.length > 0 ? (
            <TransactionGraph 
              nodes={nodes} 
              links={links} 
              onNodeClick={setSelectedNode} 
              selectedNodeId={selectedNode?.id}
              scanningNodeId={scanningNodeId}
            />
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
            <div className="absolute top-4 right-4 w-72 bg-[#05070c]/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-4 shadow-xl animate-in fade-in slide-in-from-right-4 z-10 max-h-[90vh] overflow-y-auto scrollbar-hide">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <div className="bg-emerald-500/10 p-2 rounded-lg text-emerald-400"><Cpu size={14} /></div>
                  <h2 className="font-bold text-[10px] tracking-wide uppercase text-white">NODE_DATA</h2>
                </div>
                <button 
                  onClick={() => setSelectedNode(null)} 
                  className="text-slate-500 hover:text-white transition-colors hover:bg-white/10 p-1 rounded"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-3 bg-[#0a0d14] border border-white/10 rounded-xl break-all mono text-[10px] text-emerald-400 font-bold leading-relaxed shadow-inner">
                  {selectedNode.id}
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                    <span className="text-[8px] uppercase font-bold text-slate-500 block">TYPE</span>
                    <span className="text-[10px] font-bold text-slate-100 uppercase block">{selectedNode.type.replace('_', ' ')}</span>
                  </div>
                  <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                    <span className="text-[8px] uppercase font-bold text-slate-500 block">RISK</span>
                    <span className={`text-[10px] font-bold uppercase block ${selectedNode.riskScore > 50 ? 'text-rose-400' : 'text-emerald-500'}`}>{selectedNode.riskScore ?? 0}/100</span>
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
                      
                      <div className="flex flex-col gap-3">
                        <a href={selectedNode.details.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-5 bg-gradient-to-r from-slate-700/80 to-slate-600/80 border-2 border-slate-500/40 rounded-2xl hover:from-emerald-600/20 hover:to-emerald-500/20 hover:border-emerald-400/50 transition-all duration-300 text-[11px] font-black uppercase text-slate-200 hover:text-emerald-200 shadow-lg group backdrop-blur-sm">
                          {selectedNode.details.match_type === 'github_commit' ? 'EXAMINE_COMMIT' : 'PIVOT_TO_SOURCE'} <ExternalLink size={16} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                        </a>
                        {selectedNode.details.repo_url && (
                           <a href={selectedNode.details.repo_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-5 bg-gradient-to-r from-sky-700/80 to-sky-600/80 border-2 border-sky-500/40 rounded-2xl hover:from-sky-600/30 hover:to-sky-500/30 hover:border-sky-400/60 transition-all duration-300 text-[11px] font-black uppercase text-sky-200 hover:text-sky-100 shadow-lg group backdrop-blur-sm">
                             INSPECT_REPOSITORY <Github size={16} className="group-hover:scale-110 transition-transform" />
                           </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <label className="text-[8px] uppercase tracking-wide text-slate-600 font-bold flex items-center gap-1">
                    <Activity size={10} className="text-slate-500" /> WALLET_DATA
                  </label>
                  
                  {/* Display balance prominently */}
                  {(selectedNode.details?.balance || selectedNode.details?.current_balance) && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                      <div className="text-[8px] font-bold text-emerald-400 uppercase mb-1">CURRENT BALANCE</div>
                      <div className="text-sm font-bold text-emerald-300">{selectedNode.details.balance || selectedNode.details.current_balance}</div>
                    </div>
                  )}
                  
                  {/* Display transaction count and other key metrics */}
                  {selectedNode.details?.transaction_count && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2">
                        <div className="text-[7px] text-blue-400 font-bold uppercase">TX COUNT</div>
                        <div className="text-xs font-bold text-blue-300">{selectedNode.details.transaction_count}</div>
                      </div>
                      {selectedNode.details.total_received && (
                        <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-2">
                          <div className="text-[7px] text-green-400 font-bold uppercase">RECEIVED</div>
                          <div className="text-xs font-bold text-green-300">{selectedNode.details.total_received}</div>
                        </div>
                      )}
                    </div>
                  )}
                  
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
                  
                  <div className="grid grid-cols-1 gap-1">
                    {Object.entries(selectedNode.details || {}).map(([key, val]) => {
                      // Skip keys that are already displayed
                      if (['identifier', 'status', 'osint', 'context', 'url', 'type', 'category', 'tier', 'balance', 'current_balance', 'clustering_label', 'identity_pivot', 'net_balance', 'forensic_tier', 'threat_risk', 'entity_type', 'confidence', 'parent_wallet', 'flow_captured', 'role', 'flow', 'source_engine', 'extracted', 'origin_paste', 'forensic_role', 'flow_value', 'repo', 'path', 'repo_url', 'repo_desc', 'match_type', 'risk_indicators', 'privacy_score', 'complexity_score', 'complexity_rating', 'total_inputs', 'total_outputs', 'input_amount', 'amount', 'address_analysis', 'activity_days', 'transaction_count', 'avg_tx_value', 'network_type', 'total_received', 'total_sent'].includes(key)) return null;
                      return (
                        <div key={key} className="flex items-center justify-between p-2 bg-white/5 border border-white/5 rounded-lg text-[8px]">
                          <span className="uppercase font-bold text-slate-500 truncate">{key.replace(/_/g, ' ')}</span>
                          <span className="font-bold text-slate-300 truncate ml-2">{String(val).substring(0, 20)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-8 border-t border-white/5 flex gap-3">
                   <button onClick={() => deleteNode(selectedNode.id)} className="flex-1 h-16 bg-gradient-to-r from-rose-600/15 to-rose-500/15 border-2 border-rose-400/30 text-rose-300 hover:text-rose-200 hover:border-rose-400/50 rounded-3xl flex items-center justify-center gap-3 text-[11px] font-black uppercase tracking-[0.1em] hover:from-rose-500/20 hover:to-rose-400/20 transition-all duration-300 shadow-lg backdrop-blur-sm">
                     <Trash2 size={18} /> REMOVE_NODE
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