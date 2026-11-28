"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { SENHA_MINIMA, problemaSenha } from "@/lib/acesso/senha";
import { API_TROCAR_SENHA } from "@/lib/acesso/troca-obrigatoria";
import { RequisitosSenha } from "@/components/auth/requisitos-senha";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";

/**
 * Troca de senha no 1º acesso: a senha foi definida por outra pessoa, então a própria pessoa cria a
 * dela antes de usar o sistema. Usa a mesma troca de Meu perfil (senha atual + nova, com limite de
 * erros); deu certo, a sessão continua e segue para o trabalho (`destino`).
 */
export function TrocarSenhaObrigatoriaForm({ nome, email, destino }: { nome: string; email: string; destino: string }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  // ERRO NO CAMPO: cada recusa no campo dela (os nomes são os da API: senhaAtual, novaSenha, confirmar)
  const erros = useErrosDoFormulario();
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const problema = problemaSenha(nova);
    const campos: Record<string, string> = !atual ? { senhaAtual: "Informe a senha recebida." }
      : problema ? { novaSenha: problema }
      : nova !== confirmar ? { confirmar: "A confirmação não confere com a nova senha." }
      : nova === atual ? { novaSenha: "A nova senha precisa ser diferente da recebida." } : {};
    if (!erros.validar(campos)) return;
    setSalvando(true);
    try {
      const r = await fetch(API_TROCAR_SENHA, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senhaAtual: atual, novaSenha: nova, confirmar }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { erros.erroDaApi(d, "Não foi possível trocar a senha."); return; }
      // Carga completa: o cookie da sessão já volta regravado (sem a troca pendente)
      window.location.assign(destino);
    } catch { erros.definirGeral("Erro de conexão. Tente de novo."); erros.focar(); } finally { setSalvando(false); }
  }

  const cls = "min-h-[44px] text-base";
  return (
    <ErrosDoFormulario valor={erros}>
    <form ref={erros.ref} onSubmit={salvar} className="space-y-5" data-trocar-senha-obrigatoria noValidate>
      <div>
        <h2 className="text-xl font-bold text-ink">Crie a sua senha, {nome.split(" ")[0]}</h2>
        <p className="text-sm text-ink-muted mt-1">A senha de <strong>{email}</strong> foi definida por outra pessoa. Troque-a para continuar.</p>
      </div>
      <ResumoDeErros className="py-2.5 px-3" />
      <FormField label="Senha recebida" name="senhaAtual">
        <Input type={mostrar ? "text" : "password"} value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" className={cls} data-senha-atual />
      </FormField>
      <FormField label="Nova senha" name="novaSenha">
        <div className="relative">
          <Input type={mostrar ? "text" : "password"} value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" className={`${cls} pr-12`} placeholder={`Pelo menos ${SENHA_MINIMA} caracteres, com letra e número`} data-senha-nova />
          <button type="button" onClick={() => setMostrar((v) => !v)} className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center text-ink-subtle" aria-label={mostrar ? "Ocultar senhas" : "Mostrar senhas"}>
            {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <RequisitosSenha senha={nova} className="pt-1" />
      </FormField>
      <FormField label="Confirme a nova senha" name="confirmar">
        <Input type={mostrar ? "text" : "password"} value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" className={cls} data-senha-confirmar />
      </FormField>
      <button type="submit" disabled={salvando} className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 bg-acento hover:bg-acento-hover text-white font-semibold rounded-lg py-2.5 disabled:opacity-60" data-salvar-senha>
        {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar e continuar
      </button>
      <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="w-full min-h-[44px] text-sm font-semibold text-ink-muted hover:text-ink" data-sair>
        Sair
      </button>
    </form>
    </ErrosDoFormulario>
  );
}
