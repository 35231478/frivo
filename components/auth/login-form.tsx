"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginSchema, type LoginInput } from "@/lib/validations";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginInput) => {
    setErro("");
    const resultado = await signIn("credentials", {
      email: data.email,
      senha: data.senha,
      redirect: false,
    });

    if (resultado?.error) {
      setErro("E-mail ou senha inválidos.");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2.5 flex items-center gap-2">
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
          <p className="text-xs text-red-600 font-medium">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-semibold text-ink">Senha</label>
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
          <p className="text-xs text-red-600 font-medium">{errors.senha.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-success-500 hover:bg-success-600 active:bg-success-700 text-white font-semibold py-3 rounded-lg text-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm hover:shadow-md focus:outline-none focus:ring-4 focus:ring-success-500/20"
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
