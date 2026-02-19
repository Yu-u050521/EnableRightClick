/**
 * EnableRightClick - Content Script (v2)
 *
 * シンプル・軽量・強力な制限解除スクリプト。
 * Allow Right-Click を参考に、プロトタイプメソッドの無効化とスマートなDOM操作を組み合わせる。
 */

(function () {
  "use strict";

  // --- 二重実行防止 ---
  if (window.__enableRightClickInjected) return;
  window.__enableRightClickInjected = true;

  // =====================================================
  // 1. プロトタイプメソッドの無効化 (最強の対策)
  // =====================================================
  // サイト側が addEventListener でどのようなリスナーを登録しても、
  // そこで呼ばれる preventDefault() を「何もしない関数」に書き換えてしまえば、
  // ブラウザのデフォルト動作（右クリックメニュー、コピー等）は阻止されない。

  const nullFn = function () { };

  // MouseEvent.prototype.preventDefault を無効化
  // (Method 12: Event Blocking, Method 2, 3, 4 etc. 全般に有効)
  try {
    Object.defineProperty(MouseEvent.prototype, "preventDefault", {
      value: nullFn,
      writable: true,
      configurable: true,
    });
  } catch (e) {
    console.error("[EnableRightClick] MouseEvent override failed", e);
  }

  // ClipboardEvent.prototype.preventDefault を無効化
  // (Copy/Paste 制限対策)
  try {
    Object.defineProperty(ClipboardEvent.prototype, "preventDefault", {
      value: nullFn,
      writable: true,
      configurable: true,
    });
  } catch (e) {
    console.error("[EnableRightClick] ClipboardEvent override failed", e);
  }

  // Selection.prototype.removeAllRanges を無効化
  // (Method 10: 選択解除対策)
  try {
    Object.defineProperty(Selection.prototype, "removeAllRanges", {
      value: nullFn,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(Selection.prototype, "empty", {
      value: nullFn,
      writable: true,
      configurable: true,
    });
  } catch (e) {
    console.error("[EnableRightClick] Selection override failed", e);
  }

  // =====================================================
  // 2. イベントリスナーのブロック (保険)
  // =====================================================
  // プロトタイプ無効化が効かないケース（return false 等）や、
  // stopPropagation() でイベントが親に伝わらないのを防ぐため、
  // キャプチャリングフェーズでイベントを捕捉して伝播を止める。

  const BLOCKED_EVENTS = [
    "contextmenu",
    "selectstart",
    "copy",
    "cut",
    "paste",
    "dragstart",
    "drag",
    "keydown",
    "keyup",
    "keypress",
    "input", // Method 14: 文字数制限対策
  ];

  // window と document の両方でキャプチャ
  [window, document].forEach((target) => {
    BLOCKED_EVENTS.forEach((type) => {
      try {
        target.addEventListener(
          type,
          (e) => {
            e.stopImmediatePropagation();
            // e.preventDefault() は我々のオーバーライドで無効化されているが、
            // 念のためここでもイベントの伝播を完全に止める。
          },
          { capture: true }
        );
      } catch (e) { }
    });

    // mousedown / mouseup はクリック動作に影響するため、
    // stopPropagation はせず、プロパティの上書きのみ行う（念のため）
    ["mousedown", "mouseup"].forEach((type) => {
      try {
        target.addEventListener(
          type,
          (e) => {
            // イベントオブジェクトの preventDefault メソッドを
            // インスタンスレベルでも無効化しておく
            e.preventDefault = nullFn;
          },
          { capture: true }
        );
      } catch (e) { }
    });
  });

  // =====================================================
  // 3. CSS 強制上書き (Method 6, 8, 15 対策)
  // =====================================================
  const style = document.createElement("style");
  style.id = "enable-right-click-style";
  style.textContent = `
    *, *::before, *::after {
      -webkit-user-select: auto !important;
      -moz-user-select: auto !important;
      -ms-user-select: auto !important;
      user-select: auto !important;
      pointer-events: auto !important;
    }
    /* オーバーレイを非表示にするクラス */
    .overlap, .overlay, [class*="overlap"], [class*="overlay"] {
      display: none !important;
      pointer-events: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  // =====================================================
  // 4. スマートなオーバーレイ回避 & 背景画像救出 (Method 13, 16)
  // =====================================================
  // 右クリック(mousedown)された瞬間に、カーソル下の要素をチェックする

  document.addEventListener(
    "mousedown",
    (e) => {
      // 右クリック (button 2) のみ対象
      if (e.button !== 2) return;

      const x = e.clientX;
      const y = e.clientY;

      // カーソル下の全要素を取得
      const elements = document.elementsFromPoint(x, y);

      // A. 背景画像の救出 (Method 16 対策)
      // -------------------------------------------------
      // 要素の中に background-image を持つものがあれば、
      // その画像を指す透明な <img> タグを生成して最前面に置く。
      // これにより「名前を付けて画像を保存」が可能になる。

      const bgElement = elements.find((el) => {
        const s = window.getComputedStyle(el);
        return (
          s.backgroundImage &&
          s.backgroundImage !== "none" &&
          s.backgroundImage.includes("url")
        );
      });

      if (bgElement) {
        const s = window.getComputedStyle(bgElement);
        const match = s.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
        if (match && match[1]) {
          const url = match[1];

          // 救出用画像を検索、なければ作成
          let img = document.querySelector(`img[data-erc-rescued="${url}"]`);
          if (!img) {
            img = document.createElement("img");
            img.src = url;
            img.dataset.ercRescued = url;
            document.body.appendChild(img);
          }

          // スタイルと位置を更新 (毎回必ず実行)
          // 元の要素と同じ位置・サイズに透明画像を重ねることで、
          // どこをクリックしても確実に反応するようにする
          const rect = bgElement.getBoundingClientRect();
          img.style.cssText = `
            position: fixed;
            top: ${rect.top}px;
            left: ${rect.left}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            opacity: 0.01; /* 完全透明だと無視されるブラウザ対策 */
            z-index: 2147483647;
            pointer-events: auto !important;
            cursor: context-menu;
            object-fit: cover; /* 背景画像の表示方法に合わせるのがベストだが、coverで概ねOK */
          `;

          // 一定時間後に削除 (ガベージコレクト)
          // 面積が広いので少し長めに残す
          clearTimeout(img._ercTimer);
          img._ercTimer = setTimeout(() => img.remove(), 5000);
        }
      }

      // B. オーバーレイ回避 (Method 13 対策)
      // -------------------------------------------------
      // 本来クリックしたい要素 (画像、動画、入力欄など) が
      // 透明な要素の下に隠れている場合、上の要素を一時的に無視する。

      const targets = ["IMG", "VIDEO", "AUDIO", "INPUT", "TEXTAREA", "SELECT"];
      const targetElement = elements.find((el) => targets.includes(el.tagName));

      // もしターゲット要素が見つかり、かつそれが一番上の要素でない場合
      if (targetElement && elements[0] !== targetElement) {
        // ターゲットより上にある要素（＝邪魔なオーバーレイ）をすべて
        // pointer-events: none にする
        let blocked = false;
        for (const el of elements) {
          if (el === targetElement) break;

          // 邪魔な要素
          el.style.setProperty("pointer-events", "none", "important");
          el.dataset.ercBlocked = "true";
          blocked = true;
        }

        if (blocked) {
          // 少し待ってから元に戻す（コンテキストメニューが出た後）
          setTimeout(() => {
            document.querySelectorAll('[data-erc-blocked="true"]').forEach((el) => {
              el.style.pointerEvents = "";
              delete el.dataset.ercBlocked;
            });
          }, 500);
        }
      }
    },
    true // キャプチャリングフェーズで実行（誰よりも早く）
  );

  console.log("[EnableRightClick] 制限解除完了 (v2)");
})();
