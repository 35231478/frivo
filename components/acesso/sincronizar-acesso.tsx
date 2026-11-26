"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Na navegação dentro do sistema, confere de novo no máximo a cada 30 s. */
export const INTERVALO_NAVEGACAO_MS = 30_000;
/** Ao voltar para a aba (outra janela, celular desbloqueado), no máximo a cada 10 s. */
export const INTERVALO_FOCO_MS = 10_000;
/** Ao abrir o painel, renova a sessão se a última renovação neste aparelho tem mais de 1 hora. */
export const INTERVALO_RENOVAR_MS = 60 * 60_000;
const CHAVE_RENOVADA = "frivo:sessao-renovada";

const lerRenovada = () => { try { return Number(localStorage.getItem(CHAVE_RENOVADA)) || 0; } catch { return 0; } };
const gravarRenovada = (t: number) => { try { localStorage.setItem(CHAVE_RENOVADA, String(t)); } catch { /* sem armazenamento */ } };

/**
 * Mantém o COOKIE da sessão com o acesso do cadastro de agora (lib/acesso/acesso-atual).
 *
 * As páginas e as APIs já leem papel e permissões do banco a cada requisição. Quem só lê o cookie é
 * o portão do middleware (Edge, sem banco) — e o cookie só é regravado por /api/auth/session. Então:
 *  - `mudou` (o servidor percebeu, nesta página, que o cookie está desatualizado): pede a sessão, o
 *    que regrava o cookie, e recarrega os dados da página — o menu e o portão passam a concordar;
 *  - sem aviso: confere de tempos em tempos ao navegar e ao voltar para a aba, porque o layout não é
 *    renderizado de novo a cada navegação. Uma consulta leve; só recarrega se algo mudou.
 *
 * É também quem RENOVA a sessão ("Manter conectado": 30 dias desde o último uso): o middleware não
 * regrava o cookie (lib/acesso/cookie-sessao), então a renovação vem destas leituras — e, ao abrir o
 * painel, de uma leitura por hora no máximo.
 */
export function SincronizarAcesso({ mudou }: { mudou: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  // A página acabou de ser montada com o acesso conferido pelo servidor: a próxima conferência só
  // depois do intervalo
  const ultima = useRef(Date.now());
  const emCurso = useRef(false);

  const conferir = useCallback(async (recarregar: boolean) => {
    if (emCurso.current) return;
    emCurso.current = true;
    ultima.current = Date.now();
    try {
      const r = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
      if (!r.ok) return;
      gravarRenovada(Date.now());
      const sessao = await r.json().catch(() => undefined);
      // Sessão encerrada (usuário inativado, senha trocada): o layout leva para o login
      if (sessao === null || recarregar || sessao?.user?.acessoMudou === true) router.refresh();
    } catch {
      // sem conexão: tenta de novo na próxima navegação
    } finally {
      emCurso.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (mudou) void conferir(true);
    else if (Date.now() - lerRenovada() >= INTERVALO_RENOVAR_MS) void conferir(false);
  }, [mudou, conferir]);

  useEffect(() => {
    if (Date.now() - ultima.current >= INTERVALO_NAVEGACAO_MS) void conferir(false);
  }, [pathname, conferir]);

  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === "visible" && Date.now() - ultima.current >= INTERVALO_FOCO_MS) void conferir(false);
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [conferir]);

  return null;
}
