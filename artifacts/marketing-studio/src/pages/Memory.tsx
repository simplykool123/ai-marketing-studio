import { useState } from "react";
import { useParams } from "wouter";
import { 
  useListMemory, 
  useAddMemory, 
  useDeleteMemory,
  getListMemoryQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Plus, BrainCircuit } from "lucide-react";

export default function Memory() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: memories, isLoading } = useListMemory(clientId || "");

  const addMemory = useAddMemory();
  const deleteMemory = useDeleteMemory();

  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !value.trim() || !clientId) return;

    addMemory.mutate(
      { clientId, data: { key, value } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMemoryQueryKey(clientId) });
          setKey("");
          setValue("");
          toast({ title: "Memory added successfully" });
        },
        onError: () => {
          toast({ title: "Failed to add memory", variant: "destructive" });
        }
      }
    );
  };

  const handleDelete = (memoryId: string) => {
    if (!clientId) return;
    deleteMemory.mutate(
      { clientId, memoryId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMemoryQueryKey(clientId) });
          toast({ title: "Memory deleted" });
        },
        onError: () => {
          toast({ title: "Failed to delete memory", variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-10 w-48 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-48 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Content Memory</h1>
        <p className="text-muted-foreground mt-1">
          Store persistent facts and guidelines that the AI will remember when generating content.
        </p>
      </div>

      <Card className="bg-card border-primary/20">
        <CardContent className="p-6">
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Key / Topic</Label>
                <Input 
                  value={key} 
                  onChange={(e) => setKey(e.target.value)} 
                  placeholder="e.g. Founder's Name, Product USP"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Value / Fact</Label>
                <div className="flex gap-2">
                  <Input 
                    value={value} 
                    onChange={(e) => setValue(e.target.value)} 
                    placeholder="e.g. Sarah Jenkins. Founded in 2018."
                    className="flex-1"
                  />
                  <Button type="submit" disabled={!key.trim() || !value.trim() || addMemory.isPending}>
                    <Plus className="w-4 h-4 mr-2" /> Add
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {memories?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-xl border-dashed border-border bg-card/50">
          <BrainCircuit className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Memory is empty</h3>
          <p className="text-muted-foreground max-w-sm">
            Add key facts, style rules, and important details here so the AI remembers them for every post.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {memories?.map(memory => (
            <Card key={memory.id} className="bg-card transition-all group relative">
              <CardContent className="p-4">
                <div className="pr-8">
                  <h4 className="font-semibold text-sm text-primary mb-1">{memory.key}</h4>
                  <p className="text-sm">{memory.value}</p>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  onClick={() => handleDelete(memory.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
