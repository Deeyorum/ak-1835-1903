// AK-1835-1903 vitrin — yönlendirme + sayfa geçişleri.
// Kararlar: docs/WEB-TASARIM.md.

(function () {
  "use strict";

  var ROUTES = ["/", "/kindi", "/tiro", "/enea", "/leon", "/hill", "/solla", "/connect"];
  var OPEN_DURATION = 3000;
  var RETURN_DURATION = 1000;
  var FADE_DURATION = 400;

  var app = document.getElementById("app");
  var canvasEl = document.getElementById("transition-canvas");
  var transition = window.AKTransition.create(canvasEl);

  // Sonda eğik çizgili adresler (/kindi/) de doğru rotaya çözülsün.
  function normalizePath(path) {
    var trimmed = path.replace(/\/+$/, "");
    return trimmed === "" ? "/" : trimmed;
  }

  // Bu sekmede, mevcut alt sayfaya ana sayfadan SPA tıklamasıyla gelindi mi?
  // "← home" bağlantısının geri tuşu davranışına uyup uymayacağını belirler.
  var cameFromHome = false;

  function pathToId(path) {
    var slug = path.replace(/^\/+/, "");
    if (slug === "") return "page-home";
    var id = "page-" + slug;
    return document.getElementById(id) ? id : "page-home";
  }

  function showPage(id) {
    var pages = document.querySelectorAll(".page");
    for (var i = 0; i < pages.length; i++) {
      pages[i].hidden = pages[i].id !== id;
    }
    window.scrollTo(0, 0);
  }

  function fadeTo(id, cb) {
    app.classList.add("fading");
    setTimeout(function () {
      showPage(id);
      app.classList.remove("fading");
      if (cb) cb();
    }, FADE_DURATION / 2);
  }

  function shuffleTo(id, duration, reverse, cb) {
    transition.play({
      duration: duration,
      reverse: reverse,
      onDone: function () {
        showPage(id);
        if (cb) cb();
      }
    });
  }

  // --- Ana sayfadan karta tıklama: tam gösteri (3000ms) ya da 400ms solma. ---
  function navigateFromHome(toPath) {
    var id = pathToId(toPath);
    history.pushState({ ak: true, path: toPath }, "", toPath);
    cameFromHome = true;
    if (window.AKTransition.supportsFull()) {
      shuffleTo(id, OPEN_DURATION, false);
    } else {
      fadeTo(id);
    }
  }

  // --- "← home" bağlantısı: SPA ile gelindiyse gerçek geri tuşu (popstate
  // reverse animasyonunu tetikler); doğrudan adresle gelindiyse 400ms solma. ---
  function navigateBackLink() {
    if (cameFromHome && history.state && history.state.ak) {
      history.back();
    } else {
      history.pushState({ ak: true, path: "/" }, "", "/");
      fadeTo("page-home");
    }
  }

  // --- Tarayıcı geri/ileri tuşu. ---
  window.addEventListener("popstate", function () {
    var path = normalizePath(location.pathname);
    var id = pathToId(path);
    if (path === "/") {
      if (window.AKTransition.supportsFull()) {
        shuffleTo(id, RETURN_DURATION, true, function () {
          cameFromHome = false;
        });
      } else {
        fadeTo(id, function () {
          cameFromHome = false;
        });
      }
    } else {
      // İleri tuşuyla bir alt sayfaya dönüş: goal'de ayrıca tanımlı değil,
      // en yakın tanımlı davranış olan 400ms solma kullanılır (bkz. WEB-TASARIM.md).
      fadeTo(id, function () {
        cameFromHome = false;
      });
    }
  });

  function attachHandlers() {
    var cards = document.querySelectorAll(".card[data-route]");
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener("click", function (ev) {
        ev.preventDefault();
        navigateFromHome(this.getAttribute("data-route"));
      });
    }

    var backLinks = document.querySelectorAll(".back-link[data-route]");
    for (var j = 0; j < backLinks.length; j++) {
      backLinks[j].addEventListener("click", function (ev) {
        ev.preventDefault();
        navigateBackLink();
      });
    }
  }

  function populateConfig() {
    var apiBaseEl = document.getElementById("connect-api-base");
    if (apiBaseEl && window.AK_CONFIG) {
      apiBaseEl.textContent = window.AK_CONFIG.apiBaseUrl;
    }
  }

  function init() {
    attachHandlers();
    populateConfig();
    var path = normalizePath(location.pathname);
    if (ROUTES.indexOf(path) === -1) {
      path = "/";
    }
    if (path === "/") {
      showPage("page-home");
    } else {
      // Doğrudan adresle gelindi: her zaman 400ms solma (tam gösteri yok).
      var id = pathToId(path);
      showPage("page-home");
      fadeTo(id);
    }
    history.replaceState({ ak: true, path: path }, "", path);
  }

  init();
})();
