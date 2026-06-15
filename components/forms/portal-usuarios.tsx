"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatarData, cn } from "@/lib/utils";
import { Headset, Eye, EyeOff, RefreshCw, ShieldOff, Loader2, Mail } from "lucide-react";

interface Usuario {
  id: string;
  nome: string;
  email: string | null;
  senha: string | null;
  senhaProvisoria: string | null;
  acessoConcedidoEm: string | null;
}

/**
 * Lista os usuários do portal (contatos que já tiveram acesso concedido),
 * com senha provisória revelável, data de criação, status e ações de
 * redefinir/revogar — tudo via API, sem salvar o formulário inteiro.
 */
export function PortalUsuarios({ clienteId, ativo }: { clienteId: string; ativo: boolean }) {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [revelar, setRevelar] = useState<Set<string>>(new Set());
  const [acaoId, setAcaoId] = useState<string | null>(null);

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;
    setUsuarios(null);
    fetch(`/api/clientes/${clienteId}/contatos`)
      .then((r) => r.json())
      .then((d) => { if (!cancelado) setUsuarios(Array.isArray(d) ? d.filter((c: any) => c.acessoConcedidoEm) : []); })
      .catch(() => { if (!cancelado) setUsuarios([]); });
    return () => { cancelado = true; };
  }, [clienteId, ativo]);

  function toggleRevelar(id: string) {
    setRevelar((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function redefinir(id: string) {
    setAcaoId(id);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${id}/acesso-portal`, { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        setUsuarios((prev) => (prev ?? []).map((u) => u.id === id ? { ...u, senha: "set", senhaProvisoria: d.senhaProvisoria, acessoConcedidoEm: u.acessoConcedidoEm ?? d.acessoConcedidoEm } : u));
        setRevelar((s) => new Set(s).add(id));
      }
    } finally { setAcaoId(null); }
  }

  async function revogar(id: string) {
    if (!confirm("Revogar o acesso ao portal deste contato?")) return;
    setAcaoId(id);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${id}/acesso-portal`, { method: "DELETE" });
      if (res.ok) setUsuarios((prev) => (prev ?? []).map((u) => u.id === id ? { ...u, senha: null } : u));
    } finally { setAcaoId(null); }
  }

  if (usuarios === null) {
    return <div className="flex items-center gap-2 text-sm text-ink-muted py-3"><Loader2 className="w-4 h-4 animate-spin" /> Carregando acessos…</div>;
  }
  if (usuarios.length === 0) {
    return <p className="text-sm text-ink-muted">Nenhum contato com acesso ao portal ainda. Conceda o acesso na aba <strong>Contatos</strong>.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Usuários do portal</p>
      {usuarios.map((u) => {
        const ativoAcesso = !!u.senha;
        const rev = revelar.has(u.id);
        return (
          <div key={u.id} className="border border-surface-border rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink flex items-center gap-1.5"><Headset className="w-4 h-4 text-primary-600" /> {u.nome}</p>
                <p className="text-xs text-ink-muted flex items-center gap-1"><Mail className="w-3 h-3" /> {u.email || "sem e-mail"}</p>
              </div>
              <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", ativoAcesso ? "bg-success-50 text-success-700" : "bg-slate-100 text-slate-500")}>
                {ativoAcesso ? "Ativo" : "Revogado"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <p className="text-[11px] font-semibold text-ink-muted">Senha provisória</p>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-ink">{rev ? (u.senhaProvisoria || "—") : "••••••••"}</span>
                  <button type="button" onClick={() => toggleRevelar(u.id)} className="text-ink-muted hover:text-ink" title={rev ? "Ocultar" : "Revelar"}>
                    {rev ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-ink-muted">Acesso criado em</p>
                <p className="text-sm text-ink">{u.acessoConcedidoEm ? formatarData(u.acessoConcedidoEm) : "—"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" loading={acaoId === u.id} onClick={() => redefinir(u.id)} className="text-xs h-7 px-2.5"><RefreshCw className="w-3 h-3" /> Redefinir senha</Button>
              {ativoAcesso && (
                <Button type="button" variant="ghost" loading={acaoId === u.id} onClick={() => revogar(u.id)} className="text-xs h-7 px-2.5 text-red-600 hover:text-red-700"><ShieldOff className="w-3 h-3" /> Revogar acesso</Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
