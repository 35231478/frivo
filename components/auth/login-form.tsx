"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginSchema, type LoginInput } from "@/lib/validations";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";

const CHAVE_LEMBRAR = "frivo:manter-conectado";

/** Só caminho LOCAL ("/..." e não "//..."): callbackUrl=https://evil não leva ninguém para fora (S7). */
export function destinoPosLogin(callbackUrl: string | null | undefined): string {
  const v = callbackUrl ?? "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/dashboard";
}

/** Erro do login: senha errada (genérico, não diz se o e-mail existe) ou bloqueio por excesso de tentativas. */
export function mensagemErroLogin(code: string | undefined): string {
  const minutos = /^bloqueado-(\d+)$/.exec(code ?? "")?.[1];
  if (minutos) return `Muitas tentativas sem sucesso. Por segurança, aguarde ${minutos} min e tente de novo — ou use “Esqueci minha senha”.`;
  return "E-mail ou senha inválidos.";
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = destinoPosLogin(searchParams.get("callbackUrl"));
  // Vindo de /sessao-encerrada: o acesso foi encerrado (usuário/empresa inativados ou sessão inválida)
  const sessaoEncerrada = searchParams.get("sessao") === "encerrada";
  // Vindo de /definir-senha (convite): senha criada, é só entrar
  const senhaDefinida = searchParams.get("senha") === "definida";
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState("");
  // "Manter conectado": desmarcado por padrão; o aparelho lembra a última escolha
  const [lembrar, setLembrar] = useState(false);
  useEffect(() => { try { setLembrar(localStorage.getItem(CHAVE_LEMBRAR) === "1"); } catch { /* sem storage */ } }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: searchParams.get("email") ?? "" } });

  const onSubmit = async (data: LoginInput) => {
    setErro("");
    try { localStorage.setItem(CHAVE_LEMBRAR, lembrar ? "1" : "0"); } catch { /* sem storage */ }
    const resultado = await signIn("credentials", {
      email: data.email,
      senha: data.senha,
      lembrar: lembrar ? "true" : "false",
      redirect: false,
    });

    if (resultado?.error) {
      setErro(mensagemErroLogin(resultado.code));
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {senhaDefinida && !erro && (
        <div className="bg-ok-claro border border-ok/20 text-ok-texto text-sm rounded-lg px-3 py-2.5 flex items-center gap-2" role="status">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Senha definida! Entre com o seu e-mail e a nova senha.
        </div>
      )}

      {sessaoEncerrada && !erro && (
        <div className="bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-3 py-2.5 flex items-center gap-2" role="status">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Sua sessão foi encerrada. Entre novamente para continuar.
        </div>
      )}

      {erro && (
        <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2.5 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {erro}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-semibold text-ink">E-mail</label>
        <input
          {...register("email")}
          type="email"
          autoComplete="email"
          placeholder="seu@email.com.br"
          className="w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 disabled:opacity-50 transition-all"
          disabled={isSubmitting}
        />
        {errors.email && (
          <p className="text-xs text-atrasado font-medium">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-semibold text-ink">Senha</label>
          <Link href="/esqueci-senha" className="text-xs font-semibold text-primary-600 hover:text-primary-700 hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <div className="relative">
          <input
            {...register("senha")}
            type={mostrarSenha ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            className="w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 pr-10 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 disabled:opacity-50 transition-all"
            disabled={isSubmitting}
          />
          <button
            type="button"
            onClick={() => setMostrarSenha((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-primary-600 transition-colors"
            tabIndex={-1}
          >
            {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {errors.senha && (
          <p className="text-xs text-atrasado font-medium">{errors.senha.message}</p>
        )}
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          name="lembrar"
          checked={lembrar}
          onChange={(e) => setLembrar(e.target.checked)}
          disabled={isSubmitting}
          className="mt-0.5 w-4 h-4 rounded border-surface-border text-primary-600 focus:ring-primary-500/20"
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
  );
}
