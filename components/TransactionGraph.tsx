import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { NodeData, LinkData } from '../types';

interface D3Node extends NodeData, d3.SimulationNodeDatum {}
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

// Forensic Icons - Refined for stroke-based neon rendering
const ICONS = {
  ROOT: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  WALLET: "M19,7H5C3.89,7,3,7.89,3,9v10c0,1.1,0.89,2,2,2h14c1.1,0,2-0.9,2-2V9C21,7.89,20.11,7,19,7z M19,19H5V9h14V19z M17,12h-2v2h2V12z",
  TX: "M7,12h10 M14,8l4,4l-4,4 M10,16l-4-4l4-4", 
  BLOCK: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
  EVM: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
};

const TransactionGraph: React.FC<Props> = ({ nodes, links, onNodeClick, selectedNodeId }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, undefined> | null>(null);
  const [hoveredNode, setHoveredNode] = useState<NodeData | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    let defs = svg.select("defs");
    if (defs.empty()) {
      defs = svg.append("defs");
      
      const createNeonFilter = (id: string, color: string) => {
        const filter = defs.append("filter")
          .attr("id", id)
          .attr("x", "-100%")
          .attr("y", "-100%")
          .attr("width", "300%")
          .attr("height", "300%");
        filter.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "6").attr("result", "blur6");
        filter.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "3").attr("result", "blur3");
        filter.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "1").attr("result", "blur1");
        const merge = filter.append("feMerge");
        merge.append("feMergeNode").attr("in", "blur6");
        merge.append("feMergeNode").attr("in", "blur3");
        merge.append("feMergeNode").attr("in", "blur1");
        merge.append("feMergeNode").attr("in", "SourceGraphic");
      };

      createNeonFilter("backlit-root", "#f97316");
      createNeonFilter("backlit-address", "#38bdf8");
      createNeonFilter("backlit-eth", "#c084fc");
      createNeonFilter("backlit-tx", "#34d399");
      createNeonFilter("backlit-default", "#fcd34d");
    }

    let g = svg.select<SVGGElement>("g.main-container");
    if (g.empty()) {
      g = svg.append("g").attr("class", "main-container");
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 8])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        });
      svg.call(zoom);
    }

    let linkLayer = g.select<SVGGElement>("g.links");
    if (linkLayer.empty()) linkLayer = g.append("g").attr("class", "links").attr("stroke-opacity", 1.0);

    let nodeLayer = g.select<SVGGElement>("g.nodes");
    if (nodeLayer.empty()) nodeLayer = g.append("g").attr("class", "nodes");

    if (!simulationRef.current) {
      simulationRef.current = d3.forceSimulation<D3Node>()
        .force("link", d3.forceLink<D3Node, D3Link>().id((d: D3Node) => d.id).distance(220))
        .force("charge", d3.forceManyBody().strength(-2000))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(120));
    }

    const simulation = simulationRef.current;
    const nodesCopy: D3Node[] = nodes.map(d => {
      const existing = simulation.nodes().find(ex => ex.id === d.id);
      return existing ? { ...d, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy, fx: existing.fx, fy: existing.fy } : { ...d };
    });
    const linksCopy: D3Link[] = links.map(d => ({ source: d.source, target: d.target, value: d.value, label: d.label }));

    simulation.nodes(nodesCopy);
    (simulation.force("link") as d3.ForceLink<D3Node, D3Link>).links(linksCopy);

    const link = linkLayer.selectAll<SVGLineElement, D3Link>("line")
      .data(linksCopy, (d: any) => `${d.source.id || d.source}-${d.target.id || d.target}`)
      .join("line")
      .attr("stroke", "#94a3b8") // Brighter slate for high visibility
      .attr("stroke-width", 2.0) // Thicker line
      .attr("stroke-dasharray", "5 5");

    const getNodeColor = (d: NodeData) => {
      if (d.isRoot) return '#f97316'; 
      if (d.type === 'address') return '#38bdf8';
      if (d.type === 'eth_address') return '#c084fc';
      if (d.type === 'transaction') return '#34d399';
      return '#fcd34d';
    };

    const getNodeFilter = (d: NodeData) => {
      if (d.isRoot) return 'url(#backlit-root)'; 
      if (d.type === 'address') return 'url(#backlit-address)';
      if (d.type === 'eth_address') return 'url(#backlit-eth)';
      if (d.type === 'transaction') return 'url(#backlit-tx)';
      return 'url(#backlit-default)';
    };

    const node = nodeLayer.selectAll<SVGGElement, D3Node>("g.node")
      .data(nodesCopy, d => d.id)
      .join(
        enter => {
          const gEnter = enter.append("g")
            .attr("class", "node")
            .style("cursor", "crosshair")
            .on("click", (event, d) => onNodeClick(d))
            .on("mouseover", (event, d) => {
              setHoveredNode(d);
              const rect = event.currentTarget.getBoundingClientRect();
              setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
            })
            .on("mousemove", (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
            })
            .on("mouseout", () => setHoveredNode(null))
            .call(d3.drag<any, D3Node>()
              .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.1).restart();
                d.fx = d.x; d.fy = d.y;
              })
              .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
              .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null; d.fy = null;
              }));

          // Static Red Selection Ring
          gEnter.append("circle")
            .attr("class", "selection-ring")
            .attr("r", 44)
            .attr("fill", "transparent")
            .attr("stroke", "#ef4444")
            .attr("stroke-width", 3)
            .style("opacity", 0)
            .style("pointer-events", "none");

          // Outer Halo
          gEnter.append("circle")
            .attr("class", "halo")
            .attr("r", 36)
            .attr("fill", "transparent")
            .attr("stroke-width", 3);

          // Core
          gEnter.append("circle")
            .attr("class", "core-glass")
            .attr("r", 28)
            .attr("fill", "#05070c")
            .attr("stroke", "rgba(255,255,255,0.05)")
            .attr("stroke-width", 1);

          // Icon
          gEnter.append("path")
            .attr("class", "neon-icon")
            .attr("d", d => {
              if (d.isRoot) return ICONS.ROOT;
              if (d.type === 'address') return ICONS.WALLET;
              if (d.type === 'eth_address') return ICONS.EVM;
              if (d.type === 'transaction') return ICONS.TX;
              return ICONS.WALLET;
            })
            .attr("fill", "none")
            .attr("stroke-width", 2.2)
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("transform", "translate(-12, -12)");

          gEnter.append("text")
            .attr("dy", 55)
            .attr("text-anchor", "middle")
            .attr("fill", "#64748b")
            .attr("font-size", "10px")
            .attr("font-weight", "800")
            .attr("font-family", "'JetBrains Mono', monospace")
            .text(d => d.label);

          return gEnter;
        }
      );

    node.select("circle.selection-ring")
      .transition().duration(200)
      .style("opacity", d => d.id === selectedNodeId ? 1 : 0);

    node.select("circle.halo")
      .attr("stroke", d => getNodeColor(d))
      .attr("filter", d => getNodeFilter(d))
      .attr("stroke-opacity", 0.6);

    node.select("path.neon-icon")
      .attr("stroke", d => getNodeColor(d))
      .attr("filter", d => getNodeFilter(d));

    simulation.on("tick", () => {
      link.attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    simulation.alpha(0.3).restart();
  }, [nodes, links, onNodeClick, selectedNodeId]);

  return (
    <div className="w-full h-full bg-[#020408] relative overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />
      
      {/* Compact Legend in bottom-left corner */}
      <div className="absolute bottom-6 left-6 flex flex-col gap-4 bg-[#05070c]/90 backdrop-blur-2xl p-6 rounded-[2rem] border border-white/5 pointer-events-none shadow-2xl z-20">
        <h4 className="text-[8px] font-black text-slate-500 uppercase tracking-[0.5em] mb-2 leading-none opacity-80">I N V E S T I G A T I O N _ C O R E</h4>
        <div className="space-y-4">
          <LegendItem icon={ICONS.ROOT} color="#f97316" label="INITIAL QUERY" shadow="0 0 10px rgba(249,115,22,0.3)" />
          <LegendItem icon={ICONS.WALLET} color="#38bdf8" label="WALLET" shadow="0 0 10px rgba(56,189,248,0.3)" />
          <LegendItem icon={ICONS.TX} color="#34d399" label="TX" shadow="0 0 10px rgba(52,211,153,0.3)" />
          <LegendItem icon={ICONS.EVM} color="#c084fc" label="EVM" shadow="0 0 10px rgba(192,132,252,0.3)" />
        </div>
      </div>

      {hoveredNode && (
        <div 
          className="fixed pointer-events-none z-50 animate-in fade-in zoom-in-95 duration-200"
          style={{ 
            left: tooltipPos.x, 
            top: tooltipPos.y - 15, 
            transform: 'translate(-50%, -100%)' 
          }}
        >
          <div className="bg-[#05070c]/98 backdrop-blur-3xl border border-white/10 rounded-[1.5rem] p-6 shadow-[0_0_50px_rgba(0,0,0,0.9)] min-w-[320px] max-w-[480px]">
             <div className="flex justify-between items-start gap-8">
                <div className="flex flex-col gap-1 overflow-hidden">
                   <div className="flex items-center gap-2 mb-1">
                      <div 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: getNodeColor(hoveredNode), boxShadow: `0 0 10px ${getNodeColor(hoveredNode)}` }} 
                      />
                      <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">TRACE_ID</span>
                   </div>
                   <p className="text-[11px] mono text-sky-400 font-bold break-all leading-snug">
                      {hoveredNode.id}
                    </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                   <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">RISK</span>
                   <span 
                    className={`text-lg font-black ${(hoveredNode.riskScore || 0) > 50 ? 'text-rose-500' : 'text-emerald-500'}`} 
                    style={{ textShadow: `0 0 12px ${(hoveredNode.riskScore || 0) > 50 ? 'rgba(244,63,94,0.5)' : 'rgba(16,185,129,0.5)'}` }}
                   >
                      {hoveredNode.riskScore !== undefined ? `${hoveredNode.riskScore}%` : 'N/A'}
                   </span>
                </div>
             </div>

             <div className="border-t border-white/5 pt-4 mt-4">
                <div className="flex flex-col gap-1">
                   <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">AMOUNT / BALANCE</span>
                   <span className="text-[12px] font-black text-white uppercase truncate" style={{ textShadow: '0 0 8px rgba(255,255,255,0.3)' }}>
                      {hoveredNode.details?.balance || hoveredNode.details?.amount || hoveredNode.details?.inflow_amount || 'INDETERMINATE'}
                   </span>
                </div>
             </div>
          </div>
          <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-[#05070c] mx-auto filter drop-shadow(0 2px 2px rgba(0,0,0,0.5))"></div>
        </div>
      )}
    </div>
  );
};

const LegendItem = ({ icon, color, label, shadow }: { icon: string, color: string, label: string, shadow: string }) => (
  <div className="flex items-center gap-4">
    <div className="w-8 h-8 rounded-xl bg-black/40 flex items-center justify-center border border-white/5" style={{ boxShadow: shadow }}>
       <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
         <path d={icon} />
       </svg>
    </div>
    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</span>
  </div>
);

const getNodeColor = (d: NodeData) => {
  if (d.isRoot) return '#f97316'; 
  if (d.type === 'address') return '#38bdf8';
  if (d.type === 'eth_address') return '#c084fc';
  if (d.type === 'transaction') return '#34d399';
  return '#fcd34d';
};

export default TransactionGraph;