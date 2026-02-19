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

        // 現在の状態を再取得（トグル操作中にタブが変わった場合に備える）
        const currentStatus = await chrome.runtime.sendMessage({ type: "getStatus" });
        const origin = currentStatus.origin;
        const isCurrentlyEnabled = currentStatus.enabled;

        // 意図するアクションを明示的に決定
        // （"toggle" ではなく "enable"/"disable" を使うことで、
        //   permissions.onAdded との競合を防ぐ）
        const action = isCurrentlyEnabled ? "disable" : "enable";

        if (action === "enable") {
            // 有効化する場合: ポップアップ側で権限を要求
            // chrome.permissions.request() はユーザージェスチャーのコンテキスト
            // （＝ユーザーのクリック操作の延長）から呼ぶ必要があるため、
            // Background Script ではなくここで呼ぶ。
            const pattern = origin + "/*";
            const granted = await chrome.permissions.request({ origins: [pattern] });
            if (!granted) {
                // ユーザーが権限を拒否した場合、トグルを元に戻す
                toggle.checked = false;
                toggle.disabled = false;
                return;
            }
        }

        // Background Script に明示的な有効化/無効化要求を送信
        const result = await chrome.runtime.sendMessage({ type: action });

        if (result.success) {
            updateLabel(result.enabled);
            toggle.checked = result.enabled;
        } else {
            // 失敗した場合は元に戻す
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
