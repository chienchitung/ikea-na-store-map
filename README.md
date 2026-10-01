# IKEA 台灣・香港・澳門 門市及提貨點地圖

互動式地圖，列出 IKEA 台灣、香港、澳門的門市、規劃及訂購點、期間限定店，以及香港的超市提貨站與自助提貨櫃，並可規劃前往各據點的路線。

線上網址：https://ikea-na-store-map.netlify.app
英文版：https://ikea-na-store-map.netlify.app/?lang=en

## 功能

- **地圖與清單**：48 個據點，依店型分類上色；可搜尋店名、地址，或搜尋「提貨櫃」篩選設有自助提貨櫃的據點。
- **我的位置**：自動定位（瀏覽器 GPS／WiFi，失敗時退回 IP 估算），或手動在地圖上指定、拖曳藍點微調。
- **距離與交通時間**：設定位置後，清單顯示直線距離，或切換為開車／大眾運輸／步行時間（最近 5 間）。
- **路線規劃**：在地圖上畫出開車、大眾運輸、步行路線；大眾運輸分段顯示步行與各路線（含路線顏色、上下車站），台灣捷運在中文介面顯示正式中文線名。
- **深夜班次**：大眾運輸以「現在出發」規劃；若深夜收班只剩步行路線，會提示並可改查下一個早上 10:00 出發的班次。
- **中英雙語**：依瀏覽器語言自動選擇，右上角可切換；地圖底圖、路線站名也跟著切換。
- **手機版**：地圖全螢幕，門市列表以底部面板開啟，地區與語言收在選單中。
- **設計**：依 IKEA SKAPA 設計規範（顏色、按鈕尺寸、字型 Noto IKEA）。

## 專案結構

```
index.html                    網頁（地圖、清單、所有介面與據點資料）
fonts/                        Noto IKEA 英文字型（SIL Open Font License 1.1）
netlify/functions/routes.mjs  後端中介程式：代為呼叫 Google Routes API，API key 不會出現在網頁
netlify.toml                  Netlify 部署設定
```

## 部署

網站由 Netlify 連結本 GitHub repo 自動部署：推送到 `main` 分支後約 30 秒上線。

### Netlify 設定

1. Site configuration → Build & deploy → 連結本 repo，分支 `main`，Build command 留空（`netlify.toml` 已設定發布目錄與 Functions 位置）。
2. Site configuration → Environment variables 新增 `GOOGLE_MAPS_API_KEY`，設定後需重新部署一次才會生效。

### Google Cloud 設定

1. 啟用 **Routes API**。
2. 專案需**啟用帳單**：路線規劃（Compute Routes）目前未綁帳單也可使用，但清單的交通時間（Compute Route Matrix）一定要綁定帳單。
3. API key 設定：
   - 應用程式限制選「無」（key 由 Netlify 伺服器端呼叫，設網址限制會被擋）。
   - API 限制只允許 Routes API。
4. 設定每日配額上限，避免用量異常時產生費用。

## 用量與費用

| 項目 | 查看位置 | 說明 |
|---|---|---|
| Google 呼叫次數、錯誤 | Google Cloud Console → Google Maps Platform → **Metrics** | 每日呼叫數與失敗原因（403 未啟用帳單、429 超過上限） |
| Google 上限 | APIs & Services → Routes API → **Quotas** | 每分鐘／每日請求上限，可自行調低 |
| Google 費用 | **Billing → Reports**、Budgets & alerts | 啟用帳單後才有資料，建議設定預算提醒 |
| Netlify Functions | Netlify → Functions → **Usage** | 免費方案每月 125,000 次請求、100 小時執行時間 |

Google 自 2025 年 3 月起改為每個 SKU 各自有每月免費額度（Essentials 等級每月 10,000 次，以官方計價頁為準）。本站目前的用法：

- **路線**（Compute Routes）：每規劃一條路線計 1 次。
- **清單交通時間**（Compute Route Matrix）：依「起點 × 據點數」計費，每次最多 6 個元素。
- 查過的結果會暫存在瀏覽器，同一位置與交通方式不會重複呼叫；地圖底圖不經過 Maps API。

## 本機開發

網頁本身是純 HTML，可用任何靜態伺服器預覽：

```bash
python -m http.server 8843
```

開啟 http://127.0.0.1:8843/ 。注意本機預覽不會執行 Netlify Function，交通時間與路線會顯示「暫時無法取得」；需要測試路線時，可安裝 Node.js 與 Netlify CLI 後執行 `netlify dev`（並在本機設定 `GOOGLE_MAPS_API_KEY`）。

## 更新據點資料

據點資料在 `index.html` 的 `const DATA = { tw: {...}, hk: {...} }`，每筆欄位：

| 欄位 | 說明 |
|---|---|
| `n` | 編號（地圖標記上的數字） |
| `cat` | 店型：`store`、`city`、`cs`、`popup`、`popuphk`、`marketplace`、`3hreesixty`、`wellcome` |
| `zh` / `en` | 中文／英文店名 |
| `addr` / `addrEn` | 中文／英文地址 |
| `lat` / `lon` | 座標（建議取自 Google 地圖上該店家的位置） |
| `cid` | Google 地圖店家編號，用於「導航」連結直接開啟店家頁面 |
| `locker` / `lockerEn` | （選填）自助提貨櫃位置與開放時間 |
| `closed` / `closedEn` | （選填）停業標示，例如「已結束」/「Ended」 |

英文地址與提貨櫃資訊來自 IKEA 香港、台灣官網英文頁面。各店型的數量、清單底部的說明會依資料自動計算，新增或刪除據點不需改其他程式。

## 已知限制

- **時間皆為 Google 的預估值**：開車未計入即時路況（使用 `TRAFFIC_UNAWARE` 以降低費用），尖峰時段會比 Google 地圖導航短，路線資訊卡上有標註；大眾運輸依表定時刻表，不反映誤點。
- **後端防護**：Function 只接受來自本站網址的請求、每次最多 10 個據點、指定出發時間限現在起 7 天內；這能擋一般濫用，但擋不了刻意偽造請求，Google 端的配額上限仍需設定。
- **自動定位**：桌機沒有 GPS，需靠 WiFi 定位；在公司網路或 VPN 下若 WiFi 定位失敗，會退回 IP 估算，可能偏差數公里，可改用「在地圖上指定」。
- **地圖底圖**直接載入 Google 地圖圖磚，適合內部工具使用；若要作為正式對外服務，建議改用 Google Maps JavaScript API。
- **期間限定店**有營運期限，需定期對照官網更新。

## 授權

- 字型 Noto IKEA：© The Noto Project Authors、Inter IKEA Systems B.V.，SIL Open Font License 1.1。
- IKEA 名稱與標誌為 Inter IKEA Systems B.V. 之註冊商標。
