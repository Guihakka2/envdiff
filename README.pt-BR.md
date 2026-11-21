# envdiff

[English](README.md) · Português · [日本語](README.ja.md)

Compare arquivos `.env` entre ambientes (dev, staging, prod, `.env.example`) — **sem nunca mostrar os valores secretos**.

Seguro para logs de CI, prints e pull requests: os valores são comparados em memória e só os nomes das chaves aparecem.

<p align="center"><img src="docs/demo.svg" alt="envdiff demo" width="760"></p>

```bash
npx @guihakka2/envdiff            # compara .env.example com .env na pasta atual
npx @guihakka2/envdiff .env .env.example --keys-only
npx @guihakka2/envdiff .env.staging .env.production
```

## O que ele faz

- Chaves faltando entre **2 ou mais** arquivos
- Valores diferentes, mostrando só o nome da chave
- Detecta segredos reais (AWS, GitHub, GitLab, npm, OpenAI, Stripe, Slack, Google, Azure, JWT, chaves privadas) esquecidos em `.example` / `.sample` / `.template`
- Chaves duplicadas, valores vazios, linhas inválidas
- **Segurança no git**: falha se um `.env` real foi comitado, avisa se não está no `.gitignore`
- Dica **"did you mean?"** para erros de digitação como `DATABSE_URL`
- Saída `--json` e códigos de saída para CI: `0` em sincronia, `1` diferenças, `2` erro de uso
- Zero dependências, funciona offline, nada é enviado para lugar nenhum

## No CI (GitHub Actions)

```yaml
- uses: Guihakka2/envdiff@v1
  with:
    files: .env.example .env.ci
    args: --keys-only --strict
```

## Opções

| Opção | O que faz |
|---|---|
| `--keys-only` | Compara só os nomes das chaves |
| `--ignore LISTA` | Ignora chaves, separadas por vírgula, com curinga `*`. Segredos vazados continuam sendo denunciados. |
| `--strict` | Avisos também falham (código 1) |
| `--table` | Grade de chaves × arquivos: `✗` faltando, mesma letra = mesmo valor |
| `--fix` | Adiciona as chaves que faltam com valor **vazio**. Nunca copia valores. |
| `--html ARQUIVO` | Gera também um relatório visual em HTML (nunca contém valores) |
| `--json` | Relatório para máquinas (nunca contém valores) |

Documentação completa: [README em inglês](README.md). Licença MIT.
