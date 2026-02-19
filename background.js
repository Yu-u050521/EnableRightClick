/**
 * EnableRightClick - Background Script (Service Worker)
 *
 * Chrome拡張機能のバックグラウンドで動作するService Worker。
 * 以下の役割を担う:
 *
 * 1. 有効化されたオリジンの管理（chrome.storage.local に保存）
 * 2. 動的な権限の取得・取り消し（chrome.permissions API）
 * 3. Content Script のオンデマンド注入（chrome.scripting API）
 * 4. アイコンバッジの状態表示
 * 5. 許可済みサイトでの自動有効化
 *
 * === Service Worker とは？ ===
 * Manifest V3 では、バックグラウンドページの代わりに Service Worker を使う。
 * バックグラウンドページは常に起動していたが、Service Worker は
 * イベント駆動で必要な時だけ起動し、アイドル時は自動で停止する。
 * そのため、状態はメモリではなく chrome.storage に保存する必要がある。
 */

// =====================================================
// 1. ストレージのヘルパー関数
// =====================================================

/**
 * 有効化されたオリジンのリストを取得する。
 * chrome.storage.local はキーバリュー形式のストレージで、
 * 拡張機能のローカルデータを永続的に保存できる。
 *
 * @returns {Promise<string[]>} 有効化されたオリジンの配列
 */
async function getEnabledOrigins() {
    const result = await chrome.storage.local.get({ enabledOrigins: [] });
    return result.enabledOrigins;
}

/**
 * 有効化されたオリジンのリストを保存する。
 * @param {string[]} origins - オリジンの配列
 */
async function saveEnabledOrigins(origins) {
    await chrome.storage.local.set({ enabledOrigins: origins });
}

/**
 * URL文字列からオリジン部分を抽出する。
 * 例: "https://example.com/path/page.html" → "https://example.com"
 *
 * chrome:// や about: 等の特殊URLはnullを返す（拡張機能が動作できないため）
 *
 * @param {string} url - URL文字列
 * @returns {string|null} オリジン、または null
 */
function extractOrigin(url) {
    try {
        const urlObj = new URL(url);
        // http と https のみサポート（chrome:// 等には注入できない）
        if (urlObj.protocol === "http:" || urlObj.protocol === "https:") {
            return urlObj.origin; // "https://example.com" の形式
        }
    } catch {
        // 不正なURLの場合は無視
    }
    return null;
}

// =====================================================
// 2. Content Script の注入
// =====================================================

/**
 * 指定タブに Content Script を注入する。
 * chrome.scripting.executeScript() を使い、content.js を動的に注入する。
 *
 * 【なぜ manifest.json の content_scripts で定義しないのか？】
 * content_scripts で定義すると、マッチするすべてのページに自動的に注入される。
 * しかし本拡張では、ユーザーが許可したサイトのみに注入したいため、
 * プログラムで制御する executeScript を使う。
 *
 * 【なぜ world: "MAIN" が必要なのか？】
 * Content Script はデフォルトでは "ISOLATED" ワールドで実行される。
 * Isolated World はページ側の JavaScript とは独立した環境で、
 * DOM は共有するが、グローバルオブジェクト（window, EventTarget 等）は別物。
 *
 * 本拡張では EventTarget.prototype.addEventListener をオーバーライドして、
 * ページ側のスクリプトが contextmenu イベントを登録するのをブロックする。
 * これはページ側の EventTarget.prototype を書き換える必要があるため、
 * "MAIN" ワールド（ページと同じ実行環境）で注入する必要がある。
 *
 * @param {number} tabId - 注入先のタブID
 */
async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content.js"],
            world: "MAIN", // ページと同じコンテキストで実行（必須）
        });
    } catch (error) {
        // タブが既に閉じられている場合、chrome:// ページの場合など
        console.warn("[EnableRightClick] スクリプト注入に失敗:", error.message);
    }
}

// =====================================================
// 3. アイコンバッジの更新
// =====================================================

