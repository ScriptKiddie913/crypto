import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { NodeData, LinkData } from '../types';

interface D3Node extends NodeData {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  value: number;
  label?: string;
}

interface Props {
  nodes: NodeData[];
  links: LinkData[];
  onNodeClick: (node: NodeData) => void;
  selectedNodeId?: string;
}

const ICONS = {
  ROOT: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  WALLET: "M19,7H5C3.89,7,3,7.89,3,9v10c0,1.1,0.89,2,2,2h14c1.1,0,2-0.9,2-2V9C21,7.89,20.11,7,19,7z M19,19H5V9h14V19z M17,12h-2v2h2V12z",
  TX: "M7,12h10 M14,8l4,4l-4,4 M10,16l-4-4l4-4", 
  BLOCK: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
  EVM: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  SOCIAL: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
  GITHUB: "M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.218.682-.484 0-.236-.009-.866-.014-1.699-2.782.602-3.369-1.341-3.369-1.341-.454-1.152-1.11-1.46-1.11-1.46-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.011 10.011 0 0022 12c0-5.523-4.477-10-10-10z",
  INTEL: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M12 8v4 M12 16h.01"
};

const getNodeColor = (d: NodeData) => {
  if (d.isRoot) return '#f97316'; 
  if (d.type === 'address') return '#38bdf8';
  if (d.type === 'eth_address') return '#c084fc';
  if (d.type === 'transaction') return '#34d399';
  if (d.type === 'social') return '#06b6d4';
  if (d.type === 'github') return '#ffffff';
  if (d.type === 'osint_confirmed') return '#ef4444';
  return '#fcd34d';
};

const getNodeFilter = (d: NodeData) => {
  if (d.isRoot) return 'url(#backlit-root)'; 
  if (d.type === 'address') return 'url(#backlit-address)';
  if (d.type === 'eth_address') return 'url(#backlit-eth)';
  if (d.type === 'transaction') return 'url(#backlit-tx)';
  if (d.type === 'social') return 'url(#backlit-social)';
  if (d.type === 'github') return 'url(#backlit-github)';
  if (d.type === 'osint_confirmed') return 'url(#backlit-intel)';
  return 'url(#backlit-default)';
};

