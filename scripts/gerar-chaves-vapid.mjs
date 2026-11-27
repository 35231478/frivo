#!/usr/bin/env node
/**
 * Gera o par de chaves VAPID das notificações push (uma vez; as mesmas para sempre — trocar desinscreve
 * todos os aparelhos). Uso:
 *   node scripts/gerar-chaves-vapid.mjs [email-de-contato]
 * Imprime as três variáveis para colar no Vercel (Settings › Environment Variables). Nada é gravado em
 * arquivo e nada vai para a internet: as chaves nascem aqui.
 * Passo a passo: docs/push-notificacoes.md.
 */
import webpush from "web-push";

const contato = (process.argv[2] ?? "").trim();
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
const assunto = contato ? (contato.startsWith("mailto:") || contato.startsWith("https://") ? contato : `mailto:${contato}`) : "mailto:SEU-EMAIL-AQUI";

console.log(`
Chaves VAPID geradas. Cole no Vercel (Settings › Environment Variables › Production), uma por linha:

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=${assunto}

• A chave PRIVADA é segredo: só no Vercel, nunca no código, no chat ou no e-mail.
• Depois de salvar, faça um novo deploy (Deployments › … › Redeploy) para o servidor ler as chaves.
${contato ? "" : "• Troque SEU-EMAIL-AQUI por um e-mail de contato da empresa (os serviços de push exigem um contato).\n"}`);
