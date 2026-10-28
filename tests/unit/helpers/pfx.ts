/**
 * Gera certificados A1 (.pfx) de verdade para os testes (node-forge): titular "RAZÃO:CNPJ",
 * validade escolhida, opcionalmente com a cadeia (AC antes do titular) ou sem a chave privada.
 * Chaves de 1024 bits só para os testes ficarem rápidos.
 */
import forge from "node-forge";

const chaves = new Map<string, forge.pki.rsa.KeyPair>();
function par(nome: string) {
  if (!chaves.has(nome)) chaves.set(nome, forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 }));
  return chaves.get(nome)!;
}

function certificado(cn: string, chave: forge.pki.rsa.KeyPair, assinante: forge.pki.rsa.KeyPair, emissor: string, de: Date, ate: Date) {
  const c = forge.pki.createCertificate();
  c.publicKey = chave.publicKey;
  c.serialNumber = String(Math.floor(Math.random() * 1e9));
  c.validity.notBefore = de;
  c.validity.notAfter = ate;
  c.setSubject([{ name: "commonName", value: cn }, { name: "countryName", value: "BR" }]);
  c.setIssuer([{ name: "commonName", value: emissor }, { name: "countryName", value: "BR" }]);
  c.sign(assinante.privateKey, forge.md.sha256.create());
  return c;
}

export function gerarPfx(op: {
  cn?: string; senha?: string; de?: Date; ate?: Date; comCadeia?: boolean; semChave?: boolean;
} = {}): Buffer {
  const titular = par("titular"), ac = par("ac");
  const de = op.de ?? new Date(Date.now() - 30 * 86_400_000);
  const ate = op.ate ?? new Date(Date.now() + 365 * 86_400_000);
  const cert = certificado(op.cn ?? "CLIMA TOTAL REFRIGERACAO LTDA:12345678000190", titular, ac, "AC TESTE", de, ate);
  const cadeia = op.comCadeia ? [certificado("AC TESTE", ac, ac, "AC TESTE", de, ate), cert] : [cert];
  const asn1 = forge.pkcs12.toPkcs12Asn1(op.semChave ? null : titular.privateKey, cadeia, op.senha ?? "senha123", { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
}
