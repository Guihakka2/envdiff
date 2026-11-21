# envdiff

[English](README.md) · [Português](README.pt-BR.md) · 日本語

環境ごと（dev、staging、prod、`.env.example`）の `.env` ファイルを比較します。**秘密の値は一切表示しません。**

CI のログ、スクリーンショット、プルリクエストにそのまま貼っても安全です。値はメモリ上で比較され、表示されるのはキー名だけです。

<p align="center"><img src="docs/demo.svg" alt="envdiff demo" width="760"></p>

```bash
npx @guihakka2/envdiff            # 現在のフォルダの .env.example と .env を比較
npx @guihakka2/envdiff .env .env.example --keys-only
npx @guihakka2/envdiff .env.staging .env.production
```

## 機能

- **2つ以上**のファイル間で不足しているキーを検出
- 値が異なるキーをキー名だけで表示
- `.example` / `.sample` / `.template` ファイルに紛れ込んだ本物の秘密情報（AWS、GitHub、GitLab、npm、OpenAI、Stripe、Slack、Google、Azure、JWT、秘密鍵）を検出
- 重複キー、空の値、不正な行
- **Git の安全確認**：本物の `.env` がコミットされていれば失敗、`.gitignore` になければ警告
- `DATABSE_URL` のような打ち間違いに **did you mean?** で候補を表示
- `--json` 出力と CI 用の終了コード：`0` 一致、`1` 差分あり、`2` 使い方の誤り
- 依存パッケージなし、オフラインで動作、データはどこにも送信されません

## CI で使う（GitHub Actions）

```yaml
- uses: Guihakka2/envdiff@v1
  with:
    files: .env.example .env.ci
    args: --keys-only --strict
```

## オプション

| オプション | 説明 |
|---|---|
| `--keys-only` | キー名だけを比較 |
| `--ignore LIST` | 指定したキーを無視（カンマ区切り、`*` ワイルドカード可）。秘密情報の漏えいは引き続き報告されます。 |
| `--strict` | 警告も失敗扱い（終了コード 1） |
| `--table` | キー × ファイルの表：`✗` 不足、同じ文字 = 同じ値（値は表示しません） |
| `--fix` | 不足しているキーを**空の値**で追記。値はコピーしません。 |
| `--html FILE` | 見やすい HTML レポートも出力（値は含まれません） |
| `--json` | 機械可読なレポート（値は含まれません） |

詳しいドキュメントは[英語版 README](README.md) を参照してください。ライセンス：MIT
