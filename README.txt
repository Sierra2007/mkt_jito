Zeabur Report API
=================

設計重點
--------
1. 不使用 Playwright / Selenium / Chromium。
2. 不需要 npm dependencies，只有 Node.js 內建 http + fetch。
3. Zeabur 部署非常小，啟動也快。
4. Bearer Token 放 Zeabur 環境變數，不寫死在程式。
5. n8n 後續只需要 HTTP Request 節點。

Zeabur 環境變數
----------------
PORT=8080
API_BASE=https://admin.y-f-r-h.com
ADMIN_ORIGIN=https://admin-inr911-htvlau.c-e-g-l.com
X_SITE=inr911
X_LANGUAGE=zh-CN
BEARER_TOKEN=你的Bearer Token
API_KEY=你自己設定的一組密鑰

注意：BEARER_TOKEN 可以填：
1960|xxxxxxxx
或
Bearer 1960|xxxxxxxx
程式都能處理。

呼叫方式
--------
健康檢查：
GET /health

推廣渠道報表：
GET /promotion-channel?start_time=1789929000&end_time=1790015399

會員生命週期：
GET /member-lifecycle?start_time=1789929000&end_time=1790015399

一次拿兩份：
GET /all?start_time=1789929000&end_time=1790015399

如果 Zeabur 有設定 API_KEY，n8n HTTP Request Header 加：
x-api-key: 你設定的API_KEY

n8n 建議流程
------------
Schedule Trigger
  -> Code / Set：算 start_time、end_time
  -> HTTP Request：GET https://你的Zeabur域名/all?start_time={{...}}&end_time={{...}}
  -> 後續報表處理

HTTP Request 設定：
Method: GET
URL:
https://你的Zeabur域名/all

Query Parameters:
start_time = {{$json.start_time}}
end_time   = {{$json.end_time}}

Headers:
x-api-key = 你的API_KEY

Response Format: JSON

輸出格式：
{
  "ok": true,
  "query": {
    "start_time": "...",
    "end_time": "..."
  },
  "promotion_channel": { ...原API完整JSON... },
  "member_lifecycle": { ...原API完整JSON... }
}

重要
----
你提供的「會員生命週期看板」第二段 curl 與推廣渠道報表完全相同，應該是複製錯誤。
此專案依你先前實際使用的會員生命週期 API：
/api/report/member-lifecycle

如果實際後台現在已更換 endpoint，只要修改 server.mjs 中 getMemberLifecycle() 的路徑即可。
