"use client";

import { useState, useEffect } from "react";
import { Select } from "@/components/ui/select";
import { AlertCircle, ShieldCheck } from "lucide-react";

const ROLE_LABEL: Record<string, string> = { ADMIN: "Administrador", GESTOR: "Gestor", TECNICO: "Técnico", OPERADOR: "Operador" };

export function UsuariosClient({ usuarioAtualId }: { usuarioAtualId: string }) {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [perfis, setPerfis] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/usuarios").then((r) => r.json()),
      fetch("/api/perfis-acesso").then((r) => r.json()),
    ]).then(([u, p]) => {
      setUsuarios(Array.isArray(u) ? u : []);
      setPerfis(Array.isArray(p) ? p : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function vincular(id: string, perfilAcessoId: string) {
    setSalvandoId(id); setErro("");
    try {
      const res = await fetch(`/api/usuarios/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perfilAcessoId: perfilAcessoId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setUsuarios((lista) => lista.map((u) => (u.id === id ? { ...u, ...data } : u)));
      else setErro(data.erro ?? "Não foi possível alterar o perfil.");
    } catch { setErro("Erro de conexão."); } finally { setSalvandoId(null); }
  }

  if (loading) return <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Vincule cada usuário do sistema a um perfil de acesso. Usuário <strong>sem perfil não tem acesso</strong> a nada
        além do início. O administrador master tem acesso total mesmo sem perfil. As mudanças valem no próximo login do usuário.
      </p>
      {erro && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {erro}
        </div>
      )}
      <div className="border border-surface-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt border-b border-surface-border">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold text-ink-muted text-xs uppercase tracking-wider">Usuário</th>
              <th className="text-left px-4 py-2.5 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden sm:table-cell">Função</th>
              <th className="text-left px-4 py-2.5 font-semibold text-ink-muted text-xs uppercase tracking-wider">Perfil de Acesso</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u, idx) => (
              <tr key={u.id} className={idx % 2 === 1 ? "bg-surface-alt/30" : ""}>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{u.nome}</p>
                  <p className="text-xs text-ink-subtle">{u.email}</p>
                </td>
                <td className="px-4 py-3 text-ink-muted hidden sm:table-cell">{ROLE_LABEL[u.role] ?? u.role}</td>
                <td className="px-4 py-3">
                  {u.role === "ADMIN" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-50 text-red-600 px-2 py-1 rounded-full"><ShieldCheck className="w-3.5 h-3.5" /> Acesso total</span>
                  ) : u.id === usuarioAtualId ? (
                    <span className="text-xs text-ink-subtle" title="Ninguém altera o próprio perfil de acesso">
                      {u.perfilAcesso?.nome ?? "Sem perfil (sem acesso)"} · você
                    </span>
                  ) : (
                    <Select value={u.perfilAcessoId ?? ""} onChange={(e) => vincular(u.id, e.target.value)} disabled={salvandoId === u.id} className="max-w-[220px]">
                      <option value="">Sem perfil (sem acesso)</option>
                      {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </Select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
