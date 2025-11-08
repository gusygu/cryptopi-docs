// src/core/features/cin-aux/flow.ts
/** Essential flow (compiler + coordinator fused) */

export type FlowNodeId = string;
export type FlowNode = {
  id: FlowNodeId;
  kind: "source" | "transform" | "sink";
  run: (ctx: any) => Promise<any>;
  deps?: FlowNodeId[];
};

export type FlowGraph = { nodes: Record<FlowNodeId, FlowNode> };

export async function runFlow(graph: FlowGraph, ctx: any) {
  const done = new Set<FlowNodeId>();
  const order: FlowNodeId[] = topo(graph);
  for (const id of order) {
    const node = graph.nodes[id];
    const out = await node.run(ctx);
    ctx[id] = out; // stash output by id
    done.add(id);
  }
  return ctx;
}

function topo(graph: FlowGraph): FlowNodeId[] {
  const out: FlowNodeId[] = [];
  const temp = new Set<FlowNodeId>();
  const perm = new Set<FlowNodeId>();
  const visit = (id: FlowNodeId) => {
    if (perm.has(id)) return;
    if (temp.has(id)) throw new Error(`cycle at ${id}`);
    temp.add(id);
    for (const d of graph.nodes[id].deps ?? []) visit(d);
    perm.add(id); temp.delete(id); out.push(id);
  };
  for (const id of Object.keys(graph.nodes)) visit(id);
  return out;
}