const TransactionGraph: React.FC<Props> = ({ nodes, links, onNodeClick, selectedNodeId }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, undefined> | null>(null);
  const [hoveredNode, setHoveredNode] = useState<NodeData | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svg = d3.select(svgRef.current);
    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    let defs = svg.select("defs");
    if (defs.empty()) {
      defs = svg.append("defs");
      const createNeonFilter = (id: string, color: string, deviation: number = 3) => {
        const filter = defs.append("filter").attr("id", id).attr("x", "-100%").attr("y", "-100%").attr("width", "300%").attr("height", "300%");
        filter.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", deviation).attr("result", "blur");
        const merge = filter.append("feMerge");
        merge.append("feMergeNode").attr("in", "blur");
        merge.append("feMergeNode").attr("in", "SourceGraphic");
      };
      createNeonFilter("backlit-root", "#f97316", 12);
      createNeonFilter("backlit-address", "#38bdf8", 8);
      createNeonFilter("backlit-eth", "#c084fc", 8);
      createNeonFilter("backlit-tx", "#34d399", 8);
      createNeonFilter("backlit-social", "#06b6d4", 8);
      createNeonFilter("backlit-github", "#ffffff", 6);
      createNeonFilter("backlit-intel", "#ef4444", 10);
      createNeonFilter("backlit-default", "#fcd34d", 8);
      createNeonFilter("backlit-line", "#cbd5e1", 1.5); 
    }

    let g = svg.select<SVGGElement>("g.main-container");
    if (g.empty()) {
      g = svg.append("g").attr("class", "main-container");
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.05, 10])
        .on("zoom", (event) => g.attr("transform", event.transform));
      svg.call(zoom);
      // Start slightly zoomed out
      svg.call(zoom.transform, d3.zoomIdentity.translate(width / 4, height / 4).scale(0.6));
    }

    let linkLayer = g.select<SVGGElement>("g.links");
    if (linkLayer.empty()) linkLayer = g.append("g").attr("class", "links").style("pointer-events", "none");

    let nodeLayer = g.select<SVGGElement>("g.nodes");
    if (nodeLayer.empty()) nodeLayer = g.append("g").attr("class", "nodes");

    if (!simulationRef.current) {
      simulationRef.current = d3.forceSimulation<D3Node>()
        .force("link", d3.forceLink<D3Node, D3Link>().id((d: D3Node) => d.id).distance(250))
        .force("charge", d3.forceManyBody().strength(-3500))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("x", d3.forceX(width / 2).strength(0.08))
        .force("y", d3.forceY(height / 2).strength(0.08))
        .force("collision", d3.forceCollide().radius(110));
    }

    const simulation = simulationRef.current;
    
    // Sync current node positions to prevent "jumping" when new nodes are added
    const currentNodes = simulation.nodes() as D3Node[];
    const nodesMap = new Map(currentNodes.map(n => [n.id, n]));
    
    const nodesCopy: D3Node[] = nodes.map(d => {
      const existing = nodesMap.get(d.id);
      return existing ? { ...d, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy } : { ...d };
    });
    
    const linksCopy: D3Link[] = links.map(d => ({ ...d }));

    simulation.nodes(nodesCopy);
    (simulation.force("link") as d3.ForceLink<D3Node, D3Link>).links(linksCopy);

    const link = linkLayer.selectAll<SVGLineElement, D3Link>("line")
      .data(linksCopy, (d: any) => `${d.source.id || d.source}-${d.target.id || d.target}`)
      .join("line")
      .attr("stroke", "rgba(226, 232, 240, 0.12)") 
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", d => d.value > 2 ? "none" : "5,5")
      .attr("filter", "url(#backlit-line)");

    const node = nodeLayer.selectAll<SVGGElement, D3Node>("g.node")
      .data(nodesCopy, d => d.id)
      .join(
        enter => {
          const gEnter = enter.append("g")
            .attr("class", "node")
            .style("cursor", "pointer")
            .on("click", (event, d) => onNodeClick(d))
            .on("mouseover", (event, d) => {
              setHoveredNode(d);
              setTooltipPos({ x: event.clientX, y: event.clientY });
            })
            .on("mousemove", (event) => {
              setTooltipPos({ x: event.clientX, y: event.clientY });
            })
            .on("mouseout", () => setHoveredNode(null))
            .call(d3.drag<any, D3Node>()
              .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
              })
              .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
              .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null; d.fy = null;
              }));

          gEnter.append("circle").attr("class", "selection-ring").attr("r", 50).attr("fill", "none").attr("stroke", "#10b981").attr("stroke-width", 3).style("opacity", 0);
          gEnter.append("circle").attr("class", "halo").attr("r", 36).attr("fill", "none").attr("stroke-width", 3).attr("stroke-opacity", 0.9);
          gEnter.append("circle").attr("class", "core-glass").attr("r", 32).attr("fill", "#05070c").attr("stroke", "rgba(255,255,255,0.1)");

          gEnter.append("path")
            .attr("class", "neon-icon")
            .attr("d", d => {
              if (d.isRoot) return ICONS.ROOT;
              if (d.type === 'address') return ICONS.WALLET;
              if (d.type === 'eth_address') return ICONS.EVM;
              if (d.type === 'transaction') return ICONS.TX;
              if (d.type === 'social') return ICONS.SOCIAL;
              if (d.type === 'github') return ICONS.GITHUB;
              if (d.type === 'osint_confirmed') return ICONS.INTEL;
              return ICONS.WALLET;
            })
            .attr("fill", "none")
            .attr("stroke-width", 3)
            .attr("transform", "translate(-14, -14) scale(1.2)");

          gEnter.append("text")
            .attr("dy", 60)
            .attr("text-anchor", "middle")
            .attr("fill", "#94a3b8")
            .attr("font-size", "12px")
            .attr("font-weight", "800")
            .attr("class", "uppercase tracking-widest pointer-events-none drop-shadow-lg")
            .text(d => d.label);

          return gEnter;
        }
      );

    // Update styling for existing nodes
    node.select("circle.selection-ring").style("opacity", d => d.id === selectedNodeId ? 1 : 0);
    node.select("circle.halo").attr("stroke", d => getNodeColor(d)).attr("filter", d => getNodeFilter(d));
    node.select("path.neon-icon").attr("stroke", d => getNodeColor(d)).attr("filter", d => getNodeFilter(d));

    simulation.on("tick", () => {
      link.attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y).attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    simulation.alpha(0.5).restart();
  }, [nodes, links, onNodeClick, selectedNodeId]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-transparent overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />
      
      <div className="absolute bottom-10 left-10 flex flex-col gap-4 bg-[#05070c]/95 backdrop-blur-3xl p-8 rounded-[2.5rem] border border-white/5 shadow-2xl z-20 pointer-events-none border-l-4" style={{ borderColor: 'rgba(16, 185, 129, 0.4)' }}>
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.5em] mb-4 opacity-70">INDEX</h4>
        <div className="space-y-4">
          <LegendItem color="#f97316" label="ROOT_TARGET" icon={ICONS.ROOT} />
          <LegendItem color="#ef4444" label="OSINT_HIT" icon={ICONS.INTEL} />
          <LegendItem color="#ffffff" label="GIT_SOURCE" icon={ICONS.GITHUB} />
          <LegendItem color="#06b6d4" label="SOCIAL_INTEL" icon={ICONS.SOCIAL} />
          <LegendItem color="#38bdf8" label="BTC_WALLET" icon={ICONS.WALLET} />
          <LegendItem color="#c084fc" label="ETH_WALLET" icon={ICONS.EVM} />
          <LegendItem color="#34d399" label="TRANSACTION" icon={ICONS.TX} />
        </div>
      </div>

      {hoveredNode && (
        <div className="fixed pointer-events-none z-50 bg-[#05070c]/98 backdrop-blur-3xl border border-white/10 rounded-2xl p-6 shadow-2xl min-w-[300px] animate-in fade-in zoom-in-95 duration-150" style={{ left: tooltipPos.x + 24, top: tooltipPos.y + 24 }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-4 h-4 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.4)]" style={{ backgroundColor: getNodeColor(hoveredNode) }} />
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">{hoveredNode.type.replace('_', ' ')}</span>
          </div>
          <p className="text-[14px] mono text-white font-bold break-all leading-relaxed mb-4">{hoveredNode.id}</p>
          {hoveredNode.details?.context && (
            <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl border-l-4 border-emerald-400/50">
               <p className="text-[12px] text-emerald-400 leading-relaxed font-semibold italic">"{hoveredNode.details.context}"</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const LegendItem = ({ color, label, icon }: { color: string, label: string, icon: string }) => (
  <div className="flex items-center gap-5">
    <div className="w-10 h-10 rounded-2xl border border-white/5 flex items-center justify-center bg-white/5 shadow-inner" style={{ color: color }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={icon} />
      </svg>
    </div>
    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em] leading-none">{label}</span>
  </div>
);

export default TransactionGraph;