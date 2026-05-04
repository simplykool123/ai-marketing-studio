import { useState } from "react";
import { useParams } from "wouter";
import { 
  useListStorylines, 
  useCreateStoryline, 
  useUpdateStoryline,
  useDeleteStoryline,
  getListStorylinesQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, BookOpen, Trash2 } from "lucide-react";
import { format } from "date-fns";

export default function Storylines() {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: storylines, isLoading } = useListStorylines(clientId || "");

  const createStoryline = useCreateStoryline();
  const updateStoryline = useUpdateStoryline();
  const deleteStoryline = useDeleteStoryline();

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [narrative, setNarrative] = useState("");
  const [isActive, setIsActive] = useState(true);

  const handleCreate = () => {
    if (!title.trim() || !narrative.trim() || !clientId) return;
    
    createStoryline.mutate(
      { clientId, data: { title, narrative, isActive } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListStorylinesQueryKey(clientId) });
          setIsOpen(false);
          setTitle("");
          setNarrative("");
          setIsActive(true);
          toast({ title: "Storyline created successfully" });
        },
        onError: () => {
          toast({ title: "Failed to create storyline", variant: "destructive" });
        }
      }
    );
  };

  const handleToggleActive = (storylineId: string, currentStatus: boolean) => {
    if (!clientId) return;
    updateStoryline.mutate(
      { clientId, storylineId, data: { isActive: !currentStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListStorylinesQueryKey(clientId) });
        },
        onError: () => {
          toast({ title: "Failed to update storyline", variant: "destructive" });
        }
      }
    );
  };

  const handleDelete = (storylineId: string) => {
    if (!clientId) return;
    deleteStoryline.mutate(
      { clientId, storylineId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListStorylinesQueryKey(clientId) });
          toast({ title: "Storyline deleted" });
        },
        onError: () => {
          toast({ title: "Failed to delete storyline", variant: "destructive" });
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
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Storylines</h1>
          <p className="text-muted-foreground mt-1">
            Manage overarching narratives and campaigns for this brand.
          </p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Storyline
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Storyline</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input 
                  value={title} 
                  onChange={(e) => setTitle(e.target.value)} 
                  placeholder="e.g. Summer Collection Launch"
                />
              </div>
              <div className="space-y-2">
                <Label>Narrative</Label>
                <Textarea 
                  value={narrative} 
                  onChange={(e) => setNarrative(e.target.value)} 
                  placeholder="Describe the arc, key messages, and themes..."
                  className="h-32"
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <Label className="cursor-pointer" htmlFor="active-toggle">Set as active</Label>
                <Switch 
                  id="active-toggle"
                  checked={isActive} 
                  onCheckedChange={setIsActive} 
                />
              </div>
              <Button 
                className="w-full mt-4" 
                onClick={handleCreate}
                disabled={!title.trim() || !narrative.trim() || createStoryline.isPending}
              >
                {createStoryline.isPending ? "Creating..." : "Create Storyline"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {storylines?.length === 0 ? (
        <Card className="border-dashed bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <BookOpen className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No storylines</h3>
            <p className="text-muted-foreground max-w-md mb-6">
              Storylines help the AI maintain consistency across multiple posts. Create your first campaign narrative.
            </p>
            <Button onClick={() => setIsOpen(true)} variant="outline">Create Storyline</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {storylines?.map((storyline) => (
            <Card key={storyline.id} className="bg-card">
              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <CardTitle className="text-xl">{storyline.title}</CardTitle>
                    {storyline.isActive ? (
                      <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/30 border-none">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Created {format(new Date(storyline.createdAt), "MMM d, yyyy")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={storyline.isActive}
                    onCheckedChange={() => handleToggleActive(storyline.id, storyline.isActive)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(storyline.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{storyline.narrative}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
