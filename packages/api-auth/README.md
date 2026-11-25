# api-auth

給 `kolindex-api` 用的認證中間件。這個倉庫**沒有** `kolindex-api` 原始碼時，用兩種方式之一：

1. 把 `authGuard.js` 掛進那個 repo 的所有 `/api/*` 業務路由之前。
2. 讓上游繼續聽內網埠，外面改跑 `node apps/api-gate/server.mjs 5210`。

## 環境變數

| 變數 | 用途 |
|---|---|
| `JWT_SECRET` | 簽發與驗證 JWT。優先使用 |
| `KOL_GATE` | 沒有 `JWT_SECRET` 時當密鑰；也是閘的登入通行碼 |
| `KOL_API_UPSTREAM` | api-gate 轉發目標，預設 `http://127.0.0.1:5212` |
| `KOL_ROLE` | 登入後寫進 JWT 的角色，預設 `operator` |
| `KOL_COOKIE_SECURE` | `1` 時 Cookie 加 `Secure` |

JWT payload 只放 `id`、`role`、`exp`。Cookie 名是 `auth_token`，屬性是 `HttpOnly; SameSite=Lax`。

## 掛進 Express / Connect 風格

```js
const authGuard = require('../KOLindex/packages/api-auth/authGuard.js');
app.use('/api', authGuard);
```

## 驗收

```
curl -i http://127.0.0.1:5210/api/rail
# 預期 401 {"error":"unauthorized"}
```

登入後再帶 Cookie 請求才可過。
