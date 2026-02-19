/**
 * EnableRightClick - Content Script
 *
 * Webページに注入され、右クリック・テキスト選択・コピーペーストの制限を解除する。
 *
 * === 制限解除の仕組み ===
 *
 * Webサイトは主に以下の方法で右クリックを制限している:
 *
 * 1. addEventListener('contextmenu', e => e.preventDefault())
 *    → イベントリスナーの伝播を止めて、ブラウザ標準の右クリックメニューを抑制
 *
 * 2. <body oncontextmenu="return false">
 *    → HTML属性でインラインハンドラーとして設定
 *
 * 3. CSS の user-select: none
 *    → テキスト選択をCSSレベルで無効化
 *
 * 本スクリプトでは、これらすべてのパターンに対応する。
 * さらに EventTarget.prototype.addEventListener をオーバーライドして、
 * スクリプト実行後に追加されるイベントリスナーもブロックする。
 */

(function () {
  "use strict";

  // --- 二重実行の防止 ---
  // このスクリプトが既に注入済みかどうかをフラグで管理する。
  // chrome.scripting.executeScript は同じタブに複数回注入される可能性があるため。
  if (window.__enableRightClickInjected) return;
  window.__enableRightClickInjected = true;

  // =====================================================
  // 1. ブロック対象のイベント一覧
  // =====================================================
  // これらのイベントが preventDefault() されると、右クリック・選択・コピーが無効化される
  const BLOCKED_EVENTS = [
    "contextmenu", // 右クリックメニュー
    "selectstart", // テキスト選択の開始
    "copy", // コピー (Ctrl+C)
    "cut", // カット (Ctrl+X)
    "paste", // ペースト (Ctrl+V)
  ];

  // ドラッグ関連のイベントも一部のサイトでは制限されている
  const DRAG_EVENTS = ["dragstart", "drag"];

  const ALL_BLOCKED = [...BLOCKED_EVENTS, ...DRAG_EVENTS];

  // =====================================================
  // 2. addEventListener のオーバーライド
  // =====================================================
  // 元の addEventListener を保存し、ラッパーで上書きする。
  // これにより、ページのスクリプトが後から contextmenu 等のリスナーを
  // 追加しようとしても、自動的にブロックされる。
  const originalAddEventListener = EventTarget.prototype.addEventListener;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    // ブロック対象のイベントなら登録をスキップ
    if (ALL_BLOCKED.includes(type)) {
      return; // 何もしない = リスナーが登録されない
    }
    // それ以外のイベントは通常通り登録
    return originalAddEventListener.call(this, type, listener, options);
  };

  // =====================================================
  // 3. インラインイベントハンドラーの除去
  // =====================================================
  // <body oncontextmenu="return false"> のような HTML属性で
  // 設定されたハンドラーを null で上書きして無効化する。
  function removeInlineHandlers(element) {
    // oncontextmenu, onselectstart, oncopy, oncut, onpaste, ondragstart, ondrag
    ALL_BLOCKED.forEach((eventName) => {
      const handlerProp = "on" + eventName;
      if (element[handlerProp] !== null) {
        element[handlerProp] = null;
      }
    });
  }

  // document と body の両方からインラインハンドラーを除去
  removeInlineHandlers(document);
  if (document.body) {
    removeInlineHandlers(document.body);
  }
  removeInlineHandlers(document.documentElement);

  // =====================================================
  // 4. 既に登録済みのイベントリスナーを無効化
  // =====================================================
  // addEventListener をオーバーライドしただけでは、
  // **既に登録済み**のリスナーには効果がない。
  // そこで、キャプチャリングフェーズ（capture: true）で
  // stopImmediatePropagation() を呼んでブロックする。
  //
  // 【キャプチャリングフェーズとは？】
  //   イベントは以下の順序で処理される:
  //   1. キャプチャリング: window → document → ... → target要素 （上から下）
  //   2. ターゲット: target要素で発火
  //   3. バブリング: target要素 → ... → document → window （下から上）
  //
  //   capture: true で登録すると、キャプチャリングフェーズ（最も早い段階）で
  //   イベントを捕まえられるため、他のリスナーより先に実行される。
  //   stopImmediatePropagation() で伝播を完全に止め、サイト側のリスナーが
  //   実行されないようにする。

  BLOCKED_EVENTS.forEach((eventName) => {
    // 注意: ここでは originalAddEventListener を使う。
    // document.addEventListener はオーバーライド済みで、
    // BLOCKED_EVENTS のイベントは登録がスキップされてしまうため。
    originalAddEventListener.call(
      document,
      eventName,
      function (e) {
        e.stopImmediatePropagation();
        // e.preventDefault() は呼ばない → ブラウザ標準の動作は維持される
        // 例: contextmenu なら右クリックメニューが表示される
      },
      { capture: true }
    );
  });

  // =====================================================
  // 5. CSS による選択制限の解除
  // =====================================================
  // user-select: none を上書きして、テキスト選択を可能にする。
  // !important を付けることで、サイト側の CSS より優先される。
  const styleElement = document.createElement("style");
  styleElement.id = "enable-right-click-styles";
  styleElement.textContent = `
    *, *::before, *::after {
      -webkit-user-select: auto !important;
      -moz-user-select: auto !important;
      -ms-user-select: auto !important;
      user-select: auto !important;
    }
  `;
  // <head> の末尾に style 要素を追加（末尾なのでサイトの CSS より後に評価される）
  (document.head || document.documentElement).appendChild(styleElement);

  // =====================================================
  // 6. MutationObserver による動的な要素の監視
  // =====================================================
  // SPA (Single Page Application) などでは、ページ遷移なしに
  // 新しい要素が DOM に追加されることがある。
  // 新しく追加された要素にもインラインハンドラーの除去を適用する。

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        // Element ノードのみ処理（テキストノード等を除外）
        if (node.nodeType === Node.ELEMENT_NODE) {
          removeInlineHandlers(node);
          // 子孫要素にもハンドラーがある場合に対応
          node.querySelectorAll?.("*").forEach(removeInlineHandlers);
        }
      }
    }
  });

  // document.body 以下の変化を監視
  if (document.body) {
    observer.observe(document.body, {
      childList: true, // 子要素の追加・削除を監視
      subtree: true, // 子孫要素も再帰的に監視
    });
  }

  console.log("[EnableRightClick] 制限を解除しました:", window.location.origin);
})();
