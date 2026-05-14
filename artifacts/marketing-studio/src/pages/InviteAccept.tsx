import { useState } from "react";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [status, setStatus] = useState<"idle" | "accepting" | "accepted" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);

  const acceptInvite = async () => {
    setStatus("accepting");
    setError(null);
    try {
      const res = await fetch(`/api/invites/${token}/accept`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Invite could not be accepted");
      setClientId(data.clientId);
      setStatus("accepted");
      toast({ title: "Invite accepted" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite could not be accepted");
      setStatus("error");
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg items-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Accept invite</CardTitle>
          <CardDescription>Join the client workspace using your signed-in account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "accepted" ? (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Access added
              </div>
              <p className="mt-1 text-xs">You can now open this client workspace.</p>
            </div>
          ) : status === "error" ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <div className="flex items-center gap-2 font-medium">
                <XCircle className="w-4 h-4" />
                Invite failed
              </div>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Accepting adds you to this client workspace with the role chosen by the inviter.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {status !== "accepted" && (
              <Button onClick={acceptInvite} disabled={status === "accepting"}>
                {status === "accepting" && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Accept invite
              </Button>
            )}
            {clientId ? (
              <Link href={`/clients/${clientId}`}>
                <Button variant="outline">Open workspace</Button>
              </Link>
            ) : (
              <Link href="/">
                <Button variant="outline">Back to clients</Button>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
