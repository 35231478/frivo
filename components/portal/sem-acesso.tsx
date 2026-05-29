import { Lock } from "lucide-react";

export function SemAcesso() {
  return (
    <div className="bg-white rounded-xl border border-surface-border p-10 text-center">
      <Lock className="w-8 h-8 text-ink-subtle mx-auto mb-2" />
      <p className="text-ink-muted">Você não tem permissão para ver esta seção.</p>
    </div>
  );
}
