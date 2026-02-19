/**
 * EnableRightClick - Popup Script
 *
 * ポップアップUI のロジック。
 * Background Script とメッセージングで通信し、
 * 現在のサイトの有効/無効状態を表示・切り替えする。
 */

document.addEventListener("DOMContentLoaded", async () => {
    // --- DOM要素の取得 ---
    const toggle = document.getElementById("toggle");
    const toggleLabel = document.getElementById("toggle-label");
    const toggleArea = document.getElementById("toggle-area");
    const originDisplay = document.getElementById("origin-display");
    const unsupportedMessage = document.getElementById("unsupported-message");
    const settingsBtn = document.getElementById("settings-btn");

    // --- 初期状態の取得 ---
    // Background Script に現在のタブの状態を問い合わせる
    const status = await chrome.runtime.sendMessage({ type: "getStatus" });

    if (!status.supported) {
        // chrome:// や about: などの特殊ページでは使えない
        originDisplay.style.display = "none";
        toggleArea.style.display = "none";
        unsupportedMessage.style.display = "block";
        return;
    }

    // オリジンを表示
    originDisplay.textContent = status.origin;

    // トグルの状態を反映
    toggle.checked = status.enabled;
    toggle.disabled = false;
    updateLabel(status.enabled);

    // --- トグル切り替え時の処理 ---
    toggle.addEventListener("change", async () => {
        // 連打防止のため一時的に無効化
        toggle.disabled = true;

        // Background Script にトグル要求を送信
        const result = await chrome.runtime.sendMessage({ type: "toggle" });

        if (result.success) {
            updateLabel(result.enabled);
            toggle.checked = result.enabled;
        } else {
            // 失敗した場合は元に戻す（ユーザーが権限を拒否した場合など）
            toggle.checked = !toggle.checked;
        }

        toggle.disabled = false;
    });

    // --- 設定ボタン（オプションページを開く） ---
    settingsBtn.addEventListener("click", () => {
        // chrome.runtime.openOptionsPage() で manifest.json の
        // options_page に指定されたページを新しいタブで開く
        chrome.runtime.openOptionsPage();
        // ポップアップを閉じる
        window.close();
    });

    /**
     * トグルラベルのテキストとスタイルを更新する。
     * @param {boolean} enabled - 有効かどうか
     */
    function updateLabel(enabled) {
        toggleLabel.textContent = enabled ? "有効" : "無効";
        toggleLabel.classList.toggle("active", enabled);
    }
});
