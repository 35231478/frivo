"use client";

import { useMemo, useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { AvisoConvite, criarEditorUsuario, type ResultadoConvite } from "@/components/cadastros/editores/editor-usuario";
import { formatarData } from "@/lib/utils";

/**
 * Usuários do sistema no padrão: criar (com convite para a pessoa definir a senha), editar nome e
 * perfil, inativar/reativar. Travas no servidor: ninguém inativa a si mesmo nem o último
 * administrador; ninguém altera o próprio perfil; quem não é administrador não mexe em quem tem
 * mais acesso. Usuário inativado perde o acesso na hora (sessão conferida a cada requisição).
 */
export function UsuariosTela({ usuarioAtualId }: { usuarioAtualId: string }) {
  const Editor = useMemo(() => criarEditorUsuario(usuarioAtualId), [usuarioAtualId]);
  const [convite, setConvite] = useState<{ nome: string; r: ResultadoConvite } | null>(null);
  const [erro, setErro] = useState("");

  async function enviarConvite(id: string, nome: string) {
    setErro("");
    try {
      const res = await fetch(`/api/usuarios/${id}/convite`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível enviar o convite."); return; }
      setConvite({ nome, r: d });
    } catch { setErro("Erro de conexão."); }
  }

  return (
    <>
      <CadastroPadrao
        entidade="usuarios"
        Editor={Editor}
        ajuda={<>
          Quem entra no sistema e com qual perfil. A senha é criada pela própria pessoa, pelo convite. Usuário <strong>sem perfil não tem acesso</strong> a nada além do início;
          o administrador tem acesso total. Mudanças de perfil valem no próximo acesso.
          {erro && <span role="alert" className="block mt-2 text-red-700">{erro}</span>}
        </>}
        celula={(col, u) => {
          if (col === "nome") return (
            <span className="block min-w-0">
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium">{u.nome}</span>
                {u.id === usuarioAtualId && <span className="text-[10px] font-semibold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">você</span>}
              </span>
              <span className="block text-xs text-ink-subtle truncate">{u.email}</span>
            </span>
          );
          if (col === "perfil") {
            if (u.role === "ADMIN") return <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-50 text-red-600 px-2 py-1 rounded-full"><ShieldCheck className="w-3.5 h-3.5" /> Acesso total</span>;
            if (!u.perfilAcesso) return <span className="text-xs text-ink-muted">Sem perfil (sem acesso)</span>;
            return (
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: u.perfilAcesso.cor }} />
                <span>{u.perfilAcesso.nome}</span>
                {!u.perfilAcesso.ativo && <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full" title="Perfil inativo: este usuário está sem acesso">perfil inativo · sem acesso</span>}
              </span>
            );
          }
          if (col === "ultimoAcesso") return u.ultimoAcesso ? formatarData(u.ultimoAcesso) : <span className="text-xs text-amber-700">Ainda não entrou</span>;
          return undefined;
        }}
        acoesLinha={(u) => u.ativo && u.id !== usuarioAtualId && (
          <button
            type="button" title={`Enviar convite para ${u.nome}`} aria-label={`Enviar convite para ${u.nome}`}
            className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded"
            onClick={() => enviarConvite(u.id, u.nome)}
          >
            <Mail className="w-4 h-4" />
          </button>
        )}
      />
      <AvisoConvite convite={convite?.r ?? null} nome={convite?.nome ?? ""} onFechar={() => setConvite(null)} />
    </>
  );
}