/**
 * ツールバーのアイコンにバッジテキストを表示する。
 * ON: 緑の "ON" / OFF: バッジなし
 *
 * @param {number} tabId - 対象タブID
 * @param {boolean} isEnabled - 有効かどうか
 */
async function updateBadge(tabId, isEnabled) {
    await chrome.action.setBadgeText({
        text: isEnabled ? "ON" : "",
        tabId: tabId,
    });
    if (isEnabled) {
        await chrome.action.setBadgeBackgroundColor({
            color: "#4CAF50", // マテリアルデザインの緑
            tabId: tabId,
        });
        await chrome.action.setBadgeTextColor({
            color: "#FFFFFF",
            tabId: tabId,
        });
    }
}

// =====================================================
// 4. オリジンの有効化・無効化
// =====================================================

/**
 * オリジンを有効化する。
 *
 * 処理の流れ:
 * 1. chrome.permissions.request() でそのオリジンの権限を動的に取得
 *    → Chromeがユーザーに確認ダイアログを表示
 * 2. 許可されたら、オリジンをストレージに保存
 * 3. Content Script を注入
 * 4. バッジを更新
 *
 * @param {number} tabId - 対象タブID
 * @param {string} origin - 有効化するオリジン
 * @returns {Promise<boolean>} 成功したかどうか
 */
async function enableOrigin(tabId, origin) {
    // オリジンに対応するマッチパターンを生成
    // "https://example.com" → "https://example.com/*"
    const pattern = origin + "/*";

    // chrome.permissions.request() で動的に権限を要求
    // 初回はChromeがダイアログを表示。2回目以降はすでに許可済みなのでスキップ。
    const granted = await chrome.permissions.request({
        origins: [pattern],
    });

    if (!granted) {
        // ユーザーが拒否した場合
        return false;
    }

    // ストレージに保存
    const origins = await getEnabledOrigins();
    if (!origins.includes(origin)) {
        origins.push(origin);
        await saveEnabledOrigins(origins);
    }

    // Content Script を注入
    await injectContentScript(tabId);

    // バッジを更新
    await updateBadge(tabId, true);

    return true;
}

/**
 * オリジンを無効化する。
 *
 * 処理の流れ:
 * 1. ストレージからオリジンを削除
 * 2. chrome.permissions.remove() で権限を取り消し
 * 3. タブをリロードして Content Script の効果を解除
 * 4. バッジを更新
 *
 * 【なぜリロードが必要なのか？】
 * 一度注入された Content Script は、addEventListener のオーバーライドなど
 * ページのグローバルな状態を変更している。これを元に戻すには
 * ページのリロードが最も確実な方法。
 *
 * @param {number} tabId - 対象タブID
 * @param {string} origin - 無効化するオリジン
 */
async function disableOrigin(tabId, origin) {
    // ストレージからオリジンを削除
    const origins = await getEnabledOrigins();
    const updated = origins.filter((o) => o !== origin);
    await saveEnabledOrigins(updated);

    // 権限を取り消し
    const pattern = origin + "/*";
    try {
        await chrome.permissions.remove({ origins: [pattern] });
    } catch {
        // 権限がすでに取り消されている場合
    }

    // バッジを更新
    await updateBadge(tabId, false);

    // タブをリロードして元に戻す
    await chrome.tabs.reload(tabId);
}

// =====================================================
// 5. メッセージハンドラー
// =====================================================
// ポップアップやオプションページからのメッセージを受信して処理する。
// chrome.runtime.onMessage は拡張機能内の通信に使われるメッセージングAPI。

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 非同期処理を行う場合、true を返して sendResponse を保持する必要がある
    handleMessage(message, sender, sendResponse);
    return true; // 非同期レスポンスを示す
});

