"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginSchema, type LoginInput } from "@/lib/validations";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { MSG_SESSAO_EXPIRADA } from "@/lib/acesso/sem-sessao";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";

const CHAVE_LEMBRAR = "frivo:manter-conectado";

/** Só caminho LOCAL ("/..." e não "//..."): callbackUrl=https://evil não leva ninguém para fora (S7). */
export function destinoPosLogin(callbackUrl: string | null | undefined): string {
  const v = callbackUrl ?? "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/dashboard";
}

/** Erro do login: senha errada (genérico, não diz se o e-mail existe) ou bloqueio por excesso de tentativas. */
export function mensagemErroLogin(code: string | undefined): string {
  const minutos = /^bloqueado-(\d+)$/.exec(code ?? "")?.[1];
  if (minutos) return `Muitas tentativas. Aguarde ${minutos} min e tente de novo, ou use “Esqueci minha senha”.`;
  return "E-mail ou senha inválidos.";
}

/** O login depois de o técnico entrar em outro aparelho (lib/sessao-ativa › motivoDoEncerramento) */
export const MSG_OUTRO_APARELHO = "Sua sessão foi encerrada porque esta conta entrou em outro aparelho.";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = destinoPosLogin(searchParams.get("callbackUrl"));
  // Vindo de /sessao-encerrada: o acesso foi encerrado (usuário/empresa inativados ou sessão inválida)
  const sessaoEncerrada = searchParams.get("sessao") === "encerrada";
  // App de campo com "apenas um dispositivo ativo": entrou em outro aparelho e este caiu (só dentro do aviso acima)
  const outroAparelho = searchParams.get("motivo") === "outro-aparelho";
  // App do técnico que perdeu a sessão (lib/acesso/sem-sessao): o que estava no aparelho continua guardado
  const expirou = searchParams.get("motivo") === "expirou";
  // Vindo de /definir-senha (convite): senha criada, é só entrar
  const senhaDefinida = searchParams.get("senha") === "definida";
  const [mostrarSenha, setMostrarSenha] = useState(false);
  // "Manter conectado": desmarcado por padrão; o aparelho lembra a última escolha
  const [lembrar, setLembrar] = useState(false);
  useEffect(() => { try { setLembrar(localStorage.getItem(CHAVE_LEMBRAR) === "1"); } catch { /* sem storage */ } }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: searchParams.get("email") ?? "" }, shouldFocusError: false });
  // ERRO NO CAMPO: o e-mail/senha mal digitados ficam no campo; e-mail ou senha errados (o servidor não diz qual,
  // para não revelar se a conta existe) e o bloqueio ficam na faixa do topo
  const erros = useErrosDoFormulario({ rhf: errors });
  const erro = erros.geral ?? "";

  const onSubmit = async (data: LoginInput) => {
    erros.limparTudo();
    try { localStorage.setItem(CHAVE_LEMBRAR, lembrar ? "1" : "0"); } catch { /* sem storage */ }
    const resultado = await signIn("credentials", {
      email: data.email,
      senha: data.senha,
      lembrar: lembrar ? "true" : "false",
      redirect: false,
    });

    if (resultado?.error) {
      erros.definirGeral(mensagemErroLogin(resultado.code));
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  };

  return (
    <ErrosDoFormulario valor={erros}>
    <form ref={erros.ref} onSubmit={handleSubmit(onSubmit, () => erros.focar())} className="space-y-5" noValidate>
      {senhaDefinida && !erro && (
        <div className="bg-ok-claro border border-ok/20 text-ok-texto text-sm rounded-lg px-3 py-2.5 flex items-center gap-2" role="status">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Senha definida! Entre com o seu e-mail e a nova senha.
        </div>
      )}

      {sessaoEncerrada && !erro && (
        <div className="bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-3 py-2.5 flex items-center gap-2" role="status">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {outroAparelho ? MSG_OUTRO_APARELHO : "Sua sessão foi encerrada. Entre novamente para continuar."}
        </div>
      )}

      {expirou && !sessaoEncerrada && !erro && (
        <div className="bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-3 py-2.5 flex items-center gap-2" role="status" data-sessao-expirou>
          <AlertCircle className="w-4 h-4 shrink-0" />
          {MSG_SESSAO_EXPIRADA}
        </div>
      )}

      {/* A faixa do topo: e-mail ou senha errados / bloqueio (o que não é de um campo só) */}
      <ResumoDeErros className="py-2.5 px-3" />

      <FormField label="E-mail" name="email" formato="email">
        <Input
          {...register("email")}
          type="email"
          autoComplete="email"
          placeholder="seu@email.com.br"
          className="min-h-[44px] text-base disabled:opacity-50"
          disabled={isSubmitting}
        />
      </FormField>

      <div className="relative">
        {/* O link fica na linha do rótulo, fora do campo (não entra no nome nem na mensagem de erro) */}
        <Link href="/esqueci-senha" className="absolute right-0 top-0 -mt-3 z-[1] inline-flex items-center min-h-[44px] text-sm font-semibold text-primary-600 hover:text-primary-700 hover:underline" data-esqueci-senha>
          Esqueci minha senha
        </Link>
        <FormField label="Senha" name="senha">
        <div className="relative">
          <Input
            {...register("senha")}
            type={mostrarSenha ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            className="pr-12 min-h-[44px] text-base disabled:opacity-50"
            disabled={isSubmitting}
          />
          <button
            type="button"
            onClick={() => setMostrarSenha((v) => !v)}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center text-ink-subtle hover:text-primary-600 transition-colors"
            aria-label={mostrarSenha ? "Esconder a senha" : "Mostrar a senha"}
            tabIndex={-1}
          >
            {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        </FormField>
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer select-none py-1" data-manter-conectado>
        <input
          type="checkbox"
          name="lembrar"
          checked={lembrar}
          onChange={(e) => setLembrar(e.target.checked)}
          disabled={isSubmitting}
          className="mt-0.5 w-5 h-5 rounded border-surface-border text-primary-600 focus:ring-primary-500/20"
        />
        <span className="text-sm text-ink">
          Manter conectado
          <span className="block text-xs text-ink-muted">
            {lembrar ? "Fica conectado por 30 dias neste aparelho." : "Sem marcar, a sessão vale por 1 dia. Não marque em computador compartilhado."}
          </span>
        </span>
      </label>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-acento hover:bg-acento-hover text-white font-semibold py-3 rounded-lg text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-acento/30"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Entrando...
          </>
        ) : (
          <>
            <LogIn className="w-4 h-4" />
            Entrar
          </>
        )}
      </button>
    </form>
    </ErrosDoFormulario>
  );
}
