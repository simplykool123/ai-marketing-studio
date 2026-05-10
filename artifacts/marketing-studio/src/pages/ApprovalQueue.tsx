import { Link, useParams } from "wouter";
import { ArrowRight, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ApprovalQueue() {
  const { clientId } = useParams<{ clientId: string }>();
  const reviewHref = `/clients/${clientId}/drafts?tab=pending`;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center">
      <Card>
        <CardContent className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
            <CheckSquare className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Approvals moved to Review</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review now contains pending approvals, drafts, approved posts, and rejected history in one workspace.
          </p>
          <Link href={reviewHref}>
            <Button className="mt-6">
              Open Review
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
