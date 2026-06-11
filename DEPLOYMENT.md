# 部署說明（Deployment）

> 2026-06-10 起生效。在此之前 Railway **沒有**接 GitHub，後端要手動 `railway up` 才會部署——
> 任何寫著「git push 就會觸發 Railway」的舊文件在那之前都是錯的。

## 總覽

| 服務 | 平台 | 觸發方式 |
|------|------|----------|
| 前端 `apps/web` | Vercel | push `main` 自動部署（`.github/workflows/deploy.yml`） |
| API `apps/api`（service: `api`） | Railway | push `main` 自動部署（GitHub 連結，2026-06-10 設定） |
| Worker `apps/api`（service: `worker`，`APP_ENTRYPOINT=worker`） | Railway | push `main` 自動部署（同上） |
| 資料庫 schema | Supabase | **手動**：把 `supabase/migrations/*.sql` 貼到 Dashboard SQL Editor 執行 |

- Railway 專案：`realreal-api`（workspace: gathertaiwan's Projects）
- API 對外網址：`https://api-production-ed3c.up.railway.app`（health check: `/health`）
- api 與 worker 跑同一份 codebase，只差 `APP_ENTRYPOINT` 環境變數，**兩個都會在 push 後自動部署**，版本不會再不同步。

## 手動部署（備援）

GitHub 自動部署壞掉時，從 repo root（工作區要乾淨、在想部署的 commit 上）：

```bash
# api
RAILWAY_API_TOKEN=<token> railway up --detach \
  --project ab2fc19b-07f4-48e3-a7c0-8f2edb6200d9 \
  --service e61cf527-0a6f-40b6-92d0-57f8b41ff39a \
  --environment 6075e5d2-dc72-413d-8429-cf5139f80d91

# worker
RAILWAY_API_TOKEN=<token> railway up --detach \
  --project ab2fc19b-07f4-48e3-a7c0-8f2edb6200d9 \
  --service 6a4e308a-fade-40f4-ac3b-6ca62450f488 \
  --environment 6075e5d2-dc72-413d-8429-cf5139f80d91
```

Token 從 Railway → Account → Tokens 建立，用完即撤。

## 驗證部署是否生效

```bash
curl https://api-production-ed3c.up.railway.app/health
```

需要確認某段程式碼真的上線時，打一個能反映該變更的 endpoint（例：`POST /orders/preview`）比看 build 狀態可靠。

## 注意事項

- Railway 服務設定了 watch patterns：只有 `apps/api/**`、`packages/**`、root 的
  `package.json` / `package-lock.json` / `turbo.json` / `railway.toml` 變動才會觸發後端部署；
  純前端或純文件的 push 不會浪費 build。
- `supabase/migrations/` 只是 SQL 的存放處，**沒有**自動套用機制；schema 一律在 Supabase Dashboard 手動執行。
- 金流（PChomePay / LINE Pay / JKOPay / 綠界）的 webhook 都指向上面的 API 網址，改網域要同步更新各金流後台。
