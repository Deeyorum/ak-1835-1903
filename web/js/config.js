// AK-1835-1903 vitrin — tek yapılandırma nesnesi. Adres sabiti
// başka bir dosyada TEKRARLANMAZ. Gerçek adresler, uydurma yok:
// apiBaseUrl mevcut canlı dağıtımın workers.dev adresi (DURUM.md/
// DEFTER.md kayıtları), siteBaseUrl bu vitrinin kendi alan adı.

(function () {
  "use strict";

  window.AK_CONFIG = {
    apiBaseUrl: "https://ak-1835-1903.tthacktt.workers.dev",
    siteBaseUrl: "https://ak-1835-1903.com"
  };
})();
