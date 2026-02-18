import { KeySetup } from "@/components/KeySetup";

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <header className="mb-12">
          <h1 className="font-mono text-2xl font-bold tracking-tight text-foreground">
            API Keys
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Configure provider keys for the deliberation pipeline.
            Keys are encrypted and stored locally.
          </p>
        </header>
        <KeySetup />
      </div>
    </div>
  );
}
