
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { NodeData, LinkData } from '../types';

// Added D3Node and D3Link interfaces to satisfy TypeScript with D3-injected properties (x, y, etc.)
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

const TransactionGraph: React.FC<Props> = ({ nodes, links, onNodeClick, selectedNodeId }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  // Fixed type for simulationRef to use D3Node
  const simulationRef = useRef<d3.Simulation<D3Node, undefined> | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

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
    if (linkLayer.empty()) linkLayer = g.append("g").attr("class", "links").attr("stroke-opacity", 0.3);

    let nodeLayer = g.select<SVGGElement>("g.nodes");
    if (nodeLayer.empty()) nodeLayer = g.append("g").attr("class", "nodes");

    if (!simulationRef.current) {
      // Correctly type the force simulation initialization
      simulationRef.current = d3.forceSimulation<D3Node>()
        .force("link", d3.forceLink<D3Node, D3Link>().id((d: D3Node) => d.id).distance(220))
        .force("charge", d3.forceManyBody().strength(-2000))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(100));
    }

    const simulation = simulationRef.current;
    
    // Deep copies to ensure D3 references don't conflict with React state, using D3 types
    const nodesCopy: D3Node[] = nodes.map(d => ({ ...d }));
    const linksCopy: D3Link[] = links.map(d => ({ source: d.source, target: d.target, value: d.value, label: d.label }));

    simulation.nodes(nodesCopy);
    const linkForce = simulation.force("link") as d3.ForceLink<D3Node, D3Link>;
    linkForce.links(linksCopy);

    // Properly type selection for links
    const link = linkLayer.selectAll<SVGLineElement, D3Link>("line")
      .data(linksCopy, (d: D3Link) => {
        const s = (d.source as any).id || d.source;
        const t = (d.target as any).id || d.target;
        return `${s}-${t}`;
      })
      .join("line")
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 2);

    // Properly type selection for nodes
    const node = nodeLayer.selectAll<SVGGElement, D3Node>("g.node")
      .data(nodesCopy, d => d.id)
      .join(
        enter => {
          const gEnter = enter.append("g")
            .attr("class", "node")
            .style("cursor", "crosshair")
            .on("click", (event, d) => {
              if (event.defaultPrevented) return;
              const original = nodes.find(n => n.id === d.id);
              if (original) onNodeClick(original);
            })
            // Typed drag behavior
            .call(d3.drag<any, D3Node>()
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
              if (d.type === 'transaction') return '#10b981';
              return '#f59e0b';
            })
            .attr("stroke", "#020408")
            .attr("stroke-width", 2);

          gEnter.append("text")
            .attr("dy", 48)
            .attr("text-anchor", "middle")
            .attr("fill", "#94a3b8")
            .attr("font-size", "10px")
            .attr("font-weight", "600")
            .attr("font-family", "monospace")
            .text(d => d.label);

          return gEnter;
        }
      );

    node.select("circle.glow")
      .attr("stroke", d => d.id === selectedNodeId ? "rgba(16, 185, 129, 0.5)" : "transparent")
      .attr("stroke-dasharray", d => d.id === selectedNodeId ? "4 2" : null);

    node.select("circle.main-circle")
      .attr("stroke", d => d.id === selectedNodeId ? "#34d399" : "#020408")
      .attr("stroke-width", d => d.id === selectedNodeId ? 4 : 2);

    // Fixed tick handlers by casting source/target to any to access D3-injected coordinates
    simulation.on("tick", () => {
      link
        .attr("x1", (d: D3Link) => (d.source as any).x)
        .attr("y1", (d: D3Link) => (d.source as any).y)
        .attr("x2", (d: D3Link) => (d.target as any).x)
        .attr("y2", (d: D3Link) => (d.target as any).y);

      // Fixed node transform by using D3Node type which contains x and y
      node.attr("transform", (d: D3Node) => `translate(${d.x},${d.y})`);
    });

    simulation.alpha(0.8).restart();

  }, [nodes, links, onNodeClick, selectedNodeId]);

  return (
    <div className="w-full h-full bg-black/5 relative overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />
      <div className="absolute bottom-8 left-8 flex flex-col gap-3 bg-[#05070c]/90 backdrop-blur-3xl p-6 rounded-[2rem] border border-white/5 pointer-events-none shadow-2xl">
        <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] mb-1">Investigation Key</h4>
        <div className="grid grid-cols-1 gap-y-2">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-600"></div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Wallet</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-600"></div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Transaction</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-violet-600"></div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">EVM</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransactionGraph;
