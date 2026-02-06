import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
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
    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    let g = svg.select<SVGGElement>("g.main-container");
    if (g.empty()) {
      g = svg.append("g").attr("class", "main-container");
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        });
      svg.call(zoom);
    }

    let linkLayer = g.select<SVGGElement>("g.links");
    if (linkLayer.empty()) linkLayer = g.append("g").attr("class", "links").attr("stroke-opacity", 0.4);

    let nodeLayer = g.select<SVGGElement>("g.nodes");
    if (nodeLayer.empty()) nodeLayer = g.append("g").attr("class", "nodes");

    // Initialize or Update Simulation
    if (!simulationRef.current) {
      simulationRef.current = d3.forceSimulation<any>()
        .force("link", d3.forceLink<any, any>().id((d: any) => d.id).distance(180))
        .force("charge", d3.forceManyBody().strength(-1500))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(80));
    }

    const simulation = simulationRef.current;
    
    // Crucial: Create deep copies of nodes/links to prevent D3 internal mutations 
    // from conflicting with React's immutability principles in subsequent renders
    const nodesCopy = nodes.map(d => ({ ...d }));
    const linksCopy = links.map(d => ({ ...d }));

    simulation.nodes(nodesCopy);
    const linkForce = simulation.force("link") as d3.ForceLink<any, any>;
    linkForce.links(linksCopy);

    const link = linkLayer.selectAll<SVGLineElement, any>("line")
      .data(linksCopy, (d: any) => `${d.source.id || d.source}-${d.target.id || d.target}`)
      .join("line")
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", (d: any) => d.value > 1 ? "4 2" : null);

    const node = nodeLayer.selectAll<SVGGElement, any>("g.node")
      .data(nodesCopy, d => d.id)
      .join(
        enter => {
          const gEnter = enter.append("g")
            .attr("class", "node")
            .style("cursor", "crosshair")
            .on("click", (event, d) => {
              if (event.defaultPrevented) return;
              // Map back to original node data for the callback
              const original = nodes.find(n => n.id === d.id);
              if (original) onNodeClick(original);
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
            .attr("stroke-width", 2);

          gEnter.append("circle")
            .attr("class", "main-circle")
            .attr("r", 28)
            .attr("fill", d => {
              if (d.type === 'address') return '#0284c7';
              if (d.type === 'eth_address') return '#7c3aed';
              if (d.type === 'transaction') return '#059669';
              if (d.type === 'entity') return '#e11d48';
              return '#f59e0b';
            })
            .attr("stroke", "#020408")
            .attr("stroke-width", 2);

          gEnter.append("text")
            .attr("dy", 48)
            .attr("text-anchor", "middle")
            .attr("fill", "#cbd5e1")
            .attr("font-size", "10px")
            .attr("font-weight", "600")
            .attr("font-family", "'JetBrains Mono', monospace")
            .text(d => d.label);

          return gEnter;
        },
        update => update
      );

    // Update selection indicators
    node.select("circle.glow")
      .attr("stroke", d => d.id === selectedNodeId ? "rgba(16, 185, 129, 0.4)" : "transparent")
      .attr("stroke-dasharray", d => d.id === selectedNodeId ? "4 4" : null);

    node.select("circle.main-circle")
      .attr("stroke", d => d.id === selectedNodeId ? "#10b981" : "#020408")
      .attr("stroke-width", d => d.id === selectedNodeId ? 4 : 2);

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    simulation.alpha(1).restart();

  }, [nodes, links, onNodeClick, selectedNodeId]);

  return (
    <div className="w-full h-full bg-black/10 relative overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />
      <div className="absolute bottom-10 left-10 flex flex-col gap-3 bg-[#05070c]/90 backdrop-blur-2xl p-6 rounded-[2rem] border border-white/5 pointer-events-none shadow-2xl">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mb-1">Investigation Key</h4>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-600"></div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Wallet</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-600"></div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Transaction</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-violet-600"></div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">EVM Account</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-600"></div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Block</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransactionGraph;
