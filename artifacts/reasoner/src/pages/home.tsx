import React, { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListRuns, 
  useGetRunStats, 
  useGetRun, 
  useStartRun, 
  useDeleteRun,
  getListRunsQueryKey,
  getGetRunStatsQueryKey,
  getGetRunQueryKey
} from "@workspace/api-client-react";
import type { AgentRun, AgentRunDetail, AgentStep, RunStats } from "@workspace/api-client-react";
import { Brain, Terminal, Eye, CheckCircle2, AlertCircle, Play, Plus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

// --- Components ---

function StepCard({ step }: { step: AgentStep }) {
  const isThought = step.type === "thought";
  const isAction = step.type === "action";
  const isObservation = step.type === "observation";
  const isComplete = step.type === "complete";
  const isError = step.type === "error";

  let bgClass = "bg-muted/50 border-muted";
  let icon = null;
  
  if (isThought) {
    bgClass = "bg-blue-950/30 border-blue-900/50 text-blue-100";
    icon = <Brain className="w-4 h-4 text-blue-400 mt-0.5" />;
  } else if (isAction) {
    bgClass = "bg-black border-neutral-800 text-gray-300 font-mono text-sm";
    icon = <Terminal className="w-4 h-4 text-gray-400 mt-0.5" />;
  } else if (isObservation) {
    bgClass = "bg-green-950/30 border-green-900/50 text-green-100";
    icon = <Eye className="w-4 h-4 text-green-400 mt-0.5" />;
  } else if (isComplete) {
    bgClass = "bg-amber-950/30 border-amber-900/50 text-amber-100";
    icon = <CheckCircle2 className="w-4 h-4 text-amber-400 mt-0.5" />;
  } else if (isError) {
    bgClass = "bg-red-950/30 border-red-900/50 text-red-100";
    icon = <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />;
  }

  return (
    <div className={`p-4 rounded-lg border flex gap-3 animate-in slide-in-from-bottom-2 fade-in duration-300 ${bgClass}`}>
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1">
          {step.type} {step.cycle ? `(Cycle ${step.cycle})` : ""}
        </div>
        <div className="whitespace-pre-wrap break-words leading-relaxed">
          {step.content}
        </div>
      </div>
    </div>
  );
}

// --- Main Page ---

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [taskInput, setTaskInput] = useState("");
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [isLiveRunning, setIsLiveRunning] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: runs = [], isLoading: loadingRuns } = useListRuns();
  const { data: stats } = useGetRunStats();
  const { data: activeRunDetail, isLoading: loadingRunDetail } = useGetRun(activeRunId || 0, {
    query: { enabled: !!activeRunId && !isLiveRunning, queryKey: getGetRunQueryKey(activeRunId || 0) }
  });

  const startRun = useStartRun();
  const deleteRun = useDeleteRun();

  // Scroll to bottom when new steps arrive
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [liveSteps, activeRunDetail?.steps]);

  const handleStartRun = () => {
    if (!taskInput.trim()) return;
    
    startRun.mutate(
      { data: { task: taskInput } },
      {
        onSuccess: (run) => {
          setActiveRunId(run.id);
          setLiveSteps([]);
          setIsLiveRunning(true);
          setTaskInput("");
          
          queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRunStatsQueryKey() });
          
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
          }
          
          const apiBase = import.meta.env.VITE_API_URL ?? "";
          const sse = new EventSource(`${apiBase}/api/agent/runs/${run.id}/stream`);
          eventSourceRef.current = sse;
          
          sse.addEventListener("step", (e) => {
            const step = JSON.parse(e.data) as AgentStep;
            setLiveSteps((prev) => [...prev, step]);
          });
          
          sse.addEventListener("done", (e) => {
            const data = JSON.parse(e.data);
            setIsLiveRunning(false);
            sse.close();
            queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetRunStatsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetRunQueryKey(run.id) });
          });
          
          sse.onerror = () => {
            setIsLiveRunning(false);
            sse.close();
          };
        },
        onError: (err) => {
          toast({
            title: "Failed to start run",
            description: String(err),
            variant: "destructive"
          });
        }
      }
    );
  };

  const handleSelectRun = (id: number) => {
    if (isLiveRunning) {
      toast({ title: "A run is currently active", description: "Wait for it to finish or start a new task." });
      return;
    }
    setActiveRunId(id);
    setLiveSteps([]);
  };

  const handleNewTask = () => {
    if (isLiveRunning && eventSourceRef.current) {
      eventSourceRef.current.close();
      setIsLiveRunning(false);
    }
    setActiveRunId(null);
    setLiveSteps([]);
    setTaskInput("");
  };

  const handleDeleteRun = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteRun.mutate(
      { id },
      {
        onSuccess: () => {
          if (activeRunId === id) {
            handleNewTask();
          }
          queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRunStatsQueryKey() });
        }
      }
    );
  };

  const displaySteps = isLiveRunning ? liveSteps : (activeRunDetail?.steps || []);
  const finalAnswer = !isLiveRunning ? activeRunDetail?.steps?.find(s => s.type === "complete")?.content : liveSteps.find(s => s.type === "complete")?.content;
  const isFailed = !isLiveRunning ? activeRunDetail?.status === "failed" : false;

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      
      {/* LEFT PANEL */}
      <div className="w-[38%] border-r border-border flex flex-col bg-card/30 z-10 relative">
        <div className="p-4 border-b border-border bg-background flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <h1 className="font-bold tracking-tight">ReplitReasoner</h1>
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {stats ? `${stats.completedRuns} / ${stats.totalRuns} COMPLETED` : "Loading..."}
          </div>
        </div>
        
        <div className="flex-1 overflow-hidden flex flex-col relative">
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4 pb-20">
              {activeRunId === null ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-muted-foreground mt-20">
                  <Brain className="w-12 h-12 mb-4 opacity-20" />
                  <p>Enter a task below to watch the agent reason through it.</p>
                </div>
              ) : (
                <>
                  <div className="mb-6 p-4 bg-muted/30 rounded-lg border border-border">
                    <div className="text-xs font-semibold text-muted-foreground mb-2">TASK</div>
                    <div className="font-medium">
                      {isLiveRunning ? taskInput : activeRunDetail?.task}
                    </div>
                  </div>
                  
                  {displaySteps.map((step, idx) => (
                    <StepCard key={step.id || idx} step={step} />
                  ))}
                  
                  {isLiveRunning && (
                    <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 flex items-center gap-3 animate-pulse">
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      <span className="text-sm font-medium text-primary">Thinking...</span>
                    </div>
                  )}
                  
                  {loadingRunDetail && !isLiveRunning && (
                    <div className="flex justify-center p-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="p-4 border-t border-border bg-background">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Input</span>
              {activeRunId !== null && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleNewTask}>
                  <Plus className="w-3 h-3 mr-1" /> New Task
                </Button>
              )}
            </div>
            <Textarea 
              placeholder="e.g. Write a python script to calculate fibonacci numbers..."
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              className="resize-none h-24 font-mono text-sm bg-black/40 border-neutral-800 focus-visible:ring-primary"
              disabled={isLiveRunning}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleStartRun();
                }
              }}
            />
            <Button 
              className="w-full font-bold tracking-wide"
              onClick={handleStartRun}
              disabled={isLiveRunning || !taskInput.trim()}
            >
              {isLiveRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> RUNNING
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" /> RUN TASK (⌘+Enter)
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="w-[62%] flex flex-col bg-background relative overflow-hidden">
        <div className="p-6 border-b border-border bg-card/50">
          <h2 className="text-lg font-semibold mb-4">Run History</h2>
          
          <div className="grid grid-cols-4 gap-4 mb-6">
            <Card className="p-4 bg-background border-border">
              <div className="text-xs text-muted-foreground font-semibold mb-1">TOTAL RUNS</div>
              <div className="text-2xl font-bold">{stats?.totalRuns || 0}</div>
            </Card>
            <Card className="p-4 bg-background border-border">
              <div className="text-xs text-green-500/80 font-semibold mb-1">COMPLETED</div>
              <div className="text-2xl font-bold text-green-400">{stats?.completedRuns || 0}</div>
            </Card>
            <Card className="p-4 bg-background border-border">
              <div className="text-xs text-red-500/80 font-semibold mb-1">FAILED</div>
              <div className="text-2xl font-bold text-red-400">{stats?.failedRuns || 0}</div>
            </Card>
            <Card className="p-4 bg-background border-border">
              <div className="text-xs text-primary/80 font-semibold mb-1">TOTAL STEPS</div>
              <div className="text-2xl font-bold text-primary">{stats?.totalSteps || 0}</div>
            </Card>
          </div>
        </div>
        
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-2">
            {loadingRuns ? (
              <div className="flex justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground">
                No runs yet. Start your first task!
              </div>
            ) : (
              runs.map((run) => (
                <div 
                  key={run.id} 
                  className={`p-4 rounded-lg border cursor-pointer transition-colors flex items-center justify-between group ${activeRunId === run.id ? 'bg-primary/10 border-primary/50' : 'bg-card border-border hover:bg-muted/50'}`}
                  onClick={() => handleSelectRun(run.id)}
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    {run.status === 'completed' && <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />}
                    {run.status === 'failed' && <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />}
                    {run.status === 'running' && <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />}
                    
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium text-sm">
                        {run.task}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(run.createdAt).toLocaleString()} • {run.stepCount} steps
                      </div>
                    </div>
                  </div>
                  
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0 ml-4"
                    onClick={(e) => handleDeleteRun(run.id, e)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
        
        {finalAnswer && (
          <div className="p-6 border-t border-border bg-gradient-to-t from-green-950/20 to-transparent">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-amber-500" />
              <h3 className="font-semibold text-amber-500 tracking-wide uppercase text-sm">Final Answer</h3>
            </div>
            <div className="bg-black/60 border border-neutral-800 rounded-lg p-5 font-mono text-sm leading-relaxed text-gray-200 overflow-y-auto max-h-[40vh] whitespace-pre-wrap">
              {finalAnswer}
            </div>
          </div>
        )}

        {isFailed && (
          <div className="p-6 border-t border-border bg-gradient-to-t from-red-950/20 to-transparent">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <h3 className="font-semibold text-red-500 tracking-wide uppercase text-sm">Run Failed</h3>
            </div>
            <div className="bg-red-950/40 border border-red-900/50 rounded-lg p-5 font-mono text-sm leading-relaxed text-red-200">
              The agent encountered an unrecoverable error during the run.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
