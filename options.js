/**
 * EnableRightClick - Options Script
 *
 * オプションページのロジック。
 * 許可済みサイトの一覧表示・個別削除・全削除を行う。
 */

document.addEventListener("DOMContentLoaded", async () => {
    const siteList = document.getElementById("site-list");
    const emptyState = document.getElementById("empty-state");
    const removeAllBtn = document.getElementById("remove-all-btn");

    // --- 初期表示 ---
    await loadSites();

    // --- 全削除ボタン ---
    removeAllBtn.addEventListener("click", async () => {
        if (!confirm("すべてのサイトの許可を取り消しますか？")) return;

        await chrome.runtime.sendMessage({ type: "removeAllOrigins" });
        await loadSites();
    });

    /**
     * 許可済みサイト一覧を読み込んで表示する。
     */
    async function loadSites() {
        const response = await chrome.runtime.sendMessage({
            type: "getEnabledOrigins",
        });
        const origins = response.origins || [];

        // 一覧をクリア
        siteList.innerHTML = "";

        if (origins.length === 0) {
            // 空状態
            siteList.innerHTML = `
        <div class="empty-state" id="empty-state">
          <p>有効化されているサイトはありません</p>
          <p class="hint">ツールバーのアイコンをクリックしてサイトを有効化してください</p>
        </div>
      `;
            removeAllBtn.style.display = "none";
            return;
        }

        // 全削除ボタンを表示
        removeAllBtn.style.display = "block";

        // 各オリジンのカードを生成
        origins.forEach((origin) => {
            const item = document.createElement("div");
            item.className = "site-item";
            item.innerHTML = `
        <span class="site-origin">${escapeHtml(origin)}</span>
        <button class="remove-btn" data-origin="${escapeHtml(origin)}">削除</button>
      `;

            // 削除ボタンのイベント
            item.querySelector(".remove-btn").addEventListener("click", async (e) => {
                const targetOrigin = e.target.dataset.origin;

                // フェードアウトアニメーション
                item.classList.add("removing");
                await new Promise((resolve) => setTimeout(resolve, 200));

                // Background Script に削除要求
                const result = await chrome.runtime.sendMessage({
                    type: "removeOrigin",
                    origin: targetOrigin,
                });

                if (result.success) {
                    await loadSites(); // 再描画
                }
            });

            siteList.appendChild(item);
        });
    }

    /**
     * HTML エスケープ（XSS対策）。
     * ユーザー入力由来の文字列をHTMLに挿入する際、
     * 特殊文字をエスケープして安全にする。
     *
     * @param {string} str - エスケープする文字列
     * @returns {string} エスケープ済み文字列
     */
    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }
});
