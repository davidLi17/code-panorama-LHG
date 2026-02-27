import React, { useCallback, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { 
  ReactFlow, 
  Controls, 
  Background, 
  BackgroundVariant,
  useNodesState, 
  useEdgesState, 
  addEdge,
  Connection,
  Edge,
  Node,
  ReactFlowProvider,
  useReactFlow,
  getNodesBounds
} from '@xyflow/react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import CustomNode from './CustomNode';
import { GraphData, GraphNode } from '../types';
import { transformGraphDataToFlow } from '../utils/layout';

const nodeTypes = {
  custom: CustomNode,
};

export interface GraphViewerRef {
  exportImage: () => Promise<void>;
}

interface GraphViewerProps {
  data: GraphData | null;
  theme: 'light' | 'dark';
  activeModule: string | null;
  onManualDrill?: (nodeId: string) => void;
  maxDrillDepth?: number;
  onSelectNode?: (node: GraphNode) => void;
  onUpdateNodeDescription?: (nodeId: string, description: string) => void;
}

// Inner component to use ReactFlow hooks
const GraphViewerInner = forwardRef<GraphViewerRef, GraphViewerProps>(({ data, theme, activeModule, onManualDrill, maxDrillDepth, onSelectNode, onUpdateNodeDescription }, ref) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [draftDescription, setDraftDescription] = useState('');
  const { getNodes } = useReactFlow();
  const formatFileWithLine = (node: GraphNode) => {
    const rawLine = (node as unknown as { line?: unknown }).line;
    const lineNumber = typeof rawLine === 'number' ? rawLine : Number(rawLine);
    if (Number.isFinite(lineNumber) && lineNumber > 0) {
      return `${node.file}(L${Math.floor(lineNumber)})`;
    }
    return node.file;
  };

  useImperativeHandle(ref, () => ({
    exportImage: async () => {
      // 1. Get all nodes and calculate bounding box
      const nodes = getNodes();
      if (nodes.length === 0) return;

      const nodesBounds = getNodesBounds(nodes);
      
      // 2. Calculate dimensions with padding
      const padding = 50;
      const imageWidth = nodesBounds.width + (padding * 2);
      const imageHeight = nodesBounds.height + (padding * 2);
      
      const element = document.querySelector('.react-flow__viewport') as HTMLElement;
      
      if (element) {
        try {
            const bgColor = theme === 'dark' ? '#020617' : '#f8fafc'; // slate-950 or slate-50
            const desiredPixelRatio = 6;
            const maxExportPixels = 120_000_000; // safety cap to reduce browser canvas failures
            const basePixels = Math.max(1, imageWidth * imageHeight);
            const limitedPixelRatio = Math.max(
              1,
              Math.min(desiredPixelRatio, Math.sqrt(maxExportPixels / basePixels))
            );
            const dataUrl = await toPng(element, {
                backgroundColor: bgColor,
                width: imageWidth,
                height: imageHeight,
                style: {
                    width: `${imageWidth}px`,
                    height: `${imageHeight}px`,
                    transform: `translate(${-nodesBounds.x + padding}px, ${-nodesBounds.y + padding}px) scale(1)`,
                },
                pixelRatio: limitedPixelRatio,
            });
            
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `code-panorama-${new Date().getTime()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            console.error('Export failed', err);
            alert('导出图片失败');
        }
      }
    }
  }));

  useEffect(() => {
    if (data) {
      const { nodes: layoutedNodes, edges: layoutedEdges } = transformGraphDataToFlow(data, activeModule, {
        onManualDrill,
        maxDrillDepth,
      });
      // Pass theme to nodes via data
      const nodesWithTheme = layoutedNodes.map(node => ({
        ...node,
        data: { ...node.data, theme }
      }));
      setNodes(nodesWithTheme);
      setEdges(layoutedEdges);
    }
  }, [data, activeModule, setNodes, setEdges, theme, onManualDrill, maxDrillDepth]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: theme === 'dark' ? '#475569' : '#94a3b8' } } as Edge, eds)),
    [setEdges, theme],
  );

  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    const originalNode = data?.nodes.find(n => n.id === node.id);
    if (originalNode) {
        const moduleName = data?.modules?.find(m => m.id === originalNode.module)?.name || originalNode.module;
        const selected = { ...originalNode, module: moduleName };
        setSelectedNode(selected);
        setDraftDescription(originalNode.description || '');
        onSelectNode?.(selected);
    }
  };

  const onPaneClick = () => {
    setSelectedNode(null);
    setDraftDescription('');
  };

  useEffect(() => {
    if (!selectedNode || !data) return;
    const latestNode = data.nodes.find(n => n.id === selectedNode.id);
    if (!latestNode) return;
    const moduleName = data.modules?.find(m => m.id === latestNode.module)?.name || latestNode.module;
    if (
      latestNode.description === selectedNode.description
      && latestNode.label === selectedNode.label
      && latestNode.file === selectedNode.file
      && latestNode.line === selectedNode.line
      && moduleName === selectedNode.module
    ) {
      return;
    }
    const refreshedNode = { ...latestNode, module: moduleName };
    setSelectedNode(refreshedNode);
    setDraftDescription(latestNode.description || '');
  }, [data, selectedNode]);

  const handleSaveDescription = () => {
    if (!selectedNode || !onUpdateNodeDescription) return;
    const nextDescription = draftDescription.trim();
    onUpdateNodeDescription(selectedNode.id, nextDescription);
    setSelectedNode((prev) => (prev ? { ...prev, description: nextDescription } : prev));
  };

  const handleCancelDescription = () => {
    if (!selectedNode) return;
    setDraftDescription(selectedNode.description || '');
  };

  if (!data) return null;

  return (
    <div className={`w-full h-full flex flex-col ${theme === 'dark' ? 'bg-slate-950' : 'bg-gray-50'}`}>
      <div className="flex-1 relative overflow-hidden">
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-right"
            className="w-full h-full"
            minZoom={0.1}
        >
            <Background 
                color={theme === 'dark' ? '#334155' : '#e2e8f0'} 
                gap={16} 
                variant={BackgroundVariant.Dots}
            />
            <Controls 
                className={`${theme === 'dark' ? 'bg-slate-800 border-slate-700 [&>button]:!bg-slate-800 [&>button]:!border-slate-700 [&>button]:!fill-slate-300 [&>button:hover]:!bg-slate-700' : 'bg-white border-gray-200 shadow-sm'}`} 
            />
        </ReactFlow>

        {/* Node Detail Popup */}
        <AnimatePresence>
            {selectedNode && (
            <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                className={`absolute bottom-6 right-6 z-20 w-80 rounded-xl shadow-2xl border overflow-hidden ${
                    theme === 'dark' 
                        ? 'bg-slate-900 border-slate-700 shadow-black/50' 
                        : 'bg-white border-gray-200'
                }`}
            >
                <div className={`px-4 py-3 border-b flex justify-between items-start ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-gray-50 border-gray-100'
                }`}>
                <div>
                    <h3 className={`font-bold ${theme === 'dark' ? 'text-slate-100' : 'text-gray-900'}`}>{selectedNode.label}</h3>
                    <p className={`text-xs font-mono mt-0.5 ${theme === 'dark' ? 'text-slate-500' : 'text-gray-500'}`}>
                      {formatFileWithLine(selectedNode)}
                    </p>
                </div>
                <button onClick={() => setSelectedNode(null)} className={`${theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-gray-400 hover:text-gray-600'}`}>
                    <X size={16} />
                </button>
                </div>
                <div className="p-4">
                <div className="mb-3">
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 mr-2">
                    {selectedNode.type}
                    </span>
                    {selectedNode.module && (
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        theme === 'dark' ? 'bg-slate-800 text-slate-300' : 'bg-gray-100 text-gray-700'
                    }`}>
                        {selectedNode.module}
                    </span>
                    )}
                </div>
                <label className={`mb-1 block text-xs font-medium ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>
                    函数功能描述
                </label>
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  rows={4}
                  className={`w-full resize-none rounded-lg border px-3 py-2 text-sm leading-relaxed outline-none transition-colors ${
                    theme === 'dark'
                      ? 'border-slate-700 bg-slate-950 text-slate-200 placeholder:text-slate-500 focus:border-blue-500'
                      : 'border-gray-300 bg-white text-gray-700 placeholder:text-gray-400 focus:border-blue-500'
                  }`}
                  placeholder="请输入函数功能描述"
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelDescription}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      theme === 'dark'
                        ? 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                        : 'border border-gray-300 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveDescription}
                    disabled={!onUpdateNodeDescription || draftDescription.trim() === (selectedNode.description || '').trim()}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    保存
                  </button>
                </div>
                </div>
            </motion.div>
            )}
        </AnimatePresence>
      </div>
    </div>
  );
});

export const GraphViewer = forwardRef<GraphViewerRef, GraphViewerProps>((props, ref) => {
  return (
    <ReactFlowProvider children={<GraphViewerInner {...props} ref={ref} />} />
  );
});
