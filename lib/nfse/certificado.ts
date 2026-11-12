/**
 * Certificado digital A1 (.pfx / .p12) lido AQUI, em memória, antes de ir ao PlugNotas: confere a
 * senha, se tem a chave privada, a validade e o CNPJ do titular (e-CNPJ: "RAZÃO SOCIAL:CNPJ" no CN).
 * Nada é gravado em disco nem no banco, e nenhuma
 * mensagem de erro repete o arquivo ou a senha.
 */
import forge from "node-forge";

export class ErroCertificado extends Error {}

/** .pfx de verdade tem poucos KB; acima disto nem tentamos abrir */
export const TAMANHO_MAX_CERTIFICADO = 100 * 1024;

export interface CertificadoLido {
  titular: string;
  cnpj: string | null;
  validoDe: Date;
  validoAte: Date;
}

/** CNPJ do titular: o e-CNPJ ICP-Brasil traz "RAZÃO SOCIAL:CNPJ" no CN */
function cnpjDoCn(cn: string): string | null {
  const m = cn.match(/:(\d{14})$/);
  return m ? m[1] : null;
}

/**
 * Abre o .pfx com a senha. Erros em português: arquivo inválido, senha incorreta, sem chave
 * privada, sem certificado. NÃO decide se está vencido (quem chama decide, com a data de hoje).
 */
export function lerCertificadoA1(arquivo: Buffer, senha: string): CertificadoLido {
  if (!arquivo.length) throw new ErroCertificado("O arquivo do certificado está vazio.");
  if (arquivo.length > TAMANHO_MAX_CERTIFICADO) throw new ErroCertificado("Arquivo grande demais para um certificado A1 (.pfx).");
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(arquivo.toString("binary")));
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
    } catch (e) {
      if (/mac could not be verified|invalid password|password/i.test(String((e as Error)?.message))) throw new ErroCertificado("Senha do certificado incorreta.");
      throw new ErroCertificado("Não foi possível abrir o certificado com essa senha.");
    }
  } catch (e) {
    if (e instanceof ErroCertificado) throw e;
    throw new ErroCertificado("Arquivo inválido: envie o certificado A1 no formato .pfx ou .p12.");
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ].filter((b) => b.key);
  if (!chaves.length) throw new ErroCertificado("O arquivo não tem a chave privada: exporte o certificado A1 completo (.pfx com chave).");
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).flatMap((b) => (b.cert ? [b.cert] : []));
  if (!certs.length) throw new ErroCertificado("O arquivo não tem nenhum certificado.");
  // O certificado do titular é o que corresponde à chave privada (os outros são da cadeia)
  const chave = chaves[0].key as forge.pki.rsa.PrivateKey;
  const titularCert = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return !!pub?.n && !!chave?.n && pub.n.equals(chave.n);
  }) ?? certs[0];
  const cn = String(titularCert.subject.getField("CN")?.value ?? "").trim();
  return {
    titular: cn.replace(/:\d{11,14}$/, "").trim() || cn,
    cnpj: cnpjDoCn(cn),
    validoDe: titularCert.validity.notBefore,
    validoAte: titularCert.validity.notAfter,
  };
}