async function handleMessage(message, sender, sendResponse) {
    try {
        switch (message.type) {
            // --- ポップアップからの状態取得要求 ---
            case "getStatus": {
                const tab = await getCurrentTab();
                if (!tab?.url) {
                    sendResponse({ enabled: false, origin: null, supported: false });
                    return;
                }

                const origin = extractOrigin(tab.url);
                if (!origin) {
                    // chrome:// 等の特殊ページ
                    sendResponse({ enabled: false, origin: null, supported: false });
                    return;
                }

                const origins = await getEnabledOrigins();
                const enabled = origins.includes(origin);
                sendResponse({ enabled, origin, supported: true });
                return;
            }

            // --- ポップアップからの有効化/無効化要求 ---
            case "toggle": {
                const tab = await getCurrentTab();
                if (!tab?.url || !tab.id) {
                    sendResponse({ success: false });
                    return;
                }

                const origin = extractOrigin(tab.url);
                if (!origin) {
                    sendResponse({ success: false });
                    return;
                }

                const origins = await getEnabledOrigins();
                const isEnabled = origins.includes(origin);

                if (isEnabled) {
                    await disableOrigin(tab.id, origin);
                    sendResponse({ success: true, enabled: false });
                } else {
                    const success = await enableOrigin(tab.id, origin);
                    sendResponse({ success, enabled: success });
                }
                return;
            }

            // --- オプションページからの一覧取得要求 ---
            case "getEnabledOrigins": {
                const origins = await getEnabledOrigins();
                sendResponse({ origins });
                return;
            }

            // --- オプションページからの個別削除要求 ---
            case "removeOrigin": {
                const origins = await getEnabledOrigins();
                const updated = origins.filter((o) => o !== message.origin);
                await saveEnabledOrigins(updated);

                // 権限も取り消し
                const pattern = message.origin + "/*";
                try {
                    await chrome.permissions.remove({ origins: [pattern] });
                } catch {
                    // 無視
                }

                sendResponse({ success: true, origins: updated });
                return;
            }

            // --- オプションページからの全削除要求 ---
            case "removeAllOrigins": {
                const origins = await getEnabledOrigins();

                // 全権限を取り消し
                for (const origin of origins) {
                    try {
                        await chrome.permissions.remove({ origins: [origin + "/*"] });
                    } catch {
                        // 無視
                    }
                }

                await saveEnabledOrigins([]);
                sendResponse({ success: true });
                return;
            }

            default:
                sendResponse({ error: "Unknown message type" });
        }
    } catch (error) {
        console.error("[EnableRightClick] メッセージ処理エラー:", error);
        sendResponse({ error: error.message });
    }
}

/**
 * 現在アクティブなタブを取得する。
 * chrome.tabs.query で現在のウィンドウのアクティブタブを取得。
 *
 * @returns {Promise<chrome.tabs.Tab|undefined>}
 */
async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

// =====================================================
// 6. タブ更新時の自動注入
// =====================================================
// ユーザーが有効化済みのサイトに再度アクセスした時、
// ページの読み込み完了をトリガーに自動的に Content Script を注入する。
//
// chrome.tabs.onUpdated はタブの状態変化（URL変更、読み込み完了等）を監視する。

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // status === "complete" はページの読み込みが完了したことを示す
    if (changeInfo.status !== "complete" || !tab.url) return;

    const origin = extractOrigin(tab.url);
    if (!origin) return;

    const origins = await getEnabledOrigins();
    if (origins.includes(origin)) {
        // 権限がまだ有効か確認
        const hasPermission = await chrome.permissions.contains({
            origins: [origin + "/*"],
        });

        if (hasPermission) {
            await injectContentScript(tabId);
            await updateBadge(tabId, true);
        } else {
            // 権限が取り消されていたら、ストレージからも削除
            const updated = origins.filter((o) => o !== origin);
            await saveEnabledOrigins(updated);
        }
    }
});

// =====================================================
// 7. タブ切り替え時のバッジ更新
// =====================================================
// タブを切り替えた時にバッジの表示を更新する。
// バッジはタブごとに設定されるので、新しいタブに切り替えた時に適切な状態を表示。

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (!tab.url) return;

        const origin = extractOrigin(tab.url);
        if (!origin) {
            await updateBadge(activeInfo.tabId, false);
            return;
        }

        const origins = await getEnabledOrigins();
        const isEnabled = origins.includes(origin);
        await updateBadge(activeInfo.tabId, isEnabled);
    } catch {
        // タブが存在しない場合
    }
});
