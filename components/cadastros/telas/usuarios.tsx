"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Mail, ShieldCheck } from "lucide-react";
import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { AvisoConvite, criarEditorUsuario, type ResultadoConvite } from "@/components/cadastros/editores/editor-usuario";
import { formatarData } from "@/lib/utils";

/**
 * Usuários do sistema no padrão: criar (com convite para a pessoa definir a senha), editar nome e
 * perfil, inativar/reativar. Travas no servidor: ninguém inativa a si mesmo nem o último
 * administrador; ninguém altera o próprio perfil; quem não é administrador não mexe em quem tem
 * mais acesso. Usuário inativado perde o acesso na hora (sessão conferida a cada requisição).
 */
export function UsuariosTela({ usuarioAtualId, emailsTecnicos = [] }: { usuarioAtualId: string; emailsTecnicos?: string[] }) {
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
          {erro && <span role="alert" className="block mt-2 text-atrasado-texto">{erro}</span>}
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
            // Y11: papel Técnico só abre o APP quando existe Técnico ativo com o MESMO e-mail —
            // sem isso a pessoa entra no sistema comum "vazio" e ninguém entende o porquê.
            const avisoTecnico = u.role === "TECNICO" && u.ativo && !emailsTecnicos.includes((u.email ?? "").trim().toLowerCase()) && (
              <span data-aviso-tecnico className="inline-flex items-center gap-1 text-[10px] font-semibold bg-atencao-claro text-atencao-texto px-2 py-0.5 rounded-full"
                title="Não há técnico ativo com este e-mail em Equipes › Técnicos. Assim a pessoa entra no sistema comum (vazio) em vez do app do técnico. Cadastre o técnico com o mesmo e-mail.">
                <AlertTriangle className="w-3 h-3" /> sem técnico vinculado — não cai no app
              </span>
            );
            if (u.role === "ADMIN") return <span className="inline-flex items-center gap-1 text-xs font-semibold bg-atrasado-claro text-atrasado px-2 py-1 rounded-full"><ShieldCheck className="w-3.5 h-3.5" /> Acesso total</span>;
            if (!u.perfilAcesso) return <span className="flex items-center gap-1.5 flex-wrap"><span className="text-xs text-ink-muted">Sem perfil (sem acesso)</span>{avisoTecnico}</span>;
            return (
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: u.perfilAcesso.cor }} />
                <span>{u.perfilAcesso.nome}</span>
                {!u.perfilAcesso.ativo && <span className="text-[10px] font-semibold bg-atencao-claro text-atencao-texto px-2 py-0.5 rounded-full" title="Perfil inativo: este usuário está sem acesso">perfil inativo · sem acesso</span>}
                {avisoTecnico}
              </span>
            );
          }
          if (col === "ultimoAcesso") return u.ultimoAcesso ? formatarData(u.ultimoAcesso) : <span className="text-xs text-atencao-texto">Ainda não entrou</span>;
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
