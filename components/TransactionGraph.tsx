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
    if (!svgRef.current || nodes.length === 0) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const svg = d3.select(svgRef.current);
    
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
    if (linkLayer.empty()) linkLayer = g.append("g").attr("class", "links").attr("stroke-opacity", 0.3);

    let nodeLayer = g.select<SVGGElement>("g.nodes");
    if (nodeLayer.empty()) nodeLayer = g.append("g").attr("class", "nodes");

    if (!simulationRef.current) {
      simulationRef.current = d3.forceSimulation<any>()
        .force("link", d3.forceLink<any, any>().id((d: any) => d.id).distance(200))
        .force("charge", d3.forceManyBody().strength(-2000))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(100));
    }

    const simulation = simulationRef.current;
    simulation.nodes(nodes);
    const linkForce = simulation.force("link") as d3.ForceLink<any, any>;
    linkForce.links(links);

    const link = linkLayer.selectAll<SVGLineElement, any>("line")
      .data(links, (d: any) => `${d.source.id || d.source}-${d.target.id || d.target}`)
      .join("line")
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 2)
      .attr("opacity", 0.5);

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
            .attr("r", 42)
            .attr("fill", "transparent")
            .attr("stroke-width", 2)
            .attr("stroke", "transparent");

          gEnter.append("circle")
            .attr("class", "main-circle")
            .attr("r", 30)
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
            .attr("dy", 50)
            .attr("text-anchor", "middle")
            .attr("fill", "#cbd5e1")
            .attr("font-size", "11px")
            .attr("font-weight", "600")
            .attr("font-family", "'JetBrains Mono', monospace")
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
      .attr("stroke-width", d => d.id === selectedNodeId ? 5 : 2);

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    simulation.alpha(0.6).restart();

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