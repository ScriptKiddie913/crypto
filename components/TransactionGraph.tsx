import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Crosshair } from 'lucide-react';
import { NodeData, LinkData } from '../types';

interface Props {
  nodes: NodeData[];
  links: LinkData[];
  onNodeClick: (node: NodeData) => void;
  selectedNodeId?: string;
}

const TransactionGraph: React.FC<Props> = ({ nodes, links, onNodeClick, selectedNodeId }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<any, undefined> | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    
    let g = svg.select<SVGGElement>("g.main-container");
    if (g.empty()) {
      g = svg.append("g").attr("class", "main-container");
      
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.05, 5])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        });

      svg.call(zoom);
    }

    let linkLayer = g.select<SVGGElement>("g.links");
    if (linkLayer.empty()) {
      linkLayer = g.append("g")
        .attr("class", "links")
        .attr("stroke-opacity", 0.5);
    }

    let nodeLayer = g.select<SVGGElement>("g.nodes");
    if (nodeLayer.empty()) nodeLayer = g.append("g").attr("class", "nodes");

    if (!simulationRef.current) {
      simulationRef.current = d3.forceSimulation<any>()
        .force("link", d3.forceLink<any, any>().id((d: any) => d.id).distance(220))
        .force("charge", d3.forceManyBody().strength(-1200))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(100));
    }

    const simulation = simulationRef.current;
    if (!simulation) return;

    simulation.nodes(nodes);
    const linkForce = simulation.force("link") as d3.ForceLink<any, any> | undefined;
    if (linkForce) linkForce.links(links);

    const link = linkLayer.selectAll("line")
      .data(links, (d: any) => `${d.source.id || d.source}-${d.target.id || d.target}`)
      .join("line")
      .attr("stroke", "#1e293b")
      .attr("stroke-width", (d: any) => (d.value || 1) * 2)
      .attr("opacity", 0.7);

    const node = nodeLayer.selectAll<SVGGElement, NodeData>("g.node")
      .data(nodes, d => d.id)
      .join(
        enter => {
          const gEnter = enter.append("g")
            .attr("class", "node")
            .style("cursor", "crosshair")
            .on("click", (event, d) => {
              if (event.defaultPrevented) return;
              onNodeClick(d);
            })
            .call(d3.drag<any, any>()
              .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
              })
              .on("drag", (event, d) => {
                d.fx = event.x;
                d.fy = event.y;
              })
              .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
              }));

          gEnter.append("circle")
            .attr("class", "glow")
            .attr("r", 40)
            .attr("fill", "transparent")
            .attr("stroke-width", 2)
            .attr("stroke", "transparent");

          gEnter.append("circle")
            .attr("class", "main-circle")
            .attr("r", 32)
            .attr("fill", d => {
              if (d.type === 'address') return '#0284c7';
              if (d.type === 'eth_address') return '#7c3aed';
              if (d.type === 'transaction') return '#059669';
              if (d.type === 'entity') return '#e11d48';
              return '#d97706';
            })
            .attr("stroke", "#020408")
            .attr("stroke-width", 3);

          gEnter.append("text")
            .attr("dy", 52)
            .attr("text-anchor", "middle")
            .attr("fill", "#94a3b8")
            .attr("font-size", "11px")
            .attr("font-weight", "800")
            .attr("font-family", "JetBrains Mono, monospace")
            .text(d => d.label);

          return gEnter;
        },
        update => update
      );

    node.select("circle.glow")
      .attr("stroke", d => d.id === selectedNodeId ? "rgba(16, 185, 129, 0.4)" : "transparent")
      .attr("stroke-dasharray", d => d.id === selectedNodeId ? "4 4" : null);

    node.select("circle.main-circle")
      .attr("stroke", d => d.id === selectedNodeId ? "#10b981" : "#020408")
      .attr("stroke-width", d => d.id === selectedNodeId ? 6 : 3);

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    simulation.alpha(0.4).restart();

  }, [nodes, links, onNodeClick, selectedNodeId]);

  return (
    <div className="w-full h-full bg-black/10 relative overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />
      <div className="absolute bottom-12 left-12 flex flex-col gap-4 bg-[#05070c]/80 backdrop-blur-3xl p-8 rounded-[2.5rem] border border-white/5 pointer-events-none shadow-2xl">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em] mb-2">Forensic Key</h4>
        <div className="grid grid-cols-2 gap-x-10 gap-y-4">
          <div className="flex items-center gap-4">
            <div className="w-3 h-3 rounded-full bg-sky-600 shadow-[0_0_10px_rgba(2,132,199,0.5)]"></div>
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Ledger Wallet</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-3 h-3 rounded-full bg-emerald-600 shadow-[0_0_10px_rgba(5,150,105,0.5)]"></div>
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Verified TX</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-3 h-3 rounded-full bg-rose-600 shadow-[0_0_10px_rgba(225,29,72,0.5)]"></div>
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Institutional</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-3 h-3 rounded-full bg-violet-600 shadow-[0_0_10px_rgba(124,58,237,0.5)]"></div>
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">EVM Account</span>
          </div>
        </div>
      </div>
      <div className="absolute top-12 right-12 flex items-center gap-4 bg-emerald-500/5 backdrop-blur-md p-5 px-8 rounded-full border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-[0.3em] pointer-events-none">
        <Crosshair size={14} className="animate-pulse" />
        Spatially Resolving Network Links
      </div>
    </div>
  );
};

export default TransactionGraph;