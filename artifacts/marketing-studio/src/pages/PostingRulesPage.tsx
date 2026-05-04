import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getPostingRules, upsertPostingRules } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Settings2, Clock, Ban, Plus, X, Save } from "lucide-react";

const PLATFORMS = ["instagram", "facebook", "twitter", "linkedin"] as const;
const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "Twitter",
  linkedin: "LinkedIn",
};

const HOUR_OPTIONS = [
  { value: 6, label: "6:00 AM" },
  { value: 7, label: "7:00 AM" },
  { value: 8, label: "8:00 AM" },
  { value: 9, label: "9:00 AM" },
  { value: 10, label: "10:00 AM" },
  { value: 11, label: "11:00 AM" },
  { value: 12, label: "12:00 PM" },
  { value: 13, label: "1:00 PM" },
  { value: 14, label: "2:00 PM" },
  { value: 15, label: "3:00 PM" },
  { value: 16, label: "4:00 PM" },
  { value: 17, label: "5:00 PM" },
  { value: 18, label: "6:00 PM" },
  { value: 19, label: "7:00 PM" },
  { value: 20, label: "8:00 PM" },
  { value: 21, label: "9:00 PM" },
];

export default function PostingRulesPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: rules, isLoading } = useQuery({
    queryKey: ["postingRules", clientId],
    queryFn: () => getPostingRules(clientId ?? ""),
    enabled: !!clientId,
  });

  const [maxPostsPerDay, setMaxPostsPerDay] = useState<Record<string, number>>({});
  const [preferredWindows, setPreferredWindows] = useState<number[]>([9, 12, 15, 18]);
  const [blackoutDates, setBlackoutDates] = useState<string[]>([]);
  const [newBlackout, setNewBlackout] = useState("");

  useEffect(() => {
    if (rules) {
      setMaxPostsPerDay((rules.maxPostsPerDay as Record<string, number>) ?? {});
      setPreferredWindows((rules.preferredWindows as number[]) ?? [9, 12, 15, 18]);
      setBlackoutDates((rules.blackoutDates as string[]) ?? []);
    }
  }, [rules]);

  const mutation = useMutation({
    mutationFn: () =>
      upsertPostingRules(clientId ?? "", {
        maxPostsPerDay,
        preferredWindows,
        blackoutDates,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["postingRules", clientId] });
      toast({ title: "Posting rules saved" });
    },
    onError: () => toast({ title: "Failed to save rules", variant: "destructive" }),
  });

  const toggleWindow = (hour: number) => {
    setPreferredWindows((prev) =>
      prev.includes(hour) ? prev.filter((h) => h !== hour) : [...prev, hour].sort((a, b) => a - b)
    );
  };

  const addBlackout = () => {
    if (!newBlackout || blackoutDates.includes(newBlackout)) return;
    setBlackoutDates((prev) => [...prev, newBlackout].sort());
    setNewBlackout("");
  };

  const removeBlackout = (date: string) =>
    setBlackoutDates((prev) => prev.filter((d) => d !== date));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Posting Rules</h1>
        <p className="text-muted-foreground mt-1">
          Configure scheduling rules and preferred times for this client.
        </p>
      </div>

      {/* Max posts per day */}
      <Card className="bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="w-4 h-4 text-primary" />
            Daily Post Limits
          </CardTitle>
          <CardDescription>
            Maximum number of posts per platform per day. Leave empty for no limit (default: 2).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          {PLATFORMS.map((platform) => (
            <div key={platform} className="space-y-1.5">
              <Label className="capitalize">{PLATFORM_LABELS[platform]}</Label>
              <Input
                type="number"
                min={1}
                max={20}
                placeholder="2"
                value={maxPostsPerDay[platform] ?? ""}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setMaxPostsPerDay((prev) => ({
                    ...prev,
                    [platform]: isNaN(val) ? 2 : Math.max(1, val),
                  }));
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Preferred posting windows */}
      <Card className="bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="w-4 h-4 text-primary" />
            Preferred Posting Times
          </CardTitle>
          <CardDescription>
            Select the hours when posts should be scheduled. Auto-scheduler will use these windows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {HOUR_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleWindow(value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  preferredWindows.includes(value)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {preferredWindows.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              No windows selected — auto-scheduler will use defaults (9am, 12pm, 3pm, 6pm).
            </p>
          )}
        </CardContent>
      </Card>

      {/* Blackout dates */}
      <Card className="bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ban className="w-4 h-4 text-primary" />
            Blackout Dates
          </CardTitle>
          <CardDescription>
            No posts will be scheduled on these dates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="date"
              value={newBlackout}
              onChange={(e) => setNewBlackout(e.target.value)}
              className="w-48"
            />
            <Button variant="outline" size="sm" onClick={addBlackout}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add Date
            </Button>
          </div>
          {blackoutDates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {blackoutDates.map((date) => (
                <Badge
                  key={date}
                  variant="secondary"
                  className="pl-2 pr-1 py-1 flex items-center gap-1"
                >
                  {date}
                  <button
                    onClick={() => removeBlackout(date)}
                    className="hover:text-destructive transition-colors ml-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          <Save className="w-4 h-4 mr-2" />
          Save Rules
        </Button>
      </div>
    </div>
  );
}
