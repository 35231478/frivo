"use client";

import { useState } from "react";
import { toast } from "@/components/ui/avisos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { REQUISITOS_SENHA } from "@/lib/acesso/senha";
import { cn } from "@/lib/utils";
import { AlertCircle, KeyRound, Info } from "lucide-react";

interface EstadoAcesso { temLogin: boolean; acessoAtivo: boolean; role: string | null }

interface Props {
  tecnicoId: string;
  /** E-mail SALVO do colaborador (é a identidade de login; mudar o e-mail é em Dados pessoais). */
  emailSalvo: string | null;
  inicial: EstadoAcesso;
}

export function AcessoAppColaborador({ tecnicoId, emailSalvo, inicial }: Props) {
  const [estado, setEstado] = useState<EstadoAcesso>(inicial);
  const [ativo, setAtivo] = useState<boolean>(inicial.acessoAtivo);
  const [senha, setSenha] = useState("");
  const [redefinindo, setRedefinindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // ERRO NO CAMPO: o e-mail (que vem de Dados pessoais) e a senha ganham o erro no próprio campo
  const erros = useErrosDoFormulario();

  const email = (emailSalvo ?? "").trim();
  const semEmail = !email;
  // Primeiro acesso (ativar sem login ainda) exige senha inicial; redefinir também.
  const precisaSenha = (ativo && !estado.temLogin) || redefinindo;
  const mudou = ativo !== estado.acessoAtivo || (precisaSenha && senha.length > 0);

  async function salvar() {
    erros.limparTudo();
    if (ativo && semEmail) { erros.validar({ email: "Defina o e-mail do colaborador (Dados pessoais) e salve antes de liberar o acesso." }); return; }
    if (precisaSenha && senha.length === 0) { erros.validar({ senha: "Defina uma senha inicial para liberar o acesso." }); return; }
    setSalvando(true);
    try {
      const res = await fetch(`/api/tecnicos/${tecnicoId}/acesso`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acessoAtivo: ativo, ...(senha ? { senha } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { erros.erroDaApi(data, "Não foi possível salvar o acesso."); return; }
      setEstado({ temLogin: data.temLogin, acessoAtivo: data.acessoAtivo, role: data.role });
      setAtivo(data.acessoAtivo);
      setSenha(""); setRedefinindo(false);
      toast(data.acessoAtivo ? "Acesso ao app liberado." : "Acesso ao app bloqueado.");
    } catch { erros.definirGeral("Erro de conexão. Tente novamente."); erros.focar(); } finally { setSalvando(false); }
  }

  // Grava sozinho (o acesso na hora): não arma o "Sair sem salvar?" da ficha em volta
  return (
    <ErrosDoFormulario valor={erros}>
    <div ref={erros.ref} className="space-y-5" data-acesso-app data-sem-aviso>
      <p className="text-sm text-ink-muted -mt-1">
        Dá a este colaborador um login (e-mail e senha) para o <strong>app do técnico</strong>: ele
        entra direto em “Meu dia”, vê só as OS atribuídas a ele e não acessa o painel de gestão.
      </p>

      <div className="rounded-lg border border-surface-border bg-surface-alt/40 px-4 py-3">
        <ToggleSwitch
          label="Acesso ao app"
          description={estado.temLogin
            ? (ativo ? "Login liberado: o colaborador entra no app com o e-mail abaixo." : "Login bloqueado: o colaborador não consegue entrar.")
            : "Ligue para criar o login de técnico deste colaborador."}
          checked={ativo}
          onChange={(v) => { setAtivo(v); erros.limparTudo(); if (!v) { setRedefinindo(false); setSenha(""); } }}
          disabled={semEmail && !estado.temLogin}
          dica="A permissão é lida no login. Ativar ou bloquear vale a partir do próximo login do colaborador."
        />
      </div>

      <FormField label="E-mail de login" hint="É o e-mail do colaborador (Dados pessoais). Para trocar, altere lá e salve." name="email">
        <Input value={email} readOnly data-acesso-email
          className="bg-surface-linha text-ink-muted"
          placeholder="Sem e-mail — defina em Dados pessoais" />
      </FormField>
      {semEmail && (
        <p className="flex items-center gap-1.5 text-xs text-atencao-texto -mt-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Este colaborador não tem e-mail. Preencha o e-mail em Dados pessoais e salve para poder liberar o acesso.
        </p>
      )}

      {ativo && estado.temLogin && !redefinindo && (
        <Button type="button" variant="secondary" onClick={() => setRedefinindo(true)} className="text-sm" data-acesso-redefinir>
          <KeyRound className="w-4 h-4" /> Redefinir senha
        </Button>
      )}

      {precisaSenha && !semEmail && (
        <FormField label={estado.temLogin ? "Nova senha" : "Senha inicial"} name="senha">
          <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
            placeholder="Defina a senha" autoComplete="new-password" data-acesso-senha />
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
            {REQUISITOS_SENHA.map((r) => {
              const ok = r.ok(senha);
              return (
                <span key={r.id} className={cn("text-xs inline-flex items-center gap-1", ok ? "text-ok-texto" : "text-ink-muted")}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", ok ? "bg-ok" : "bg-surface-border")} /> {r.texto}
                </span>
              );
            })}
          </div>
        </FormField>
      )}

      {/* A faixa é só o resumo (o erro de campo fica no campo) */}
      <ResumoDeErros />

      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <Info className="w-3.5 h-3.5 shrink-0" />
        Senha definida aqui: o técnico troca no 1º acesso. Esqueceu? “Esqueci minha senha” no login.
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={salvar} loading={salvando} disabled={!mudou && !redefinindo} data-acesso-salvar>
          Salvar acesso
        </Button>
      </div>
    </div>
    </ErrosDoFormulario>
  );
}
