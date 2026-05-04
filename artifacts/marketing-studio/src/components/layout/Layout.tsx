import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { useParams } from "wouter";

export function Layout({ children }: { children: ReactNode }) {
  const params = useParams();
  const clientId = params?.clientId;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      <Sidebar clientId={clientId} />
      <main className="flex-1 md:ml-64 pt-14 md:pt-0">
        <div className="container max-w-6xl mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}