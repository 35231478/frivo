import { prisma } from "@/lib/prisma";
import { enviarEmail } from "@/lib/email";
import { VALIDADE_RECUPERACAO_MIN, gerarTokenSenha } from "@/lib/usuarios/convite";

/** O que a tela mostra SEMPRE — exista o e-mail ou não. */
export const MENSAGEM_ESQUECI =
  "Se este e-mail estiver cadastrado, você vai receber em alguns minutos um link para criar uma nova senha. Confira também a caixa de spam.";

/**
 * Base dos links do e-mail: a URL configurada do sistema. O endereço da requisição só entra se não
 * houver nenhuma configurada (uma rota pública não deve montar link a partir do Host de quem pediu).
 */
export function urlBasePublica(origemDaRequisicao: string): string {
  return (process.env.NEXTAUTH_URL || process.env.APP_URL || origemDaRequisicao).replace(/\/$/, "");
}

/**
 * "Esqueci minha senha": manda o link (assinado, 1 hora, uso único) para cada usuário ATIVO, de
 * empresa ativa, com este e-mail — pelo e-mail (Resend) da empresa dele, modelo RECUPERACAO_SENHA.
 * Ninguém com o e-mail, ou e-mail da empresa não configurado: não manda nada e só registra no log
 * do servidor (o link nunca vai para o log nem para a resposta). Devolve quantos e-mails saíram.
 */
export async function enviarRecuperacaoSenha(email: string, baseUrl: string): Promise<number> {
  const usuarios = await prisma.usuario.findMany({
    where: { email: { equals: email.trim(), mode: "insensitive" }, ativo: true, empresa: { ativo: true } },
    select: { id: true, nome: true, email: true, senha: true, empresaId: true },
  });
  let enviados = 0;
  for (const u of usuarios) {
    const link = `${baseUrl}/definir-senha?token=${encodeURIComponent(gerarTokenSenha(u, "recuperacao"))}`;
    const r = await enviarEmail(u.empresaId, {
      tipo: "RECUPERACAO_SENHA", para: u.email,
      variaveis: { usuario_nome: u.nome, link_definir_senha: link, validade_link: `${VALIDADE_RECUPERACAO_MIN} minutos` },
      referenciaId: u.id, referenciaTipo: "USUARIO",
    }).catch((e: unknown) => ({ ok: false, erro: e instanceof Error ? e.message : "Erro no envio." }));
    if (r.ok) enviados++;
    else console.warn(`[acesso] link de nova senha não enviado (usuário ${u.id}): ${r.erro}`);
  }
  return enviados;
}
