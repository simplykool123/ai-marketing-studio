import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { NotificationsBell } from "./NotificationsBell";
import { useParams } from "wouter";

export function Layout({ children }: { children: ReactNode }) {
  const params = useParams();
  const clientId = params?.clientId;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      <Sidebar clientId={clientId} />
      <main className="flex-1 md:ml-64 pt-14 md:pt-0">
        {clientId && (
          <div className="sticky top-0 z-30 flex justify-end border-b bg-background/80 px-4 py-2 backdrop-blur md:px-8">
            <NotificationsBell clientId={clientId} />
          </div>
        )}
        <div className="container max-w-6xl mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
