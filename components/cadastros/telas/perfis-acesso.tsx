"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { CadastroPadrao, salvarCadastro } from "@/components/cadastros/cadastro-padrao";
import { EditorPerfil } from "@/components/cadastros/editores/editor-perfil";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { TIPOS_PERFIL_LABEL } from "@/lib/permissoes";

/** Perfis de acesso no padrão: inativar/reativar (nunca apaga), impacto antes de inativar, duplicar. */
export function PerfisAcessoTela() {
  const { pode } = usePermissoes();
  const [erro, setErro] = useState("");
  return (
    <CadastroPadrao
      entidade="perfis-acesso"
      Editor={EditorPerfil}
      ajuda={<>
        Defina o que cada perfil pode ver e fazer. Inativar um perfil <strong>tira o acesso</strong> de quem o usa — o sistema mostra quem antes de confirmar.
        {erro && <span role="alert" className="block mt-2 text-red-700">{erro}</span>}
      </>}
      celula={(col, p) => {
        if (col === "nome") return (
          <span className="flex items-center gap-2 flex-wrap">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.cor }} />
            <span className="font-medium">{p.nome}</span>
            {p.padraoSistema && <span className="text-[10px] font-semibold bg-surface-alt text-ink-muted px-2 py-0.5 rounded-full">Padrão</span>}
          </span>
        );
        if (col === "tipo") return TIPOS_PERFIL_LABEL[p.tipo] ?? p.tipo;
        if (col === "uso") {
          const u = p._count?.usuarios ?? 0, c = p._count?.colaboradores ?? 0;
          return u + c ? `${u} usuário(s) · ${c} colaborador(es)` : "—";
        }
        return undefined;
      }}
      acoesLinha={(p, recarregar) => pode("configuracoes", "gerenciar") && (
        <button
          type="button" title={`Duplicar ${p.nome}`} aria-label={`Duplicar ${p.nome}`}
          className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded"
          onClick={async () => {
            setErro("");
            const r = await salvarCadastro("perfis-acesso", null, { nome: `${p.nome} (cópia)`, tipo: "PERSONALIZADO", cor: p.cor, descricao: p.descricao ?? "", permissoes: p.permissoes ?? {} });
            if (r.ok) recarregar(); else setErro(r.erro);
          }}
        >
          <Copy className="w-4 h-4" />
        </button>
      )}
    />
  );
}
