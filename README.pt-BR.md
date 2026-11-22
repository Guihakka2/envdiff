# envdiff

[English](README.md) · Português · [日本語](README.ja.md)

Compare arquivos `.env` entre ambientes (dev, staging, prod, `.env.example`) — **sem nunca mostrar os valores secretos**.

Seguro para logs de CI, prints e pull requests: os valores são comparados em memória e só os nomes das chaves aparecem.

<p align="center"><img src="docs/demo.svg" alt="envdiff demo" width="760"></p>

```bash
npx @guihakka2/envdiff            # compara todos os .env* da pasta atual
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
- **Varredura do código** (`--scan .`): chaves usadas no código que nenhum `.env` define, e chaves que ninguém usa
- **Lint** e **aviso de expiração** com `# @expire 2027-03-31`
- **Sem configuração**: sem argumentos, compara todos os `.env*` da pasta; ou use `.envdiffrc.json`
- Saída `--json` e códigos de saída para CI: `0` em sincronia, `1` diferenças, `2` erro de uso
- Zero dependências, funciona offline, nada é enviado para lugar nenhum

## No CI (GitHub Actions)

```yaml
- uses: Guihakka2/envdiff@v1
  with:
    files: .env.example .env.ci
    args: --keys-only --strict
```

## Com agentes de IA (MCP)

`envdiff --mcp` roda o envdiff como servidor [MCP](https://modelcontextprotocol.io): um agente de código (Claude Code, Codex, Copilot, Cursor…) consegue conferir seus `.env` sozinho, por exemplo antes de um deploy ou logo depois de criar uma variável nova. Ele recebe a mesma saída segura do `--json`: nomes de chaves, arquivos e linhas, **nunca valores**.

```bash
claude mcp add envdiff -- npx -y @guihakka2/envdiff --mcp
```

A ferramenta (`envdiff_compare`) é só leitura: não usa `--fix`, `--html` nem `--baseline`, e só lê arquivos dentro da pasta onde o servidor foi iniciado.

## Opções

| Opção | O que faz |
|---|---|
| `--keys-only` | Compara só os nomes das chaves |
| `--ignore LISTA` | Ignora chaves, separadas por vírgula, com curinga `*`. Segredos vazados continuam sendo denunciados. |
| `--strict` | Avisos também falham (código 1) |
| `--table` | Grade de chaves × arquivos: `✗` faltando, mesma letra = mesmo valor |
| `--fix` | Adiciona as chaves que faltam com valor **vazio**. Nunca copia valores. |
| `--html ARQUIVO` | Gera também um relatório visual em HTML (nunca contém valores) |
| `--open` | Abre o relatório visual no navegador |
| `--baseline` | Grava os problemas atuais em `.envdiff-baseline.json`; depois só os novos falham (segurança nunca entra) |
| `--scan PASTA` | Compara com as chaves usadas no código-fonte (`--scan .`) |
| `--json` | Relatório para máquinas (nunca contém valores) |

Documentação completa: [README em inglês](README.md). Licença MIT.
